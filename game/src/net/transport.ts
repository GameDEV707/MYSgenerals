// MYS Generals — transport abstraction (spec §20.2). Clients talk to the authoritative host
// through this interface. LoopbackTransport is used for the host's own local players
// (single-player and split-screen); SocketTransport (src/net/socketTransport.ts) is used for
// LAN clients. Both implement the same ClientTransport interface, so the simulation has
// exactly one code path.
import { Command, GameEvent, Snapshot, WireCommand, LobbyState, LobbyAction, ServerMsg } from "./protocol.js";

// Client-facing side of the transport.
export interface ClientTransport {
  readonly playerId: number;
  sendCommand(cmd: Command): void;
  onSnapshot(cb: (s: Snapshot) => void): void;
  onEvent(cb: (e: GameEvent) => void): void;
  close(): void;
}

// The lobby-aware client surface shared by every networked transport (SocketTransport — LAN,
// WebRTCTransport — online P2P, and LoopbackPeerTransport — the browser host's own player). All
// three speak the same ClientMsg/ServerMsg envelopes, so the menu/lobby UI and RemoteSession have
// exactly one code path regardless of the underlying transport (spec §20.2 / §24 T33).
export interface LobbyClient extends ClientTransport {
  sendLobbyAction(action: LobbyAction): void;
}

// Callback surface a lobby-aware transport raises as the connection progresses. SocketTransport,
// WebRTCTransport and LoopbackPeerTransport all drive these identically (spec §24 T33-B1).
export interface RemoteClientCallbacks {
  onWelcome?: (playerId: number, token: string) => void;
  onLobby?: (state: LobbyState) => void;
  onStart?: (msg: Extract<ServerMsg, { m: "start" }>) => void;
  onError?: (reason: string, key?: string) => void;
  onHostGone?: () => void;
  onStateChange?: (state: string) => void;
  onPong?: (rtt: number) => void;
  onReconnected?: () => void;
}

// Host-facing side: where the host pushes per-player snapshots/events.
export interface HostLink {
  playerId: number;
  pushSnapshot(s: Snapshot): void;
  pushEvent(e: GameEvent): void;
}

// What the host exposes to receive commands (implemented by MatchHost).
export interface CommandSink {
  submit(wire: WireCommand): void;
}

// In-process transport (no serialization). The client and host live in the same JS context.
export class LoopbackTransport implements ClientTransport, HostLink {
  readonly playerId: number;
  private sink: CommandSink;
  private clientTick = 0;
  private snapCb: ((s: Snapshot) => void) | null = null;
  private evCb: ((e: GameEvent) => void) | null = null;

  constructor(playerId: number, sink: CommandSink) {
    this.playerId = playerId;
    this.sink = sink;
  }

  sendCommand(cmd: Command): void {
    this.sink.submit({ playerId: this.playerId, clientTick: ++this.clientTick, cmd });
  }
  onSnapshot(cb: (s: Snapshot) => void): void { this.snapCb = cb; }
  onEvent(cb: (e: GameEvent) => void): void { this.evCb = cb; }
  close(): void { this.snapCb = null; this.evCb = null; }

  // Host → client (called by MatchHost).
  pushSnapshot(s: Snapshot): void { this.snapCb?.(s); }
  pushEvent(e: GameEvent): void { this.evCb?.(e); }
}
