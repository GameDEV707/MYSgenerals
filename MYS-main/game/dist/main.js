// MYS Generals — application entry. Boots the menu/lobby and launches matches on the
// authoritative-host architecture (spec §3.2). Local matches (single-player, split-screen) run a
// MatchHost in-page via LoopbackTransport; LAN matches connect a SocketTransport to a Node host —
// the simulation path is identical, only the transport differs.
import { initLang } from "./i18n.js";
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
}
function defaultName() {
    try {
        return localStorage.getItem("mys.name") || "Player";
    }
    catch {
        return "Player";
    }
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
            menu.showRemoteLobby(state, transport); },
        onStart: (startMsg) => {
            if (!transport)
                return;
            remote = new RemoteSession(canvas, overlay, audio, transport, startMsg);
            remote.start();
            remote.onQuit = () => { clearSessions(); menu.showTitle(); };
        },
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
});
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
if (!maybeAutoJoin())
    menu.showTitle();
