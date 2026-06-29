// MYS Generals — Node LAN host server (spec §20). Zero-dependency: uses only Node built-ins
// (http, crypto, fs, path, os, net) for WebSocket (RFC 6455) + static file serving.
// Runs the authoritative simulation via MatchHost, broadcasts per-player fog-filtered snapshots,
// and manages the lobby. Clients connect via raw WebSocket from a browser on the same LAN.
//
// Usage: NODE_OPTIONS="" node dist/server/host.js [port]
// The server prints the join URL, QR (ASCII), and room code to the terminal.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { World } from "../sim/world.js";
import { getMap } from "../sim/map.js";
import { MatchHost } from "../host/matchHost.js";
import { Lobby } from "../host/lobby.js";
import { qrAscii, qrMatrix } from "../net/qr.js";
import { TICK_DT } from "../constants.js";
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
// ============ Remote client link (implements HostLink for MatchHost) ============
class RemoteLink {
    constructor(playerId, conn) {
        this.playerId = playerId;
        this.conn = conn;
    }
    pushSnapshot(s) {
        this.conn.send({ m: "snapshot", data: s });
    }
    pushEvent(e) {
        this.conn.send({ m: "event", data: e });
    }
}
// The compiled server lives at  game/dist/server/host.js , but the web root (index.html,
// styles.css, fonts) and the client bundle (dist/main.js) are served from the GAME ROOT
// (game/). So ROOT must climb TWO levels: dist/server -> dist -> game.  (Spec §24 T25 root
// cause #1: the previous single ".." resolved to game/dist and every asset 404'd over the LAN.)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 3000;
const IP = getLanIp();
const HOST_URL = `http://${IP}:${PORT}`;
const lobby = new Lobby(HOST_URL);
const clients = new Map(); // connId -> session
let matchHost = null;
let matchInterval = null;
// Slot 0 is reserved for the HOST (the machine running this server). The host's own browser
// — opened by launch.mjs at http://localhost:<port>/ — connects over loopback and takes slot 0,
// so the host plays as a thin SocketTransport client of its own authoritative server (spec §3.2 /
// §24 T25). Remote LAN devices take the next open slot.
let hostConnId = null;
// Reconnection grace: disconnected tokens kept alive for 30s
const graceTokens = new Map();
const GRACE_MS = 30000;
// True when the request arrives from the loopback interface (the host's own browser).
function isLoopbackReq(req) {
    const a = req.socket.remoteAddress || "";
    return a === "::1" || a === "127.0.0.1" || a.endsWith(":127.0.0.1") || a.includes("127.0.0.1");
}
// Build the public lobby state broadcast to clients: per-slot reconnection tokens are stripped so
// one client never sees another's token (spec §20.3 — token is host-side only).
function publicLobby() {
    return {
        ...lobby.state,
        slots: lobby.state.slots.map((s) => ({ ...s, token: undefined })),
    };
}
// Injected into the served index.html so the browser knows it was served by the real LAN host
// (→ auto-join, spec §24 T25) and learns the host's true LAN URL/room to surface in the lobby —
// never a hardcoded localhost. The static `serve.mjs` (local-only play) does NOT inject this.
function hostInfoScript() {
    const info = { lanUrl: HOST_URL, ip: IP, port: PORT, room: lobby.state.roomCode, servedByHost: true };
    return `<script>window.__MYS_HOST__=${JSON.stringify(info)};</script>`;
}
// ============ Lobby / match logic ============
function broadcastLobby() {
    const msg = { m: "lobby", state: publicLobby() };
    for (const c of clients.values())
        c.conn.send(msg);
}
function handleLobbyAction(session, action) {
    const st = lobby.state;
    const isHost = session.slotIndex === 0;
    switch (action.a) {
        case "setColor":
            lobby.setColor(session.slotIndex, action.color);
            break;
        case "setHero":
            lobby.setHero(session.slotIndex, action.hero);
            break;
        case "ready":
            lobby.setReady(session.slotIndex, action.ready);
            break;
        case "setName":
            lobby.setName(session.slotIndex, action.name);
            break;
        // host-only:
        case "setMap":
            if (isHost)
                lobby.setMap(action.map);
            break;
        case "addAI":
            if (isHost)
                lobby.addAI(action.diff);
            break;
        case "removeSlot":
            if (isHost)
                lobby.removeSlot(action.index);
            break;
        case "openSlot":
            if (isHost)
                lobby.openSlot(action.index);
            break;
        case "closeSlot":
            if (isHost)
                lobby.closeSlot(action.index);
            break;
        case "kick":
            if (isHost) {
                // disconnect the kicked client
                for (const [id, c] of clients)
                    if (c.slotIndex === action.index) {
                        c.conn.close();
                        clients.delete(id);
                    }
                lobby.kick(action.index);
            }
            break;
        case "setSplit":
            if (isHost)
                lobby.setSplit(action.on);
            break;
        case "start":
            if (isHost && lobby.canStart())
                startMatch();
            break;
    }
    broadcastLobby();
}
function startMatch() {
    if (matchHost)
        return;
    lobby.state.started = true;
    const map = getMap(lobby.state.map);
    const world = new World(map);
    const participants = lobby.participants();
    // Compact player ids to 0..n-1
    const idMap = new Map();
    participants.sort((a, b) => a.index - b.index);
    participants.forEach((p, i) => idMap.set(p.index, i));
    const mkPlayer = (slot, id) => ({
        id, silver: 15, iron: 0, gold: 0, color: slot.color, isAI: slot.kind === "ai",
        aiDiff: slot.ai || "normal", defeated: false,
        powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
        research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false },
        unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0,
    });
    participants.forEach((slot, i) => world.addPlayer(mkPlayer(slot, i)));
    participants.forEach((_, i) => world.spawnBase(i, map.spawns[i]));
    world.setupNeutrals();
    matchHost = new MatchHost(world);
    // Setup AI
    participants.forEach((slot, i) => { if (slot.kind === "ai")
        matchHost.addAIPlayer(i); });
    // Setup remote links for connected clients
    const startMsg = (you) => ({
        m: "start",
        map: lobby.state.map,
        players: participants.map((slot, i) => ({
            id: i, color: slot.color, isAI: slot.kind === "ai", aiDiff: slot.ai || "normal", hero: slot.hero,
        })),
        you,
    });
    for (const c of clients.values()) {
        const simId = idMap.get(c.slotIndex);
        if (simId === undefined)
            continue;
        const link = new RemoteLink(simId, c.conn);
        c.link = link;
        matchHost.addLink(link);
        c.conn.send(startMsg(simId));
    }
    // Tick the sim at 20 Hz
    matchHost.step(); // prime
    matchInterval = setInterval(() => {
        if (!matchHost)
            return;
        matchHost.step();
        // Check for host-gone (all remote clients disconnected AND no host local)
        if (matchHost.world.winner !== -2) {
            // match ended
            setTimeout(() => stopMatch(), 5000);
        }
    }, TICK_DT * 1000);
    broadcastLobby();
}
function stopMatch() {
    if (matchInterval) {
        clearInterval(matchInterval);
        matchInterval = null;
    }
    matchHost = null;
    lobby.state.started = false;
    // reset lobby
    for (const s of lobby.state.slots) {
        if (s.kind === "human" && s.index !== 0)
            s.ready = false;
    }
    broadcastLobby();
}
function handleClientMsg(session, raw) {
    let msg;
    try {
        msg = JSON.parse(raw);
    }
    catch {
        return;
    }
    switch (msg.m) {
        case "hello":
            // handled at connection time; ignore duplicates
            break;
        case "lobby":
            if (!lobby.state.started)
                handleLobbyAction(session, msg.action);
            break;
        case "cmd":
            if (matchHost && session.link) {
                matchHost.submit(msg.data);
            }
            break;
        case "ping":
            session.conn.send({ m: "pong", t: msg.t });
            break;
    }
}
function onClientConnect(conn, req) {
    let session = null;
    let helloReceived = false;
    parseFrames(conn.socket, (raw) => {
        if (!helloReceived) {
            // First message must be "hello"
            let msg;
            try {
                msg = JSON.parse(raw);
            }
            catch {
                conn.close();
                return;
            }
            if (msg.m !== "hello") {
                conn.close();
                return;
            }
            helloReceived = true;
            const name = (msg.name || "Player").slice(0, 20);
            let token = msg.token;
            // Check for reconnection via token
            if (token && graceTokens.has(token)) {
                const grace = graceTokens.get(token);
                clearTimeout(grace.timeout);
                graceTokens.delete(token);
                session = { conn, slotIndex: grace.slotIndex, token, name, link: null };
                clients.set(conn.id, session);
                if (grace.slotIndex === 0)
                    hostConnId = conn.id;
                lobby.state.slots[grace.slotIndex].kind = "human";
                lobby.state.slots[grace.slotIndex].name = name;
                lobby.state.slots[grace.slotIndex].ready = false;
                lobby.state.slots[grace.slotIndex].token = token;
                // If match is running, re-link
                if (matchHost) {
                    const participants = lobby.participants().sort((a, b) => a.index - b.index);
                    const simId = participants.findIndex((p) => p.index === grace.slotIndex);
                    if (simId >= 0) {
                        const link = new RemoteLink(simId, conn);
                        session.link = link;
                        matchHost.addLink(link);
                        // Send a full snapshot immediately so the client resyncs
                        const grid = matchHost.computeVisibility(simId);
                        conn.send({ m: "snapshot", data: matchHost.buildSnapshot(simId, grid) });
                    }
                    // Notify other players of the reconnection
                    for (const c of clients.values()) {
                        if (c !== session) {
                            c.conn.send({ m: "event", data: { e: "toast", key: "net.joined", kind: "ok", params: { name } } });
                        }
                    }
                }
                conn.send({ m: "welcome", playerId: grace.slotIndex, token, you: grace.slotIndex });
                broadcastLobby();
                return;
            }
            // New connection: claim a slot. The host's own browser is opened by launch.mjs at
            // http://localhost:<port>/ and connects over loopback — it takes slot 0 and plays as a thin
            // client of its own server (spec §3.2 / §24 T25). Remote LAN devices take the next open slot.
            if (lobby.state.started) {
                conn.send({ m: "error", reason: "Match already in progress", key: "join.started" });
                conn.close();
                return;
            }
            token = randomToken();
            let slotIndex;
            if (hostConnId === null && isLoopbackReq(req)) {
                slotIndex = lobby.claimHostSlot(name, token);
                if (slotIndex >= 0)
                    hostConnId = conn.id;
                else
                    slotIndex = lobby.claimHumanSlot(name, token);
            }
            else {
                slotIndex = lobby.claimHumanSlot(name, token);
            }
            if (slotIndex < 0) {
                conn.send({ m: "error", reason: "Lobby is full", key: "join.full" });
                conn.close();
                return;
            }
            session = { conn, slotIndex, token, name, link: null };
            clients.set(conn.id, session);
            conn.send({ m: "welcome", playerId: slotIndex, token, you: slotIndex });
            broadcastLobby();
            return;
        }
        if (session)
            handleClientMsg(session, raw);
    }, () => {
        conn.alive = false;
        if (!session)
            return;
        clients.delete(conn.id);
        if (matchHost && session.link) {
            // Match running: grace period for reconnection (spec §20.5)
            matchHost.removeLink(session.link);
            session.link = null;
            const token = session.token;
            const slotIdx = session.slotIndex;
            const playerName = session.name;
            // Notify other clients that this player dropped
            for (const c of clients.values()) {
                c.conn.send({ m: "event", data: { e: "toast", key: "net.left", kind: "warning", params: { name: playerName } } });
            }
            const timeout = setTimeout(() => {
                graceTokens.delete(token);
                lobby.releaseSlot(slotIdx);
                broadcastLobby();
            }, GRACE_MS);
            graceTokens.set(token, { slotIndex: slotIdx, timeout });
        }
        else {
            // In lobby: release the slot. If the host's own browser closed, free slot 0 (keep it shown as
            // "Host") so a reload reclaims it as the host rather than landing in a join slot.
            if (conn.id === hostConnId) {
                hostConnId = null;
                const s0 = lobby.state.slots[0];
                if (s0) {
                    s0.token = undefined;
                    s0.ready = false;
                }
            }
            else {
                lobby.releaseSlot(session.slotIndex);
            }
            broadcastLobby();
        }
    }, () => { });
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
    const joinUrl = `${HOST_URL}/?room=${lobby.state.roomCode}`;
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  MYS Generals — LAN Host Server");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`  Join URL : ${joinUrl}`);
    console.log(`  Room code: ${lobby.state.roomCode}`);
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
    const msg = { m: "hostgone" };
    for (const c of clients.values()) {
        try {
            c.conn.send(msg);
        }
        catch { /* */ }
    }
    if (matchInterval)
        clearInterval(matchInterval);
    setTimeout(() => { server.close(); process.exit(0); }, 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
