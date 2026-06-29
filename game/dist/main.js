// MYS Generals — application entry. Boots the menu/lobby and launches matches on the
// authoritative-host architecture (spec §3.2). Local matches (single-player, split-screen) run a
// MatchHost in-page via LoopbackTransport; LAN matches connect a SocketTransport to a Node host;
// ONLINE matches (T33) connect a WebRTCTransport (joiner) or run an in-browser GameHost (host) —
// the simulation path is identical, only the transport differs.
import { initLang, defaultName } from "./i18n.js";
import { Menu } from "./ui/menu.js";
import { AudioManager } from "./render/audio.js";
import { MatchSession } from "./client/session.js";
import { RemoteSession } from "./client/remoteSession.js";
import { SocketTransport } from "./net/socketTransport.js";
const canvas = document.getElementById("game-canvas");
const overlay = document.getElementById("overlay");
const audio = new AudioManager();
initLang();
let session = null;
let remote = null;
let transport = null;
function clearSessions() {
    session?.stop();
    session = null;
    remote?.stop();
    remote = null;
    if (transport) {
        transport.close();
        transport = null;
    }
    menu.teardownOnline();
}
// Enter a match as a thin client of any host (LAN socket, online WebRTC, or the in-browser host's
// own loopback player(s)) — the RemoteSession only renders snapshots + sends commands (spec §3.2).
// Two locals + split renders split-screen on one device (e.g. online host + a friend on the couch).
function enterRemoteMatch(locals, startMsg, split) {
    remote?.stop();
    remote = new RemoteSession(canvas, overlay, audio, locals, startMsg, split);
    remote.start();
    remote.onQuit = () => { clearSessions(); menu.showTitle(); };
}
// Connect a SocketTransport to a hosted game and drive the lobby → match flow. Shared by manual
// "Join Local Game" and the auto-join path so both behave identically.
function connect(rawUrl, name, ui) {
    clearSessions();
    // Normalize: accept a bare IP:port or a full URL, keep only scheme+host (drop path & query).
    let url = rawUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://"))
        url = "http://" + url;
    const base = url.split("?")[0].replace(/\/+$/, "");
    ui.setStatus("join.connectingHost");
    transport = new SocketTransport(base, name, {
        onWelcome: (_playerId, _token) => { ui.setStatus("join.connectingHost"); },
        onLobby: (state) => { if (transport)
            menu.showRemoteLobby(state, transport, "lan"); },
        onStart: (startMsg) => { if (transport)
            enterRemoteMatch([{ transport, playerId: startMsg.you, pointerType: null, keyboard: true, control: "single" }], startMsg, false); },
        onError: (_reason, key) => { ui.setStatus(key || "join.failed", true); },
        onHostGone: () => { clearSessions(); menu.showTitle(); },
        onStateChange: (_s) => { },
        onPong: (_rtt) => { },
    });
}
const menu = new Menu(overlay, {
    onStartLocal: (cfg) => {
        clearSessions();
        session = new MatchSession(canvas, overlay, audio);
        session.start(cfg);
    },
    onJoin: (opts, ui) => { connect(opts.url, opts.name, ui); },
    // Online (WebRTC P2P) and the in-browser host's own player(s) both reach the match here.
    onRemoteMatch: (locals, startMsg, split) => { enterRemoteMatch(locals, startMsg, split); },
});
// A page opened with a `#join=<code>` fragment (a shared online invite) jumps straight to the Join
// Online screen with the invite pre-filled (spec §24 T33-C2).
function maybeJoinFragment() {
    const hash = window.location.hash || "";
    const m = hash.match(/[#&]join=([^#&]+)/);
    if (!m)
        return false;
    menu.showJoinOnline(decodeURIComponent(m[1]));
    return true;
}
// If this page was opened from a host's shared link/QR (carries ?room=) or was served by the Node
// host itself, skip the title menu and connect straight to the lobby. window.location.origin is the
// correct address in both cases: the host's own browser uses http://localhost:<port> (loopback →
// slot 0), remote devices use http://<lan-ip>:<port>.
function maybeAutoJoin() {
    const info = window.__MYS_HOST__;
    const params = new URLSearchParams(window.location.search);
    const hasRoom = params.has("room");
    if (!info?.servedByHost && !hasRoom)
        return false;
    const origin = window.location.origin && window.location.origin !== "null"
        ? window.location.origin
        : (info?.lanUrl || "");
    if (!origin)
        return false;
    const doJoin = () => {
        const ui = menu.showConnecting(origin, doJoin, () => { clearSessions(); menu.showTitle(); });
        connect(origin, defaultName(), ui);
    };
    doJoin();
    return true;
}
if (!maybeJoinFragment() && !maybeAutoJoin())
    menu.showTitle();
