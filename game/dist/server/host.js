// MYS Generals — Node LAN host server (spec §20). Zero-dependency: uses only Node built-ins
// (http, crypto, fs, path, os, net) for WebSocket (RFC 6455) + static file serving.
//
// As of T33 the authoritative message loop lives in the engine/DOM/Node-agnostic GameHost
// (src/host/gameHost.ts); this file is now just the LAN DRIVER — it accepts RFC-6455 WebSocket
// peers, forwards their bytes into GameHost, and implements GameHost's HostPeerSink by framing
// ServerMsgs back over the sockets. The exact same GameHost also powers the in-browser online
// host (T33), so the LAN path regresses with ZERO behaviour change.
//
// Usage: NODE_OPTIONS="" node dist/server/host.js [port]
// The server prints the join URL, QR (ASCII), and room code to the terminal.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { GameHost } from "../host/gameHost.js";
import { qrAscii, qrMatrix } from "../net/qr.js";
// ============ Utilities ============
function getLanIp() {
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const info of ifaces[name]) {
            if (info.family === "IPv4" && !info.internal)
                return info.address;
        }
    }
    return "127.0.0.1";
}
function randomToken() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < 24; i++)
        s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}
function acceptWebSocket(req, socket, head) {
    const key = req.headers["sec-websocket-key"];
    if (!key)
        return null;
    const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-5AB4ADE8E34E")
        .digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = {
        id: randomToken(),
        socket,
        alive: true,
        send(msg) {
            if (!this.alive)
                return;
            try {
                sendFrame(socket, JSON.stringify(msg));
            }
            catch {
                this.alive = false;
            }
        },
        close() {
            this.alive = false;
            try {
                socket.end();
            }
            catch { /* */ }
        },
    };
    return conn;
}
function sendFrame(socket, data) {
    const buf = Buffer.from(data, "utf8");
    const len = buf.length;
    let header;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // FIN + text
        header[1] = len;
    }
    else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    }
    else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    socket.write(header);
    socket.write(buf);
}
function parseFrames(socket, onMessage, onClose, onPing) {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
            if (buffer.length < 2)
                return;
            const first = buffer[0];
            const masked = (buffer[1] & 0x80) !== 0;
            let payloadLen = buffer[1] & 0x7f;
            let offset = 2;
            if (payloadLen === 126) {
                if (buffer.length < 4)
                    return;
                payloadLen = buffer.readUInt16BE(2);
                offset = 4;
            }
            else if (payloadLen === 127) {
                if (buffer.length < 10)
                    return;
                payloadLen = Number(buffer.readBigUInt64BE(2));
                offset = 10;
            }
            const maskLen = masked ? 4 : 0;
            const totalLen = offset + maskLen + payloadLen;
            if (buffer.length < totalLen)
                return;
            const mask = masked ? buffer.slice(offset, offset + maskLen) : null;
            const payload = buffer.slice(offset + maskLen, offset + maskLen + payloadLen);
            if (mask)
                for (let i = 0; i < payload.length; i++)
                    payload[i] ^= mask[i % 4];
            buffer = buffer.slice(totalLen);
            const opcode = first & 0x0f;
            if (opcode === 0x01) { // text
                onMessage(payload.toString("utf8"));
            }
            else if (opcode === 0x08) { // close
                onClose();
                return;
            }
            else if (opcode === 0x09) { // ping
                onPing();
                // respond with pong
                const pong = Buffer.alloc(2 + payloadLen);
                pong[0] = 0x8a;
                pong[1] = payloadLen;
                payload.copy(pong, 2);
                try {
                    socket.write(pong);
                }
                catch { /* */ }
            }
            else if (opcode === 0x0a) { // pong — ignore
            }
        }
    });
    socket.on("close", onClose);
    socket.on("error", onClose);
}
// ============ Server state ============
// The compiled server lives at  game/dist/server/host.js , but the web root (index.html,
// styles.css, fonts) and the client bundle (dist/main.js) are served from the GAME ROOT
// (game/). So ROOT must climb TWO levels: dist/server -> dist -> game.  (Spec §24 T25 root
// cause #1: the previous single ".." resolved to game/dist and every asset 404'd over the LAN.)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 3000;
const IP = getLanIp();
const HOST_URL = `http://${IP}:${PORT}`;
// The authoritative game host (transport-agnostic). Its HostPeerSink maps GameHost's abstract
// peerIds to the live WebSocket connections.
const conns = new Map();
const sink = {
    send(peerId, msg) { conns.get(peerId)?.send(msg); },
    disconnect(peerId) { conns.get(peerId)?.close(); },
};
const gameHost = new GameHost(sink, { hostUrl: HOST_URL });
// True when the request arrives from the loopback interface (the host's own browser).
function isLoopbackReq(req) {
    const a = req.socket.remoteAddress || "";
    return a === "::1" || a === "127.0.0.1" || a.endsWith(":127.0.0.1") || a.includes("127.0.0.1");
}
// Injected into the served index.html so the browser knows it was served by the real LAN host
// (→ auto-join, spec §24 T25) and learns the host's true LAN URL/room to surface in the lobby —
// never a hardcoded localhost. The static `serve.mjs` (local-only play) does NOT inject this.
function hostInfoScript() {
    const info = { lanUrl: HOST_URL, ip: IP, port: PORT, room: gameHost.lobby.state.roomCode, servedByHost: true };
    return `<script>window.__MYS_HOST__=${JSON.stringify(info)};</script>`;
}
function onClientConnect(conn, req) {
    conns.set(conn.id, conn);
    gameHost.onPeerConnect(conn.id, isLoopbackReq(req));
    parseFrames(conn.socket, (raw) => gameHost.onPeerMessage(conn.id, raw), () => { conn.alive = false; conns.delete(conn.id); gameHost.onPeerDisconnect(conn.id); }, () => { });
}
// ============ HTTP server (static files + WebSocket upgrade) ============
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8",
};
const server = createServer(async (req, res) => {
    try {
        let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        if (urlPath === "/" || urlPath === "")
            urlPath = "/index.html";
        const safe = normalize(join(ROOT, urlPath));
        if (!safe.startsWith(ROOT)) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }
        let target = safe;
        try {
            const s = await stat(target);
            if (s.isDirectory())
                target = join(target, "index.html");
        }
        catch { /* fall through */ }
        const data = await readFile(target);
        const ext = extname(target).toLowerCase();
        const type = MIME[ext] || "application/octet-stream";
        let body = data;
        if (ext === ".html") {
            // Stamp the host's real LAN info into the page (root cause #3) and mark it as served by the
            // network host so the client auto-joins (spec §24 T25).
            let html = data.toString("utf8");
            const tag = hostInfoScript();
            if (html.includes("</head>"))
                html = html.replace("</head>", `  ${tag}\n</head>`);
            else if (html.includes("</body>"))
                html = html.replace("</body>", `${tag}\n</body>`);
            else
                html = tag + html;
            body = html;
        }
        res.writeHead(200, {
            "Content-Type": type,
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        });
        res.end(body);
    }
    catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
    }
});
server.on("upgrade", (req, socket, head) => {
    const conn = acceptWebSocket(req, socket, head);
    if (!conn) {
        socket.end();
        return;
    }
    onClientConnect(conn, req);
});
server.listen(PORT, () => {
    const joinUrl = `${HOST_URL}/?room=${gameHost.lobby.state.roomCode}`;
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  MYS Generals — LAN Host Server");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`  Join URL : ${joinUrl}`);
    console.log(`  Room code: ${gameHost.lobby.state.roomCode}`);
    console.log(`  Port     : ${PORT}`);
    console.log("───────────────────────────────────────────────────────────────");
    console.log("  Scan this QR code to join:");
    console.log("");
    const m = qrMatrix(joinUrl);
    if (m)
        console.log(qrAscii(m));
    console.log("");
    console.log("  Waiting for players... (Ctrl+C to stop)");
    console.log("═══════════════════════════════════════════════════════════════");
});
// ============ Graceful shutdown: broadcast hostgone to all clients (spec §20.5) ============
function shutdown() {
    console.log("\n  Shutting down — notifying clients...");
    gameHost.shutdown();
    setTimeout(() => { server.close(); process.exit(0); }, 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
