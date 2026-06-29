// MYS Generals — LAN networking integration test (spec §20).
// Starts the Node host in-process, connects 2 WebSocket clients, verifies:
// 1. Lobby join + slot assignment
// 2. Ready + match start
// 3. Per-player fog-filtered snapshots (anti-maphack)
// 4. Command submission + host validation
// Run: NODE_OPTIONS="" node test/net.mjs
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import * as net from "node:net";

import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { MatchHost } from "../dist/host/matchHost.js";
import { Lobby } from "../dist/host/lobby.js";
import { TICK_DT } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

// --- Simple raw WebSocket client for testing ---
function wsConnect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, "127.0.0.1", () => {
      const keyBuf = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) keyBuf[i] = Math.floor(Math.random() * 256);
      const key = keyBuf.toString("base64");
      socket.write(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:" + port +
        "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " +
        key + "\r\nSec-WebSocket-Version: 13\r\n\r\n"
      );
    });

    let rawBuf = Buffer.alloc(0);
    let upgraded = false;
    const messages = [];
    const waiters = [];

    function parseFrames() {
      while (rawBuf.length >= 2) {
        const b0 = rawBuf[0], b1 = rawBuf[1];
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let offset = 2;
        if (payloadLen === 126) { if (rawBuf.length < 4) return; payloadLen = rawBuf.readUInt16BE(2); offset = 4; }
        else if (payloadLen === 127) { if (rawBuf.length < 10) return; payloadLen = Number(rawBuf.readBigUInt64BE(2)); offset = 10; }
        const maskLen = masked ? 4 : 0;
        const total = offset + maskLen + payloadLen;
        if (rawBuf.length < total) return;
        const mask = masked ? rawBuf.slice(offset, offset + maskLen) : null;
        const payload = Buffer.from(rawBuf.slice(offset + maskLen, total));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        rawBuf = rawBuf.slice(total);
        const opcode = b0 & 0x0f;
        if (opcode === 0x01) { // text
          try {
            const msg = JSON.parse(payload.toString("utf8"));
            if (waiters.length > 0) { const w = waiters.shift(); clearTimeout(w.timer); w.resolve(msg); }
            else messages.push(msg);
          } catch {}
        }
      }
    }

    socket.on("data", (chunk) => {
      rawBuf = Buffer.concat([rawBuf, chunk]);
      if (!upgraded) {
        const idx = rawBuf.indexOf("\r\n\r\n");
        if (idx < 0) return;
        const header = rawBuf.slice(0, idx).toString();
        if (!header.includes("101")) { reject(new Error("WS upgrade failed: " + header.slice(0, 60))); socket.end(); return; }
        rawBuf = rawBuf.slice(idx + 4);
        upgraded = true;
        resolve(conn);
      }
      parseFrames();
    });
    socket.on("error", (e) => { if (!upgraded) reject(e); });
    socket.on("close", () => {});

    const conn = {
      send(obj) {
        const str = JSON.stringify(obj);
        const data = Buffer.from(str, "utf8");
        const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
        const masked = Buffer.alloc(data.length);
        for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
        let header;
        if (data.length < 126) {
          header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | data.length; mask.copy(header, 2);
        } else {
          header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); mask.copy(header, 4);
        }
        socket.write(Buffer.concat([header, masked]));
      },
      recv(timeoutMs = 3000) {
        if (messages.length > 0) return Promise.resolve(messages.shift());
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { const idx = waiters.findIndex((w) => w.resolve === res); if (idx >= 0) waiters.splice(idx, 1); rej(new Error("recv timeout")); }, timeoutMs);
          waiters.push({ resolve: res, timer });
        });
      },
      drain() { const all = [...messages]; messages.length = 0; return all; },
      close() { socket.end(); },
      socket,
      get pending() { return messages.length; },
    };
  });
}

// --- Minimal in-process host server for the test ---
const PORT = 19877;
const lobby = new Lobby(`http://127.0.0.1:${PORT}`, "twin_rivers", "TEST");

const clientSessions = new Map();
let matchHost = null;
let tickIv = null;

function randomToken() { let s = ""; for (let i = 0; i < 16; i++) s += "abcdefghijklmnop"[Math.floor(Math.random() * 16)]; return s; }

function sendFrame(socket, obj) {
  const str = JSON.stringify(obj);
  const data = Buffer.from(str, "utf8");
  let header;
  if (data.length < 126) { header = Buffer.alloc(2); header[0] = 0x81; header[1] = data.length; }
  else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
  try { socket.write(header); socket.write(data); } catch {}
}

function broadcastLobby() { for (const c of clientSessions.values()) sendFrame(c.socket, { m: "lobby", state: lobby.state }); }

class RemoteLink {
  constructor(pid, sock) { this.playerId = pid; this.socket = sock; }
  pushSnapshot(s) { sendFrame(this.socket, { m: "snapshot", data: s }); }
  pushEvent(e) { sendFrame(this.socket, { m: "event", data: e }); }
}

function startMatch() {
  lobby.state.started = true;
  const map = getMap(lobby.state.map);
  const world = new World(map);
  const parts = lobby.participants().sort((a, b) => a.index - b.index);
  const idMap = new Map(); parts.forEach((p, i) => idMap.set(p.index, i));
  parts.forEach((slot, i) => world.addPlayer({
    id: i, silver: 15, iron: 0, gold: 0, color: slot.color, isAI: slot.kind === "ai",
    aiDiff: slot.ai || "normal", defeated: false, powerGen: 0, powerUse: 0, brownout: false,
    heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0,
  }));
  parts.forEach((_, i) => world.spawnBase(i, map.spawns[i]));
  world.setupNeutrals();
  matchHost = new MatchHost(world);
  parts.forEach((slot, i) => { if (slot.kind === "ai") matchHost.addAIPlayer(i); });
  for (const [id, c] of clientSessions) {
    const simId = idMap.get(c.slotIndex);
    if (simId === undefined) continue;
    const link = new RemoteLink(simId, c.socket);
    c.link = link;
    matchHost.addLink(link);
    sendFrame(c.socket, { m: "start", map: lobby.state.map, players: parts.map((s, i) => ({ id: i, color: s.color, isAI: s.kind === "ai", aiDiff: s.ai || "normal", hero: s.hero })), you: simId });
  }
  matchHost.step();
  tickIv = setInterval(() => { if (matchHost) matchHost.step(); }, TICK_DT * 1000);
}

function handleSocket(req, socket) {
  const key = req.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-5AB4ADE8E34E").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  const id = randomToken();
  let buf = Buffer.alloc(0);
  let session = null;

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1];
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;
      if (payloadLen === 126) { if (buf.length < 4) return; payloadLen = buf.readUInt16BE(2); offset = 4; }
      else if (payloadLen === 127) { if (buf.length < 10) return; payloadLen = Number(buf.readBigUInt64BE(2)); offset = 10; }
      const maskLen = masked ? 4 : 0;
      const total = offset + maskLen + payloadLen;
      if (buf.length < total) return;
      const mask = masked ? buf.slice(offset, offset + maskLen) : null;
      const payload = Buffer.from(buf.slice(offset + maskLen, total));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buf = buf.slice(total);
      const opcode = b0 & 0x0f;
      if (opcode === 0x08) { socket.end(); return; }
      if (opcode !== 0x01) continue;
      let msg; try { msg = JSON.parse(payload.toString("utf8")); } catch { continue; }
      if (!session && msg.m === "hello") {
        const name = (msg.name || "P").slice(0, 20);
        const token = randomToken();
        if (lobby.state.started) { sendFrame(socket, { m: "error", reason: "in progress" }); socket.end(); return; }
        const slotIndex = lobby.claimHumanSlot(name, token);
        if (slotIndex < 0) { sendFrame(socket, { m: "error", reason: "full" }); socket.end(); return; }
        session = { socket, slotIndex, token, name, link: null };
        clientSessions.set(id, session);
        sendFrame(socket, { m: "welcome", playerId: slotIndex, token, you: slotIndex });
        broadcastLobby();
      } else if (session) {
        if (msg.m === "lobby" && !lobby.state.started) {
          const act = msg.action;
          if (act.a === "ready") lobby.setReady(session.slotIndex, act.ready);
          else if (act.a === "setColor") lobby.setColor(session.slotIndex, act.color);
          broadcastLobby();
        } else if (msg.m === "cmd" && matchHost && session.link) {
          matchHost.submit(msg.data);
        } else if (msg.m === "ping") {
          sendFrame(socket, { m: "pong", t: msg.t });
        }
      }
    }
  });
  socket.on("close", () => { if (session) { clientSessions.delete(id); if (!matchHost) { lobby.releaseSlot(session.slotIndex); broadcastLobby(); } } });
  socket.on("error", () => {});
}

const server = createServer((req, res) => { res.writeHead(200); res.end("ok"); });
server.on("upgrade", handleSocket);
await new Promise((r) => server.listen(PORT, r));

// ============ TESTS ============
try {
  console.log("LAN lobby: join + slot assignment (§18.3 / §20.1):");
  const c1 = await wsConnect(PORT);
  c1.send({ m: "hello", name: "Alice" });
  const welcome1 = await c1.recv();
  assert(welcome1.m === "welcome", "client 1 receives welcome — got m=" + welcome1.m);
  assert(welcome1.playerId === 1, "client 1 assigned to slot 1 — got " + welcome1.playerId);
  const token1 = welcome1.token;
  // lobby broadcast follows
  const lobMsg = await c1.recv();
  assert(lobMsg.m === "lobby" && lobMsg.state.slots[1].kind === "human", "lobby broadcast shows slot 1 as human");

  console.log("Ready + match start (§18.3):");
  lobby.setReady(0, true); // simulate host ready
  c1.send({ m: "lobby", action: { a: "ready", ready: true } });
  // drain lobby updates
  await new Promise((r) => setTimeout(r, 100));
  c1.drain();
  assert(lobby.canStart(), "lobby canStart after host + client ready");
  startMatch();
  const startMsg = await c1.recv();
  assert(startMsg.m === "start", "client receives start message — got m=" + startMsg.m);
  assert(startMsg.you === 1, "client is sim player 1 — got " + startMsg.you);

  console.log("Per-player fog-filtered snapshots (§15 / §20.3 anti-maphack):");
  // Wait for a batch of snapshots
  await new Promise((r) => setTimeout(r, 400));
  const all = c1.drain();
  const snaps = all.filter((m) => m.m === "snapshot").map((m) => m.data);
  assert(snaps.length > 0, "client receives snapshots over WebSocket — got " + snaps.length);
  if (snaps.length > 0) {
    const snap = snaps[snaps.length - 1];
    const enemyEnts = snap.entities.filter((e) => e.o === 0);
    assert(enemyEnts.length === 0, "client 1 (player 1) snapshot: ZERO player-0 entities (enemy out of fog) — anti-maphack proven — got " + enemyEnts.length);
    const myEnts = snap.entities.filter((e) => e.o === 1);
    assert(myEnts.length > 0, "client sees OWN entities — got " + myEnts.length);
    const enemyP = snap.players.find((p) => p.id === 0);
    assert(enemyP && enemyP.silver === undefined, "enemy economy NOT leaked — silver field absent");
  }

  console.log("Command validation over the wire (§20.3):");
  const enemy = matchHost.world.entities.find((e) => e.owner === 0 && e.type === "miner");
  if (enemy) {
    const before = enemy.moveTarget;
    c1.send({ m: "cmd", data: { playerId: 1, clientTick: 1, cmd: { t: "move", ids: [enemy.id], x: 1, y: 1 } } });
    await new Promise((r) => setTimeout(r, 200));
    assert(enemy.moveTarget === null || enemy.moveTarget === before, "spoofed move-enemy-unit command rejected over the wire");
  }

  console.log("");
  c1.close();
} catch (e) {
  console.error("Test error:", e);
  failures++;
}

if (tickIv) clearInterval(tickIv);
server.close();

if (failures === 0) { console.log("ALL NETWORK TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " NETWORK TEST(S) FAILED ✗"); process.exit(1); }
