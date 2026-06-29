// MYS Generals — online split-screen + host-ready/start test (spec §21, §24 T33).
// Drives GameHost over a mock peer sink with TWO local players on one device (the host's own
// player A in slot 0, and a 2nd local player B in slot 1 — the in-browser host's split-screen
// mechanism), and verifies the host-ready/start gating fix: the host must be ready (its Start
// implies readiness) before a match can begin, while the local Player B is auto-readied on join.
// Run: NODE_OPTIONS="" node test/splithost.mjs
import { GameHost } from "../dist/host/gameHost.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

const log = new Map();
const sink = {
  send(peerId, msg) { (log.get(peerId) ?? log.set(peerId, []).get(peerId)).push(msg); },
  disconnect() { /* unused */ },
};
const last = (peerId, m) => { const a = (log.get(peerId) ?? []).filter((x) => x.m === m); return a[a.length - 1]; };

const host = new GameHost(sink, { hostUrl: "", map: "twin_rivers", roomCode: "SPLT" });

console.log("Two LOCAL players on one device (online split-screen mechanism):");
// Player A — the host's own browser (loopback → claims slot 0).
host.onPeerConnect("A", true);
host.onPeerMessageObject("A", { m: "hello", name: "Host" });
assert(last("A", "welcome").playerId === 0, "Player A (host) claims slot 0");
// Player B — a 2nd LOCAL player on the SAME device (loopback peer, not the host slot).
host.onPeerConnect("B", false);
host.onPeerMessageObject("B", { m: "hello", name: "Player 2" });
assert(last("B", "welcome").playerId === 1, "Player B (local 2nd player) claims slot 1");

console.log("Player B is auto-readied on join; the host is gated until it readies:");
host.onPeerMessageObject("B", { m: "lobby", action: { a: "ready", ready: true } }); // auto-ready (local)
assert(host.lobby.state.slots[1].ready === true, "Player B is ready");
assert(host.lobby.canStart() === false, "match is GATED while the host (slot 0) is not ready");

console.log("Host Start implies readiness (ready → start), then the match begins:");
// Mirrors the menu's host Start handler: send ready, then start.
host.onPeerMessageObject("A", { m: "lobby", action: { a: "ready", ready: true } });
assert(host.lobby.canStart() === true, "canStart once the host is ready too");
host.onPeerMessageObject("A", { m: "lobby", action: { a: "start" } });
assert(host.running, "the match started (tick loop armed)");

console.log("Both local players receive their own start + fog-filtered snapshot:");
const sA = last("A", "start"); const sB = last("B", "start");
assert(sA && sA.you === 0, "Player A receives start with you=0");
assert(sB && sB.you === 1, "Player B receives start with you=1");
const snapA = last("A", "snapshot"); const snapB = last("B", "snapshot");
assert(snapA && snapB, "both local players received a primed snapshot");
assert(snapA.data.entities.every((e) => e.o === 0), "Player A's snapshot only contains its own visible units (fog)");
assert(snapB.data.entities.every((e) => e.o === 1), "Player B's snapshot only contains its own visible units (fog)");

host.shutdown();
console.log("");
if (failures === 0) { console.log("ALL SPLITHOST TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " SPLITHOST TEST(S) FAILED ✗"); process.exit(1); }
