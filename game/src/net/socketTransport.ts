// MYS Generals — socket transport for LAN clients (spec §20.2). Connects to the
// authoritative Node host via native browser WebSocket. Implements the same ClientTransport
// interface as LoopbackTransport so the game client has exactly one code path.
import { Command, GameEvent, Snapshot, WireCommand, ClientMsg, ServerMsg, LobbyState } from "./protocol.js";
import { ClientTransport } from "./transport.js";

export type SocketState = "connecting" | "lobby" | "playing" | "reconnecting" | "closed" | "error";

export interface SocketTransportCallbacks {
  onWelcome?: (playerId: number, token: string) => void;
  onLobby?: (state: LobbyState) => void;
  onStart?: (msg: Extract<ServerMsg, { m: "start" }>) => void;
  onError?: (reason: string, key?: string) => void;
  onHostGone?: () => void;
  onStateChange?: (state: SocketState) => void;
  onPong?: (rtt: number) => void;
  onReconnected?: () => void;
}

export class SocketTransport implements ClientTransport {
  readonly url: string;
  private ws: WebSocket | null = null;
  private _playerId = -1;
  private _token = "";
  private clientTick = 0;
  private snapCb: ((s: Snapshot) => void) | null = null;
  private evCb: ((e: GameEvent) => void) | null = null;
  private cb: SocketTransportCallbacks;
  private _state: SocketState = "connecting";
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _closed = false;
  private name: string;
  private existingToken: string | undefined;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 8;
  private wasPlaying = false; // track if we were in a match (for reconnect vs initial connect)
  private gotWelcome = false; // reached the lobby at least once (→ distinguish "unreachable" from "host gone")

  get playerId(): number { return this._playerId; }
  get token(): string { return this._token; }
  get state(): SocketState { return this._state; }

  constructor(url: string, name: string, cb: SocketTransportCallbacks, existingToken?: string) {
    this.url = url;
    this.name = name;
    this.cb = cb;
    this.existingToken = existingToken;
    this.connect();
  }

  private setState(s: SocketState): void {
    this._state = s;
    this.cb.onStateChange?.(s);
  }

  private connect(): void {
    if (this._closed) return;
    this.setState("connecting");
    // Convert http/https URL to ws/wss
    let wsUrl = this.url.replace(/^http/, "ws");
    // Ensure no trailing path issues
    if (!wsUrl.endsWith("/")) wsUrl += "/";
    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.setState("error");
      this.cb.onError?.("Failed to create WebSocket", "join.unreachable");
      return;
    }
    this.ws.onopen = () => {
      // Send hello
      const hello: ClientMsg = { m: "hello", name: this.name, token: this.existingToken };
      this.ws!.send(JSON.stringify(hello));
      this.startPing();
    };
    this.ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      this.handleMessage(msg);
    };
    this.ws.onclose = () => {
      this.stopPing();
      if (this._closed) return;
      if (this._state === "playing" || this.wasPlaying) {
        // Try reconnection with exponential backoff (spec §20.5)
        this.wasPlaying = true;
        this.existingToken = this._token;
        if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
          this.setState("error");
          this.cb.onError?.("Reconnection failed after multiple attempts");
          this.cb.onHostGone?.();
          return;
        }
        this.reconnectAttempts++;
        const delay = Math.min(8000, 1000 * Math.pow(1.5, this.reconnectAttempts - 1));
        this.setState("reconnecting");
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      } else if (!this.gotWelcome) {
        // Closed before we ever reached the lobby → the host was unreachable / refused the
        // connection (wrong address, not the same Wi‑Fi, firewall) — spec §24 T25 clearer errors.
        this.setState("error");
        this.cb.onError?.("Could not reach the host", "join.unreachable");
      } else {
        // We were in the lobby and the host went away before the match started.
        this.setState("closed");
        this.cb.onHostGone?.();
      }
    };
    this.ws.onerror = () => {
      if (this._closed) return;
      // A WebSocket error is always followed by onclose; let onclose produce the precise message
      // (unreachable vs host-gone vs reconnecting) so we don't emit a vague duplicate here.
      this.setState("error");
    };
  }

  private handleMessage(msg: ServerMsg): void {
    switch (msg.m) {
      case "welcome":
        this._playerId = msg.playerId;
        this._token = msg.token;
        this.gotWelcome = true;
        if (this.wasPlaying) {
          // Successful reconnection — resume playing
          this.reconnectAttempts = 0;
          this.setState("playing");
          this.cb.onReconnected?.();
        } else {
          this.setState("lobby");
        }
        this.cb.onWelcome?.(msg.playerId, msg.token);
        break;
      case "lobby":
        this.cb.onLobby?.(msg.state);
        break;
      case "start":
        this.wasPlaying = true;
        this.reconnectAttempts = 0;
        this.setState("playing");
        this.cb.onStart?.(msg);
        break;
      case "snapshot":
        this.snapCb?.(msg.data);
        break;
      case "event":
        this.evCb?.(msg.data);
        break;
      case "pong":
        this.cb.onPong?.(performance.now() - msg.t);
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

  // ---- ClientTransport interface ----
  sendCommand(cmd: Command): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const wire: WireCommand = { playerId: this._playerId, clientTick: ++this.clientTick, cmd };
    const msg: ClientMsg = { m: "cmd", data: wire };
    this.ws.send(JSON.stringify(msg));
  }

  onSnapshot(cb: (s: Snapshot) => void): void { this.snapCb = cb; }
  onEvent(cb: (e: GameEvent) => void): void { this.evCb = cb; }

  close(): void {
    this._closed = true;
    this.stopPing();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* */ } this.ws = null; }
    this.setState("closed");
  }

  // ---- Lobby actions (before match starts) ----
  sendLobbyAction(action: import("./protocol.js").LobbyAction): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: ClientMsg = { m: "lobby", action };
    this.ws.send(JSON.stringify(msg));
  }

  // ---- Ping / keep-alive ----
  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const msg: ClientMsg = { m: "ping", t: performance.now() };
        this.ws.send(JSON.stringify(msg));
      }
    }, 3000);
  }
  private stopPing(): void {
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
  }
}
