export class SocketTransport {
    get playerId() { return this._playerId; }
    get token() { return this._token; }
    get state() { return this._state; }
    constructor(url, name, cb, existingToken) {
        this.ws = null;
        this._playerId = -1;
        this._token = "";
        this.clientTick = 0;
        this.snapCb = null;
        this.evCb = null;
        this._state = "connecting";
        this.pingInterval = null;
        this.reconnectTimer = null;
        this._closed = false;
        this.reconnectAttempts = 0;
        this.MAX_RECONNECT_ATTEMPTS = 8;
        this.wasPlaying = false; // track if we were in a match (for reconnect vs initial connect)
        this.gotWelcome = false; // reached the lobby at least once (→ distinguish "unreachable" from "host gone")
        this.url = url;
        this.name = name;
        this.cb = cb;
        this.existingToken = existingToken;
        this.connect();
    }
    setState(s) {
        this._state = s;
        this.cb.onStateChange?.(s);
    }
    connect() {
        if (this._closed)
            return;
        this.setState("connecting");
        // Convert http/https URL to ws/wss
        let wsUrl = this.url.replace(/^http/, "ws");
        // Ensure no trailing path issues
        if (!wsUrl.endsWith("/"))
            wsUrl += "/";
        try {
            this.ws = new WebSocket(wsUrl);
        }
        catch {
            this.setState("error");
            this.cb.onError?.("Failed to create WebSocket", "join.unreachable");
            return;
        }
        this.ws.onopen = () => {
            // Send hello
            const hello = { m: "hello", name: this.name, token: this.existingToken };
            this.ws.send(JSON.stringify(hello));
            this.startPing();
        };
        this.ws.onmessage = (ev) => {
            let msg;
            try {
                msg = JSON.parse(ev.data);
            }
            catch {
                return;
            }
            this.handleMessage(msg);
        };
        this.ws.onclose = () => {
            this.stopPing();
            if (this._closed)
                return;
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
            }
            else if (!this.gotWelcome) {
                // Closed before we ever reached the lobby → the host was unreachable / refused the
                // connection (wrong address, not the same Wi‑Fi, firewall) — spec §24 T25 clearer errors.
                this.setState("error");
                this.cb.onError?.("Could not reach the host", "join.unreachable");
            }
            else {
                // We were in the lobby and the host went away before the match started.
                this.setState("closed");
                this.cb.onHostGone?.();
            }
        };
        this.ws.onerror = () => {
            if (this._closed)
                return;
            // A WebSocket error is always followed by onclose; let onclose produce the precise message
            // (unreachable vs host-gone vs reconnecting) so we don't emit a vague duplicate here.
            this.setState("error");
        };
    }
    handleMessage(msg) {
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
                }
                else {
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
    sendCommand(cmd) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
        const wire = { playerId: this._playerId, clientTick: ++this.clientTick, cmd };
        const msg = { m: "cmd", data: wire };
        this.ws.send(JSON.stringify(msg));
    }
    onSnapshot(cb) { this.snapCb = cb; }
    onEvent(cb) { this.evCb = cb; }
    close() {
        this._closed = true;
        this.stopPing();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.close();
            }
            catch { /* */ }
            this.ws = null;
        }
        this.setState("closed");
    }
    // ---- Lobby actions (before match starts) ----
    sendLobbyAction(action) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
        const msg = { m: "lobby", action };
        this.ws.send(JSON.stringify(msg));
    }
    // ---- Ping / keep-alive ----
    startPing() {
        this.stopPing();
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const msg = { m: "ping", t: performance.now() };
                this.ws.send(JSON.stringify(msg));
            }
        }, 3000);
    }
    stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
}
