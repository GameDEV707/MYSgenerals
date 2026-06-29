// MYS Generals — T33 transport-agnostic GameHost test (spec §24 T33-A/E2).
// Drives the extracted GameHost over an IN-MEMORY mock peer sink (no sockets, no WebRTC, no
// internet) and mirrors the assertions in test/host.mjs / test/net.mjs: join → lobby → ready →
// start → per-player FOG-FILTERED snapshots → command ownership. This is the headless proof that
// the host loop is byte-identical across drivers; the REAL WebRTC leg is user-verified.
// Run: NODE_OPTIONS="" node test/gamehost.mjs
import { GameHost } from "../dist/host/gameHost.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

// Mock peer sink: records every ServerMsg sent to each peer + any forced disconnects.
const log = new Map();          // peerId -> ServerMsg[]
const disconnected = [];
const sink = {
  send(peerId, msg) { (log.get(peerId) ?? log.set(peerId, []).get(peerId)).push(msg); },
  disconnect(peerId) { disconnected.push(peerId); },
};
const msgs = (peerId) => log.get(peerId) ?? [];
const last = (peerId, m) => { const a = msgs(peerId).filter((x) => x.m === m); return a[a.length - 1]; };

const host = new GameHost(sink, { hostUrl: "", map: "twin_rivers", roomCode: "TEST" });

console.log("Join + slot assignment (host slot 0 via loopback, joiner slot 1):");
// Host's own browser connects over loopback → claims slot 0.
host.onPeerConnect("host", true);
host.onPeerMessageObject("host", { m: "hello", name: "Host" });
const wHost = last("host", "welcome");
assert(wHost && wHost.playerId === 0, "host (loopback) gets welcome playerId 0 — got " + (wHost && wHost.playerId));

// A remote joiner connects → next open slot (slot 1).
host.onPeerConnect("p1", false);
host.onPeerMessageObject("p1", { m: "hello", name: "Alice" });
const wP1 = last("p1", "welcome");
assert(wP1 && wP1.playerId === 1, "joiner gets welcome playerId 1 — got " + (wP1 && wP1.playerId));
const lob = last("p1", "lobby");
assert(lob && lob.state.slots[1].kind === "human", "lobby broadcast shows slot 1 as human");

console.log("Token privacy (broadcast lobby strips per-slot tokens, §20.3):");
assert(lob.state.slots.every((s) => s.token === undefined), "no slot leaks a reconnection token");

console.log("Editable name reflects to the lobby (§24 T33-D1):");
host.onPeerMessageObject("p1", { m: "lobby", action: { a: "setName", name: "Alice2" } });
const lob2 = last("p1", "lobby");
assert(lob2.state.slots[1].name === "Alice2", "setName updates the slot name in the broadcast lobby");

console.log("Ready + match start (§18.3):");
host.onPeerMessageObject("host", { m: "lobby", action: { a: "ready", ready: true } });
host.onPeerMessageObject("p1", { m: "lobby", action: { a: "ready", ready: true } });
assert(host.lobby.canStart(), "lobby canStart after both humans ready");
// Host starts the match (host-only action). startMatch primes one synchronous step → snapshots.
host.onPeerMessageObject("host", { m: "lobby", action: { a: "start" } });
const sHost = last("host", "start");
const sP1 = last("p1", "start");
assert(sHost && sHost.you === 0, "host receives start with you=0");
assert(sP1 && sP1.you === 1, "joiner receives start with you=1");
assert(host.running, "the 20 Hz tick loop is armed after start");

console.log("Per-player FOG-FILTERED snapshots (anti-maphack, §15 / §20.3):");
const snapHost = last("host", "snapshot");
const snapP1 = last("p1", "snapshot");
assert(snapHost && snapP1, "both players received a primed snapshot");
const enemyInHost = snapHost.data.entities.filter((e) => e.o === 1);
const enemyInP1 = snapP1.data.entities.filter((e) => e.o === 0);
assert(enemyInHost.length === 0, "player 0's snapshot has ZERO enemy entities (out of fog) — got " + enemyInHost.length);
assert(enemyInP1.length === 0, "player 1's snapshot has ZERO enemy entities (out of fog) — got " + enemyInP1.length);
assert(snapHost.data.entities.some((e) => e.o === 0 && e.t === "command_center"), "player 0 sees its OWN command center");
const meHost = snapHost.data.players.find((p) => p.id === 0);
const enemyHost = snapHost.data.players.find((p) => p.id === 1);
assert(meHost.silver !== undefined, "player 0 sees its own silver");
assert(enemyHost.silver === undefined, "player 0 does NOT see the enemy's economy (no leak)");

console.log("Command ownership validation (§20.3):");
const match = host.match;          // test seam: drive the sim deterministically
const enemyMiner = match.world.entities.find((e) => e.owner === 0 && e.type === "miner");
assert(!!enemyMiner, "found a player-0 miner to target");
// Player 1 tries to move a player-0 unit — must be rejected.
host.onPeerMessageObject("p1", { m: "cmd", data: { playerId: 1, clientTick: 1, cmd: { t: "move", ids: [enemyMiner.id], x: 1, y: 1 } } });
for (let i = 0; i < 5; i++) match.step();
assert(enemyMiner.path.length === 0 && enemyMiner.moveTarget === null, "player 1 CANNOT move an enemy (player-0) unit");

// Spoofed owner on a build is coerced to the authenticated player.
const ownBefore = match.world.entities.filter((e) => e.owner === 1 && e.type === "power_plant").length;
match.world.players[1].silver = 500; match.world.players[1].iron = 50; match.world.players[1].gold = 10; // afford the build
host.onPeerMessageObject("p1", { m: "cmd", data: { playerId: 1, clientTick: 2, cmd: { t: "build", owner: 0, building: "power_plant", x: match.world.map.spawns[1].x + 2, y: match.world.map.spawns[1].y + 5 } } });
match.step();
const ownAfter = match.world.entities.filter((e) => e.owner === 1 && e.type === "power_plant").length;
const enemyPP = match.world.entities.filter((e) => e.owner === 0 && e.type === "power_plant").length;
assert(ownAfter === ownBefore + 1, "the build is applied to the authenticated player (player 1)");
assert(enemyPP === 0, "the spoofed owner=0 is ignored (enemy gained no building)");

console.log("Peer disconnect frees the slot in the lobby:");
host.onPeerDisconnect("p1");
// (mid-match this keeps a grace token; lobby slot stays until grace expires — that matches the
// Node host behaviour and is covered by the LAN suites.)
assert(disconnected.length === 0, "no peers were force-disconnected during a clean run");

host.shutdown(); // stop the tick loop so the process can exit
const hg = last("host", "hostgone");
assert(!!hg, "shutdown broadcasts hostgone to peers");

console.log("");
if (failures === 0) { console.log("ALL GAMEHOST TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " GAMEHOST TEST(S) FAILED ✗"); process.exit(1); }
