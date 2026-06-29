// MYS Generals — application entry. Boots the menu/lobby and launches matches on the
// authoritative-host architecture (spec §3.2). Local matches (single-player, split-screen) run a
// MatchHost in-page via LoopbackTransport; LAN matches connect a SocketTransport to a Node host;
// ONLINE matches (T33) connect a WebRTCTransport (joiner) or run an in-browser GameHost (host) —
// the simulation path is identical, only the transport differs.
import { initLang, defaultName } from "./i18n.js";
import { Menu, JoinUI } from "./ui/menu.js";
import { AudioManager } from "./render/audio.js";
import { MatchSession } from "./client/session.js";
import { RemoteSession } from "./client/remoteSession.js";
import { SocketTransport } from "./net/socketTransport.js";
import { ClientTransport } from "./net/transport.js";
import { ServerMsg } from "./net/protocol.js";

// Marker injected by the Node host (dist/server/host.js) into the served HTML. When present we know
// the page came from a real LAN host, so we auto-connect instead of showing the title menu. Pages
// served by the static-only serve.mjs (local play) do NOT carry this, so they boot to the title.
declare global {
  interface Window {
    __MYS_HOST__?: { lanUrl: string; ip: string; port: number; room: string; servedByHost: boolean };
  }
}

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLElement;
const audio = new AudioManager();

initLang();
let session: MatchSession | null = null;
let remote: RemoteSession | null = null;
let transport: SocketTransport | null = null;

function clearSessions(): void {
  session?.stop(); session = null;
  remote?.stop(); remote = null;
  if (transport) { transport.close(); transport = null; }
  menu.teardownOnline();
}

// Enter a match as a thin client of any host (LAN socket, online WebRTC, or the in-browser host's
// own loopback player) — the RemoteSession only renders snapshots + sends commands (spec §3.2).
function enterRemoteMatch(t: ClientTransport, startMsg: Extract<ServerMsg, { m: "start" }>): void {
  remote?.stop();
  remote = new RemoteSession(canvas, overlay, audio, t, startMsg);
  remote.start();
  remote.onQuit = () => { clearSessions(); menu.showTitle(); };
}

// Connect a SocketTransport to a hosted game and drive the lobby → match flow. Shared by manual
// "Join Local Game" and the auto-join path so both behave identically.
function connect(rawUrl: string, name: string, ui: JoinUI): void {
  clearSessions();
  // Normalize: accept a bare IP:port or a full URL, keep only scheme+host (drop path & query).
  let url = rawUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://" + url;
  const base = url.split("?")[0].replace(/\/+$/, "");

  ui.setStatus("join.connectingHost");
  transport = new SocketTransport(base, name, {
    onWelcome: (_playerId, _token) => { ui.setStatus("join.connectingHost"); },
    onLobby: (state) => { if (transport) menu.showRemoteLobby(state, transport, "lan"); },
    onStart: (startMsg) => { if (transport) enterRemoteMatch(transport, startMsg); },
    onError: (_reason, key) => { ui.setStatus(key || "join.failed", true); },
    onHostGone: () => { clearSessions(); menu.showTitle(); },
    onStateChange: (_s) => { /* tracked internally */ },
    onPong: (_rtt) => { /* could display ping */ },
  });
}

const menu = new Menu(overlay, {
  onStartLocal: (cfg) => {
    clearSessions();
    session = new MatchSession(canvas, overlay, audio);
    session.start(cfg);
  },
  onJoin: (opts, ui) => { connect(opts.url, opts.name, ui); },
  // Online (WebRTC P2P) and the in-browser host's own player both reach the match here.
  onRemoteMatch: (t, startMsg) => { enterRemoteMatch(t, startMsg); },
});

// A page opened with a `#join=<code>` fragment (a shared online invite) jumps straight to the Join
// Online screen with the invite pre-filled (spec §24 T33-C2).
function maybeJoinFragment(): boolean {
  const hash = window.location.hash || "";
  const m = hash.match(/[#&]join=([^#&]+)/);
  if (!m) return false;
  menu.showJoinOnline(decodeURIComponent(m[1]));
  return true;
}

// If this page was opened from a host's shared link/QR (carries ?room=) or was served by the Node
// host itself, skip the title menu and connect straight to the lobby. window.location.origin is the
// correct address in both cases: the host's own browser uses http://localhost:<port> (loopback →
// slot 0), remote devices use http://<lan-ip>:<port>.
function maybeAutoJoin(): boolean {
  const info = window.__MYS_HOST__;
  const params = new URLSearchParams(window.location.search);
  const hasRoom = params.has("room");
  if (!info?.servedByHost && !hasRoom) return false;

  const origin = window.location.origin && window.location.origin !== "null"
    ? window.location.origin
    : (info?.lanUrl || "");
  if (!origin) return false;

  const doJoin = () => {
    const ui = menu.showConnecting(origin, doJoin, () => { clearSessions(); menu.showTitle(); });
    connect(origin, defaultName(), ui);
  };
  doJoin();
  return true;
}

if (!maybeJoinFragment() && !maybeAutoJoin()) menu.showTitle();
