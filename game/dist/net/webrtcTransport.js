import { encodeSignal, decodeSignal } from "./signal.js";
// Free public STUN servers for NAT discovery. No TURN relay (that would be a server we operate);
// strict/symmetric NAT (~10–20%) may fail without it — documented & deferred (spec §24 T33).
export const RTC_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
    ],
};
// Resolve once ICE gathering is complete (non-trickle), with a safety timeout so a stalled
// candidate can't hang the handshake — whatever was gathered by then is still usable.
export function gatherComplete(pc, timeoutMs = 4000) {
    return new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") {
            resolve();
            return;
        }
        const done = () => { pc.removeEventListener("icegatheringstatechange", check); resolve(); };
        const check = () => { if (pc.iceGatheringState === "complete")
            done(); };
        pc.addEventListener("icegatheringstatechange", check);
        setTimeout(done, timeoutMs);
    });
}
export class WebRTCTransport {
    get playerId() { return this._playerId; }
    get token() { return this._token; }
    constructor(name, cb) {
        this.ch = null;
        this._playerId = -1;
        this._token = "";
        this.clientTick = 0;
        this.snapCb = null;
        this.evCb = null;
        this._closed = false;
        this.name = name;
        this.cb = cb;
    }
    // Attach the (offerer-created) data channel once it arrives via pc.ondatachannel.
    bindChannel(ch) {
        this.ch = ch;
        ch.onmessage = (ev) => {
            let msg;
            try {
                msg = JSON.parse(ev.data);
            }
            catch {
                return;
            }
            this.handleMessage(msg);
        };
        ch.onclose = () => { if (!this._closed)
            this.cb.onHostGone?.(); };
        ch.onerror = () => { this.cb.onStateChange?.("error"); };
        const sendHello = () => {
            this.cb.onStateChange?.("lobby");
            const hello = { m: "hello", name: this.name };
            this.rawSend(hello);
        };
        if (ch.readyState === "open")
            sendHello();
        else
            ch.onopen = sendHello;
    }
    rawSend(msg) {
        if (!this.ch || this.ch.readyState !== "open")
            return;
        try {
            this.ch.send(JSON.stringify(msg));
        }
        catch { /* */ }
    }
    handleMessage(msg) {
        switch (msg.m) {
            case "welcome":
                this._playerId = msg.playerId;
                this._token = msg.token;
                this.cb.onWelcome?.(msg.playerId, msg.token);
                break;
            case "lobby":
                this.cb.onLobby?.(msg.state);
                break;
            case "start":
                this.cb.onStateChange?.("playing");
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
                this.close();
                break;
        }
    }
    // ---- ClientTransport ----
    sendCommand(cmd) {
        const wire = { playerId: this._playerId, clientTick: ++this.clientTick, cmd };
        this.rawSend({ m: "cmd", data: wire });
    }
    onSnapshot(cb) { this.snapCb = cb; }
    onEvent(cb) { this.evCb = cb; }
    sendLobbyAction(action) { this.rawSend({ m: "lobby", action }); }
    close() {
        this._closed = true;
        try {
            this.ch?.close();
        }
        catch { /* */ }
        this.snapCb = null;
        this.evCb = null;
    }
}
// Joiner signaling: decode the host's invite (offer), create the answer, gather ICE, and produce
// the reply code. The returned transport is wired to the data channel the host created and will
// fire its callbacks (onWelcome / onLobby / onStart …) once the connection establishes.
export async function joinOnline(inviteCode, name, cb) {
    const blob = decodeSignal(inviteCode);
    if (!blob || blob.t !== "offer")
        throw new Error("badcode");
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const transport = new WebRTCTransport(name, cb);
    pc.ondatachannel = (ev) => transport.bindChannel(ev.channel);
    pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        cb.onStateChange?.(st);
        if (st === "failed" || st === "disconnected")
            cb.onError?.("Connection failed", "online.connectFailed");
    };
    await pc.setRemoteDescription({ type: "offer", sdp: blob.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await gatherComplete(pc);
    const replyCode = encodeSignal({ t: "answer", sdp: pc.localDescription?.sdp ?? answer.sdp ?? "" });
    return { replyCode, transport, pc };
}
