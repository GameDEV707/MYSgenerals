// MYS Generals — in-browser online host endpoint (spec §24 T33-B2). The host runs the whole game
// in its tab: a GameHost (the authoritative Lobby + MatchHost) plus this driver, which
//   • attaches the host's OWN player over an in-page LoopbackPeerTransport (no network, no JSON),
//   • creates one RTCPeerConnection per joiner (offerer), generating an INVITE code and applying
//     the joiner's REPLY code, and bridges each open RTCDataChannel into GameHost as a peer.
// This removes the host.bat / Node-server requirement for hosting (spec §24 T33).
//
// BROWSER-ONLY (uses RTCPeerConnection); compiled by the client tsconfig, never imported by the
// headless tests — the real WebRTC leg is user-verified (spec §24 T33-E2). The transport-agnostic
// GameHost it drives is the part covered headlessly (test/gamehost.mjs).
import { GameHost } from "../host/gameHost.js";
import { RTC_CONFIG, gatherComplete } from "./webrtcTransport.js";
import { encodeSignal, decodeSignal } from "./signal.js";
const LOCAL_PEER = "local-host";
// The host's own player, as a LobbyClient that talks to the in-tab GameHost directly. Outgoing
// ClientMsgs are handed to GameHost as objects (no JSON); incoming ServerMsgs are delivered as
// objects too — so the host pays no serialization cost for its own snapshots. This is the spec's
// "host itself via LoopbackTransport", extended to speak the full lobby protocol so the host uses
// the exact same lobby UI + RemoteSession path as every joiner.
export class LoopbackPeerTransport {
    constructor(host, name, cb) {
        this.host = host;
        this.name = name;
        this.cb = cb;
        this._playerId = -1;
        this.clientTick = 0;
        this.snapCb = null;
        this.evCb = null;
    }
    connect() {
        this.host.onPeerConnect(LOCAL_PEER, true); // loopback → claims host slot 0
        this.host.onPeerMessageObject(LOCAL_PEER, { m: "hello", name: this.name });
    }
    // GameHost → host's own client (object, no parse).
    deliver(msg) {
        switch (msg.m) {
            case "welcome":
                this._playerId = msg.playerId;
                this.cb.onWelcome?.(msg.playerId, msg.token);
                break;
            case "lobby":
                this.cb.onLobby?.(msg.state);
                break;
            case "start":
                this.cb.onStart?.(msg);
                break;
            case "snapshot":
                this.snapCb?.(msg.data);
                break;
            case "event":
                this.evCb?.(msg.data);
                break;
            case "pong":
                this.cb.onPong?.(Date.now() - msg.t);
                break;
            case "error":
                this.cb.onError?.(msg.reason, msg.key);
                break;
            case "hostgone":
                this.cb.onHostGone?.();
                break;
        }
    }
    get playerId() { return this._playerId; }
    sendCommand(cmd) {
        const wire = { playerId: this._playerId, clientTick: ++this.clientTick, cmd };
        this.host.onPeerMessageObject(LOCAL_PEER, { m: "cmd", data: wire });
    }
    sendLobbyAction(action) { this.host.onPeerMessageObject(LOCAL_PEER, { m: "lobby", action }); }
    onSnapshot(cb) { this.snapCb = cb; }
    onEvent(cb) { this.evCb = cb; }
    close() { this.host.onPeerDisconnect(LOCAL_PEER); this.snapCb = null; this.evCb = null; }
}
export class BrowserHost {
    constructor(name, cb) {
        this.peers = new Map();
        this.seq = 0;
        const sink = {
            send: (peerId, msg) => {
                if (peerId === LOCAL_PEER) {
                    this.local.deliver(msg);
                    return;
                }
                const p = this.peers.get(peerId);
                if (p && p.channel.readyState === "open") {
                    try {
                        p.channel.send(JSON.stringify(msg));
                    }
                    catch { /* */ }
                }
            },
            disconnect: (peerId) => {
                if (peerId === LOCAL_PEER)
                    return;
                const p = this.peers.get(peerId);
                if (p) {
                    try {
                        p.channel.close();
                        p.pc.close();
                    }
                    catch { /* */ }
                    this.peers.delete(peerId);
                }
            },
        };
        this.gameHost = new GameHost(sink, { hostUrl: "" });
        this.local = new LoopbackPeerTransport(this.gameHost, name, cb);
    }
    // Connect the host's own player (claims slot 0) — call once after constructing.
    start() { this.local.connect(); }
    // Number of remote peers whose data channel is currently open.
    connectedPeers() { let n = 0; for (const p of this.peers.values())
        if (p.connected)
            n++; return n; }
    // Create a fresh invite for the next joiner: a new RTCPeerConnection (offerer) with a reliable,
    // ordered data channel, ICE gathered to completion, packed into an invite code.
    async createInvite() {
        const peerId = `rtc-${++this.seq}`;
        const pc = new RTCPeerConnection(RTC_CONFIG);
        const channel = pc.createDataChannel("mys", { ordered: true });
        const peer = { pc, channel, connected: false };
        this.peers.set(peerId, peer);
        channel.onopen = () => { peer.connected = true; this.gameHost.onPeerConnect(peerId, false); };
        channel.onmessage = (ev) => this.gameHost.onPeerMessage(peerId, ev.data);
        channel.onclose = () => { peer.connected = false; this.gameHost.onPeerDisconnect(peerId); this.peers.delete(peerId); };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed" || pc.connectionState === "closed") {
                peer.connected = false;
                this.gameHost.onPeerDisconnect(peerId);
                this.peers.delete(peerId);
            }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await gatherComplete(pc);
        const code = encodeSignal({ t: "offer", sdp: pc.localDescription?.sdp ?? offer.sdp ?? "" });
        return {
            peerId,
            code,
            applyReply: async (replyCode) => {
                const blob = decodeSignal(replyCode);
                if (!blob || blob.t !== "answer")
                    throw new Error("badreply");
                await pc.setRemoteDescription({ type: "answer", sdp: blob.sdp });
            },
        };
    }
    // Tear everything down (host left the lobby / quit the match).
    stop() {
        this.gameHost.shutdown();
        for (const p of this.peers.values()) {
            try {
                p.channel.close();
                p.pc.close();
            }
            catch { /* */ }
        }
        this.peers.clear();
    }
}
