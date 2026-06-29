// MYS Generals — authoritative-host tests (spec §3.2, §15, §20).
// Verifies: per-player FOG-FILTERED snapshots (anti-maphack), command ownership validation,
// and duplicate/out-of-order command rejection. Run: node test/host.mjs
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { MatchHost } from "../dist/host/matchHost.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { console.error("  ✗ " + msg); failures++; } else { console.log("  ✓ " + msg); } }

function mkPlayer(id, isAI, color) {
  return { id, silver: 200, iron: 50, gold: 10, color, isAI, aiDiff: "normal", defeated: false,
    powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}

// Capture link that records the latest snapshot/events sent to a player.
function recorder(playerId) {
  const r = { playerId, snap: null, events: [] };
  r.pushSnapshot = (s) => { r.snap = s; };
  r.pushEvent = (e) => { r.events.push(e); };
  return r;
}

const map = getMap("twin_rivers");
const world = new World(map);
world.addPlayer(mkPlayer(0, false, "#4ea3ff"));
world.addPlayer(mkPlayer(1, false, "#ff5a4d")); // no AI: enemy stays idle so tests are deterministic
world.spawnBase(0, map.spawns[0]);
world.spawnBase(1, map.spawns[1]);
world.setupNeutrals();

const host = new MatchHost(world);
const p0 = recorder(0);
const p1 = recorder(1);
host.addLink(p0);
host.addLink(p1);
host.step();

console.log("Anti-maphack: per-player fog-filtered snapshots (§15, §20.5):");
const enemyEntitiesInP0 = p0.snap.entities.filter((e) => e.o === 1);
assert(p0.snap.entities.length > 0, "player 0 receives a snapshot with entities");
assert(enemyEntitiesInP0.length === 0, "player 0's snapshot contains ZERO enemy entities (enemy base is across the map, out of fog) — got " + enemyEntitiesInP0.length);
assert(p0.snap.entities.some((e) => e.o === 0 && e.t === "command_center"), "player 0 sees its OWN command center");
// the enemy's economy must not leak either
const me0 = p0.snap.players.find((p) => p.id === 0);
const enemy0 = p0.snap.players.find((p) => p.id === 1);
assert(me0.silver === 200, "player 0 sees its own silver");
assert(enemy0.silver === undefined, "player 0 does NOT see the enemy's silver (no economy leak)");

// Symmetric for player 1.
const enemyEntitiesInP1 = p1.snap.entities.filter((e) => e.o === 0);
assert(enemyEntitiesInP1.length === 0, "player 1's snapshot also contains ZERO enemy entities");

console.log("Fog reveal: a scout brings an enemy into vision (§15):");
// drop a player-0 scout right next to the enemy CC and re-step
const enemyCC = world.entities.find((e) => e.owner === 1 && e.type === "command_center");
const scout = world.spawn("unit", "infantry", 0, Math.floor(enemyCC.pos.x) + 2, Math.floor(enemyCC.pos.y) + 2);
host.step();
const seen = p0.snap.entities.filter((e) => e.o === 1);
assert(seen.length > 0, "after scouting, player 0 now sees enemy entities near the scout — got " + seen.length);
assert(seen.some((e) => e.id === enemyCC.id), "the scouted enemy command center is now in player 0's snapshot");

console.log("Command ownership validation (§20.3):");
const enemyMiner = world.entities.find((e) => e.owner === 1 && e.type === "miner");
const before = { x: enemyMiner.pos.x, y: enemyMiner.pos.y };
// player 0 tries to move an ENEMY unit — must be rejected
host.submit({ playerId: 0, clientTick: 1, cmd: { t: "move", ids: [enemyMiner.id], x: 1, y: 1 } });
for (let i = 0; i < 5; i++) host.step();
assert(enemyMiner.path.length === 0 && enemyMiner.moveTarget === null, "player 0 CANNOT move an enemy unit (command rejected)");

// player 0 build with a spoofed owner=1 must be coerced to owner 0
const cntBefore1 = world.entities.filter((e) => e.owner === 1 && e.type === "power_plant").length;
host.submit({ playerId: 0, clientTick: 2, cmd: { t: "build", owner: 1, building: "power_plant", x: map.spawns[0].x + 2, y: map.spawns[0].y + 5 } });
host.step();
const cntAfter1 = world.entities.filter((e) => e.owner === 1 && e.type === "power_plant").length;
const own0PP = world.entities.filter((e) => e.owner === 0 && e.type === "power_plant").length;
assert(cntAfter1 === cntBefore1, "spoofed owner is ignored: enemy gained no building from player 0's command");
assert(own0PP === 1, "the build was applied to the authenticated player (player 0)");

console.log("Duplicate / out-of-order command rejection (§20.5):");
const cc0 = world.entities.find((e) => e.owner === 0 && e.type === "command_center");
host.submit({ playerId: 0, clientTick: 10, cmd: { t: "train", building: cc0.id, unit: "miner" } });
host.step();
const q1 = cc0.queue.length;
// replay an OLDER clientTick — must be dropped
host.submit({ playerId: 0, clientTick: 5, cmd: { t: "train", building: cc0.id, unit: "miner" } });
host.step();
assert(cc0.queue.length <= q1, "an out-of-order (older clientTick) command is dropped");

console.log("");
if (failures === 0) { console.log("ALL HOST TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " HOST TEST(S) FAILED ✗"); process.exit(1); }
