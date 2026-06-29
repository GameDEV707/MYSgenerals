// MYS Generals — transport-agnostic authoritative game host (spec §3.2, §20, §24 T33-A).
//
// This is the host-side message loop, extracted from the Node LAN server (src/server/host.ts) so
// it can be reused unchanged by BOTH drivers:
//   • the Node WebSocket server (LAN, T25) — peers are RFC-6455 sockets, and
//   • the in-browser host (online P2P, T33) — peers are WebRTC data channels + the host's own
//     in-page LoopbackPeerTransport.
//
// It owns the Lobby + MatchHost, assigns slots (incl. the reserved host slot 0), validates the
// lobby actions, drives the authoritative sim at 20 Hz and broadcasts per-player FOG-FILTERED
// snapshots + one-shot events — producing BYTE-IDENTICAL ServerMsg behaviour to the old inline
// loop. It has NO DOM and NO Node imports: it talks to peers only through an abstract HostPeerSink
// (send a ServerMsg to peer N / disconnect peer N), and it is fed bytes via onPeerMessage(). This
// keeps it engine-agnostic and unit-testable over an in-memory mock sink (test/gamehost.mjs).
import { World, PlayerState, GameEvent } from "../sim/world.js";
import { getMap } from "../sim/map.js";
import { MatchHost } from "./matchHost.js";
import { Lobby } from "./lobby.js";
import { HostLink } from "../net/transport.js";
import {
  Snapshot, LobbyState, ClientMsg, ServerMsg, LobbyAction,
} from "../net/protocol.js";
import { TICK_DT } from "../constants.js";

// Where the host pushes outgoing ServerMsgs. The driver (Node socket / WebRTC channel / loopback)
// implements this — GameHost never touches a transport directly.
export interface HostPeerSink {
  // Deliver a ServerMsg to a single peer. The driver decides whether to serialize (JSON over a
  // socket / data channel) or hand the object straight to an in-page loopback client.
  send(peerId: string, msg: ServerMsg): void;
  // Drop the peer's connection (e.g. lobby full / match started / kicked).
  disconnect(peerId: string): void;
}

function randomToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// One connected peer's host-side link (implements HostLink for MatchHost): per-player snapshots
// and events flow back to the peer through the sink.
class PeerLink implements HostLink {
  playerId: number;
  constructor(playerId: number, private host: GameHost, public peerId: string) {
    this.playerId = playerId;
  }
  pushSnapshot(s: Snapshot): void { this.host.deliver(this.peerId, { m: "snapshot", data: s }); }
  pushEvent(e: GameEvent): void { this.host.deliver(this.peerId, { m: "event", data: e }); }
}

interface PeerSession {
  peerId: string;
  slotIndex: number;
  token: string;
  name: string;
  link: PeerLink | null; // populated once the match starts
}

interface PeerConn {
  peerId: string;
  loopback: boolean;       // the host's own browser (online) / loopback socket (LAN) → claims slot 0
  helloReceived: boolean;
  session: PeerSession | null;
}

export interface GameHostOptions {
  hostUrl?: string;
  map?: string;
  roomCode?: string;
}

const GRACE_MS = 30_000; // reconnection grace window (spec §20.5)

export class GameHost {
  readonly lobby: Lobby;
  private sink: HostPeerSink;
  private peers = new Map<string, PeerConn>();
  private matchHost: MatchHost | null = null;
  private matchInterval: ReturnType<typeof setInterval> | null = null;
  private hostPeerId: string | null = null;
  private graceTokens = new Map<string, { slotIndex: number; timeout: ReturnType<typeof setTimeout> }>();

  // Optional hooks the driver can use to refresh its UI (e.g. the in-browser connected-devices
  // list) — purely cosmetic, never required for correctness.
  onLobbyChange: ((state: LobbyState) => void) | null = null;
  onMatchStart: (() => void) | null = null;

  constructor(sink: HostPeerSink, opts: GameHostOptions = {}) {
    this.sink = sink;
    this.lobby = new Lobby(opts.hostUrl ?? "", opts.map ?? "twin_rivers", opts.roomCode);
  }

  // Read-only access to the running match (null until started). Exposed so headless tests can drive
  // the sim deterministically (step + inspect world) over a mock peer sink — never used in the app.
  get match(): MatchHost | null { return this.matchHost; }
  // True once the 20 Hz tick loop is armed (after a match starts). Tests can stop it via shutdown().
  get running(): boolean { return this.matchInterval !== null; }

  // ---- peer lifecycle (called by the driver) ----
  onPeerConnect(peerId: string, loopback = false): void {
    if (this.peers.has(peerId)) return;
    this.peers.set(peerId, { peerId, loopback, helloReceived: false, session: null });
  }

  // A raw JSON line arrived from a peer (socket / data channel).
  onPeerMessage(peerId: string, raw: string): void {
    let msg: ClientMsg;
    try { msg = JSON.parse(raw); } catch { return; }
    this.onPeerMessageObject(peerId, msg);
  }

  // A parsed ClientMsg arrived (the loopback path uses this to skip JSON).
  onPeerMessageObject(peerId: string, msg: ClientMsg): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (!peer.helloReceived) {
      if (msg.m !== "hello") { this.sink.disconnect(peerId); return; }
      peer.helloReceived = true;
      this.handleHello(peer, msg);
      return;
    }
    if (peer.session) this.handleClientMsg(peer.session, msg);
  }

  onPeerDisconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    this.peers.delete(peerId);
    if (!peer || !peer.session) return;
    const session = peer.session;

    if (this.matchHost && session.link) {
      // Match running: keep the slot alive for a grace window so the player can reconnect.
      this.matchHost.removeLink(session.link);
      session.link = null;
      const token = session.token;
      const slotIdx = session.slotIndex;
      const playerName = session.name;
      for (const c of this.sessions()) {
        this.deliver(c.peerId, { m: "event", data: { e: "toast", key: "net.left", kind: "warning", params: { name: playerName } } });
      }
      const timeout = setTimeout(() => {
        this.graceTokens.delete(token);
        this.lobby.releaseSlot(slotIdx);
        this.broadcastLobby();
      }, GRACE_MS);
      this.graceTokens.set(token, { slotIndex: slotIdx, timeout });
    } else {
      // In the lobby: release the slot. If the host's own browser closed, free slot 0 (keep it
      // shown as "Host") so a reload reclaims it as the host rather than a join slot.
      if (peerId === this.hostPeerId) {
        this.hostPeerId = null;
        const s0 = this.lobby.state.slots[0];
        if (s0) { s0.token = undefined; s0.ready = false; }
      } else {
        this.lobby.releaseSlot(session.slotIndex);
      }
      this.broadcastLobby();
    }
  }

  // Graceful host shutdown: tell every peer the host is gone (spec §20.5).
  shutdown(): void {
    const msg: ServerMsg = { m: "hostgone" };
    for (const c of this.sessions()) { try { this.deliver(c.peerId, msg); } catch { /* */ } }
    if (this.matchInterval) { clearInterval(this.matchInterval); this.matchInterval = null; }
  }

  // ---- internal: deliver / iterate ----
  deliver(peerId: string, msg: ServerMsg): void { this.sink.send(peerId, msg); }
  private sessions(): PeerSession[] {
    const out: PeerSession[] = [];
    for (const p of this.peers.values()) if (p.session) out.push(p.session);
    return out;
  }

  // Build the public lobby state: per-slot reconnection tokens are stripped so one client never
  // sees another's token (spec §20.3 — token is host-side only).
  private publicLobby(): LobbyState {
    return {
      ...this.lobby.state,
      slots: this.lobby.state.slots.map((s) => ({ ...s, token: undefined })),
    };
  }

  private broadcastLobby(): void {
    const pub = this.publicLobby();
    const msg: ServerMsg = { m: "lobby", state: pub };
    for (const c of this.sessions()) this.deliver(c.peerId, msg);
    this.onLobbyChange?.(pub);
  }

  // ---- hello (slot claim + reconnection) ----
  private handleHello(peer: PeerConn, msg: Extract<ClientMsg, { m: "hello" }>): void {
    const name = (msg.name || "Player").slice(0, 20);
    let token = msg.token;

    // Reconnection via a grace token.
    if (token && this.graceTokens.has(token)) {
      const grace = this.graceTokens.get(token)!;
      clearTimeout(grace.timeout);
      this.graceTokens.delete(token);
      const session: PeerSession = { peerId: peer.peerId, slotIndex: grace.slotIndex, token, name, link: null };
      peer.session = session;
      if (grace.slotIndex === 0) this.hostPeerId = peer.peerId;
      const slot = this.lobby.state.slots[grace.slotIndex];
      slot.kind = "human"; slot.name = name; slot.ready = false; slot.token = token;

      if (this.matchHost) {
        const participants = this.lobby.participants().sort((a, b) => a.index - b.index);
        const simId = participants.findIndex((p) => p.index === grace.slotIndex);
        if (simId >= 0) {
          const link = new PeerLink(simId, this, peer.peerId);
          session.link = link;
          this.matchHost.addLink(link);
          const grid = this.matchHost.computeVisibility(simId);
          this.deliver(peer.peerId, { m: "snapshot", data: this.matchHost.buildSnapshot(simId, grid) });
        }
        for (const c of this.sessions()) {
          if (c !== session) this.deliver(c.peerId, { m: "event", data: { e: "toast", key: "net.joined", kind: "ok", params: { name } } });
        }
      }
      this.deliver(peer.peerId, { m: "welcome", playerId: grace.slotIndex, token, you: grace.slotIndex });
      this.broadcastLobby();
      return;
    }

    // New connection.
    if (this.lobby.state.started) {
      this.deliver(peer.peerId, { m: "error", reason: "Match already in progress", key: "join.started" });
      this.sink.disconnect(peer.peerId);
      return;
    }
    token = randomToken();
    let slotIndex: number;
    // The host's own browser/loopback connection claims slot 0; remote peers take the next open
    // slot (spec §3.2 / §24 T25/T33).
    if (this.hostPeerId === null && peer.loopback) {
      slotIndex = this.lobby.claimHostSlot(name, token);
      if (slotIndex >= 0) this.hostPeerId = peer.peerId;
      else slotIndex = this.lobby.claimHumanSlot(name, token);
    } else {
      slotIndex = this.lobby.claimHumanSlot(name, token);
    }
    if (slotIndex < 0) {
      this.deliver(peer.peerId, { m: "error", reason: "Lobby is full", key: "join.full" });
      this.sink.disconnect(peer.peerId);
      return;
    }
    peer.session = { peerId: peer.peerId, slotIndex, token, name, link: null };
    this.deliver(peer.peerId, { m: "welcome", playerId: slotIndex, token, you: slotIndex });
    this.broadcastLobby();
  }

  // ---- per-message handling (post-hello) ----
  private handleClientMsg(session: PeerSession, msg: ClientMsg): void {
    switch (msg.m) {
      case "hello": break; // duplicate — ignore
      case "lobby":
        if (!this.lobby.state.started) this.handleLobbyAction(session, msg.action);
        break;
      case "cmd":
        if (this.matchHost && session.link) this.matchHost.submit(msg.data);
        break;
      case "ping":
        this.deliver(session.peerId, { m: "pong", t: msg.t });
        break;
    }
  }

  private handleLobbyAction(session: PeerSession, action: LobbyAction): void {
    const isHost = session.slotIndex === 0;
    switch (action.a) {
      case "setColor": this.lobby.setColor(session.slotIndex, action.color); break;
      case "setHero": this.lobby.setHero(session.slotIndex, action.hero); break;
      case "ready": this.lobby.setReady(session.slotIndex, action.ready); break;
      case "setName": this.lobby.setName(session.slotIndex, action.name); break;
      // host-only:
      case "setMap": if (isHost) this.lobby.setMap(action.map); break;
      case "addAI": if (isHost) this.lobby.addAI(action.diff); break;
      case "removeSlot": if (isHost) this.lobby.removeSlot(action.index); break;
      case "openSlot": if (isHost) this.lobby.openSlot(action.index); break;
      case "closeSlot": if (isHost) this.lobby.closeSlot(action.index); break;
      case "kick":
        if (isHost) {
          for (const c of this.sessions()) if (c.slotIndex === action.index) this.sink.disconnect(c.peerId);
          this.lobby.kick(action.index);
        }
        break;
      case "setSplit": if (isHost) this.lobby.setSplit(action.on); break;
      case "start":
        if (isHost && this.lobby.canStart()) this.startMatch();
        break;
    }
    this.broadcastLobby();
  }

  // ---- match lifecycle ----
  private startMatch(): void {
    if (this.matchHost) return;
    this.lobby.state.started = true;
    const map = getMap(this.lobby.state.map);
    const world = new World(map);
    const participants = this.lobby.participants();

    const idMap = new Map<number, number>();
    participants.sort((a, b) => a.index - b.index);
    participants.forEach((p, i) => idMap.set(p.index, i));

    const mkPlayer = (slot: typeof participants[0], id: number): PlayerState => ({
      id, silver: 15, iron: 0, gold: 0, color: slot.color, isAI: slot.kind === "ai",
      aiDiff: slot.ai || "normal", defeated: false,
      powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
      research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false },
      unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0,
    });

    participants.forEach((slot, i) => world.addPlayer(mkPlayer(slot, i)));
    participants.forEach((_, i) => world.spawnBase(i, map.spawns[i]));
    world.setupNeutrals();

    this.matchHost = new MatchHost(world);
    participants.forEach((slot, i) => { if (slot.kind === "ai") this.matchHost!.addAIPlayer(i); });

    const startMsg = (you: number): ServerMsg => ({
      m: "start",
      map: this.lobby.state.map,
      players: participants.map((slot, i) => ({
        id: i, color: slot.color, isAI: slot.kind === "ai", aiDiff: slot.ai || "normal", hero: slot.hero,
      })),
      you,
    });

    for (const c of this.sessions()) {
      const simId = idMap.get(c.slotIndex);
      if (simId === undefined) continue;
      const link = new PeerLink(simId, this, c.peerId);
      c.link = link;
      this.matchHost.addLink(link);
      this.deliver(c.peerId, startMsg(simId));
    }

    this.matchHost.step(); // prime
    this.matchInterval = setInterval(() => {
      if (!this.matchHost) return;
      this.matchHost.step();
      if (this.matchHost.world.winner !== -2) setTimeout(() => this.stopMatch(), 5000);
    }, TICK_DT * 1000);

    this.broadcastLobby();
    this.onMatchStart?.();
  }

  private stopMatch(): void {
    if (this.matchInterval) { clearInterval(this.matchInterval); this.matchInterval = null; }
    this.matchHost = null;
    this.lobby.state.started = false;
    for (const s of this.lobby.state.slots) { if (s.kind === "human" && s.index !== 0) s.ready = false; }
    this.broadcastLobby();
  }
}
