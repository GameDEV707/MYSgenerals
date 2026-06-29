// MYS Generals — T25 LAN connectivity test (spec §24 T25, §3.2, §20).
// Spawns the REAL Node host (dist/server/host.js) and verifies over the loopback interface:
//   1. Static serving from the GAME ROOT: / → 200 (index.html), /dist/main.js → 200,
//      /styles.css → 200, and an unknown path → 404 (the T25 web-root fix).
//   2. The host-info marker (window.__MYS_HOST__ / servedByHost:true) is injected into the page,
//      which is what makes a device opening the shared link auto-join.
//   3. The host's own browser (loopback) takes slot 0; a second device takes slot 1 (thin clients).
//   4. The broadcast lobby never leaks per-slot reconnection tokens (§20.3, host-side only).
// Run: NODE_OPTIONS="" node test/lan.mjs
import { spawn } from "node:child_process";
import { get } from "node:http";
import * as net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 3517; // an out-of-the-way port for the test host

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = get({ host: "127.0.0.1", port: PORT, path }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", body }));
    });
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("http timeout")));
  });
}

async function waitForServer(retries = 50) {
  for (let i = 0; i < retries; i++) {
    try { const r = await httpGet("/"); if (r.status === 200) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// --- Minimal raw WebSocket client (mirrors test/net.mjs) ---
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
        if (opcode === 0x01) {
          try {
            const msg = JSON.parse(payload.toString("utf8"));
            if (waiters.length > 0) { const w = waiters.shift(); clearTimeout(w.timer); w.resolve(msg); }
            else messages.push(msg);
          } catch { /* ignore non-JSON */ }
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
    socket.on("close", () => { /* */ });

    const conn = {
      send(obj) {
        const data = Buffer.from(JSON.stringify(obj), "utf8");
        const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
        const masked = Buffer.alloc(data.length);
        for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
        let header;
        if (data.length < 126) { header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | data.length; mask.copy(header, 2); }
        else { header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); mask.copy(header, 4); }
        socket.write(Buffer.concat([header, masked]));
      },
      recv(timeoutMs = 3000) {
        if (messages.length > 0) return Promise.resolve(messages.shift());
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { const idx = waiters.findIndex((w) => w.resolve === res); if (idx >= 0) waiters.splice(idx, 1); rej(new Error("recv timeout")); }, timeoutMs);
          waiters.push({ resolve: res, timer });
        });
      },
      close() { socket.end(); },
      socket,
    };
  });
}

const server = spawn(process.execPath, [join(HERE, "..", "dist", "server", "host.js"), String(PORT)], {
  env: { ...process.env, NODE_OPTIONS: "", PORT: String(PORT) },
  stdio: "ignore",
});
function cleanup(code) { try { server.kill("SIGTERM"); } catch { /* */ } process.exit(code); }

(async () => {
  const up = await waitForServer();
  assert(up, "host server (dist/server/host.js) started and answers on port " + PORT);
  if (!up) return cleanup(1);

  console.log("Static serving — web root is the game root, not dist/ (§24 T25 root cause #1):");
  const root = await httpGet("/");
  assert(root.status === 200, "GET / → 200");
  assert(/text\/html/.test(root.type), "GET / is served as text/html");
  assert(/id="game-canvas"/.test(root.body) && /dist\/main\.js/.test(root.body), "GET / returns the game index.html");
  const mainjs = await httpGet("/dist/main.js");
  assert(mainjs.status === 200, "GET /dist/main.js → 200 (the bundle is reachable over the LAN)");
  const css = await httpGet("/styles.css");
  assert(css.status === 200, "GET /styles.css → 200 (the stylesheet is reachable over the LAN)");
  const bogus = await httpGet("/definitely-not-here.bogus");
  assert(bogus.status === 404, "GET /<unknown> → 404 (missing/traversal guard)");

  console.log("Host-info marker — enables auto-join from the shared link/QR (root cause #3):");
  assert(/__MYS_HOST__/.test(root.body), "served page injects window.__MYS_HOST__");
  assert(/"servedByHost"\s*:\s*true/.test(root.body), "marker reports servedByHost:true so the client auto-joins");
  assert(/"port"\s*:\s*\d+/.test(root.body) && /"room"\s*:/.test(root.body), "marker carries port + room for the lobby link");

  console.log("Thin clients — host's own browser is slot 0, next device is slot 1 (§3.2):");
  const c0 = await wsConnect(PORT);
  c0.send({ m: "hello", name: "HostBrowser" });
  const w0 = await c0.recv();
  assert(w0.m === "welcome", "host browser receives welcome — got m=" + w0.m);
  assert(w0.playerId === 0, "host's own (loopback) browser is assigned slot 0 — got " + w0.playerId);
  let lob0 = await c0.recv();
  while (lob0 && lob0.m !== "lobby") lob0 = await c0.recv();
  assert(lob0 && lob0.m === "lobby", "host browser then receives a lobby snapshot");

  const c1 = await wsConnect(PORT);
  c1.send({ m: "hello", name: "Phone" });
  const w1 = await c1.recv();
  assert(w1.m === "welcome", "second device receives welcome — got m=" + w1.m);
  assert(w1.playerId === 1, "second device is assigned slot 1 — got " + w1.playerId);
  let lob1 = await c1.recv();
  while (lob1 && lob1.m !== "lobby") lob1 = await c1.recv();

  console.log("Token privacy — reconnection tokens never broadcast (§20.3):");
  assert(lob1.state && Array.isArray(lob1.state.slots), "lobby snapshot carries the slot list");
  const leak = (lob1.state?.slots || []).some((s) => "token" in s && s.token !== undefined);
  assert(!leak, "broadcast lobby leaks NO slot reconnection token");
  const hostSlot = lob1.state.slots.find((s) => s.index === 0);
  const phoneSlot = lob1.state.slots.find((s) => s.index === 1);
  assert(hostSlot && hostSlot.kind === "human", "slot 0 is the human host");
  assert(phoneSlot && phoneSlot.kind === "human", "slot 1 is the joined human device");

  c0.close(); c1.close();
  console.log("");
  if (failures === 0) { console.log("ALL LAN TESTS PASSED ✓"); return cleanup(0); }
  console.error(failures + " LAN TEST(S) FAILED ✗"); return cleanup(1);
})().catch((e) => { console.error("LAN test crashed:", e); cleanup(1); });
