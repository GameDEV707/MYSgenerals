// In-process transport (no serialization). The client and host live in the same JS context.
export class LoopbackTransport {
    constructor(playerId, sink) {
        this.clientTick = 0;
        this.snapCb = null;
        this.evCb = null;
        this.playerId = playerId;
        this.sink = sink;
    }
    sendCommand(cmd) {
        this.sink.submit({ playerId: this.playerId, clientTick: ++this.clientTick, cmd });
    }
    onSnapshot(cb) { this.snapCb = cb; }
    onEvent(cb) { this.evCb = cb; }
    close() { this.snapCb = null; this.evCb = null; }
    // Host → client (called by MatchHost).
    pushSnapshot(s) { this.snapCb?.(s); }
    pushEvent(e) { this.evCb?.(e); }
}
