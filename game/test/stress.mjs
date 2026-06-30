// MYS Generals — stress test / optimization validation (spec §22).
// Measures: host tick time with 4 players + heavy combat, snapshot byte size, entity count.
// Run: NODE_OPTIONS="" node test/stress.mjs
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { MatchHost } from "../dist/host/matchHost.js";
import { TICK_DT } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id, color) {
  return { id, silver: 999, iron: 999, gold: 999, color, isAI: id > 0, aiDiff: "hard", defeated: false,
    powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}

// 4-player game on Crossfire (largest map)
const map = getMap("quad_foundry");
const world = new World(map);
world.addPlayer(mkPlayer(0, "#4ea3ff"));
world.addPlayer(mkPlayer(1, "#ff5a4d"));
world.addPlayer(mkPlayer(2, "#34d399"));
world.addPlayer(mkPlayer(3, "#c084fc"));
for (let i = 0; i < 4; i++) world.spawnBase(i, map.spawns[i]);
world.setupNeutrals();

const host = new MatchHost(world);
for (let i = 1; i < 4; i++) host.addAIPlayer(i);

// Snapshot recorder for player 0
const snaps = [];
const link0 = { playerId: 0, pushSnapshot: (s) => snaps.push(s), pushEvent: () => {} };
host.addLink(link0);

// Spawn extra units to stress the sim (simulate late-game armies)
for (let i = 0; i < 4; i++) {
  for (let k = 0; k < 12; k++) {
    const x = map.spawns[i].x + (k % 4) * 2;
    const y = map.spawns[i].y + Math.floor(k / 4) * 2 + 5;
    world.spawn("unit", k % 3 === 0 ? "heavy_tank" : k % 3 === 1 ? "rocket_soldier" : "infantry", i, x, y);
  }
}

console.log("Stress test: 4 players, Crossfire map, ~48 extra units + base units + AI");
console.log(`  Initial entity count: ${world.entities.length}`);

// Run 200 ticks (10 seconds of game time) measuring performance
const TICKS = 200;
const tickTimes = [];
for (let t = 0; t < TICKS; t++) {
  const start = performance.now();
  host.step();
  tickTimes.push(performance.now() - start);
}

const avgTick = tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length;
const maxTick = Math.max(...tickTimes);
const p95Tick = tickTimes.sort((a, b) => a - b)[Math.floor(TICKS * 0.95)];

console.log(`  Tick perf (${TICKS} ticks):`);
console.log(`    avg: ${avgTick.toFixed(2)} ms, p95: ${p95Tick.toFixed(2)} ms, max: ${maxTick.toFixed(2)} ms`);
console.log(`  Final entity count: ${world.entities.length}`);

// Check snapshot size (bytes when JSON-serialized)
const lastSnap = snaps[snaps.length - 1];
const snapJson = JSON.stringify(lastSnap);
const snapBytes = Buffer.byteLength(snapJson, "utf8");
console.log(`  Snapshot size (player 0, final): ${snapBytes} bytes (${lastSnap.entities.length} entities)`);

// Verification assertions
assert(avgTick < 10, `avg tick < 10 ms for 4-player heavy combat (got ${avgTick.toFixed(2)} ms)`);
assert(p95Tick < 20, `p95 tick < 20 ms (got ${p95Tick.toFixed(2)} ms)`);
assert(snapBytes < 20000, `snapshot < 20 KB for phone bandwidth (got ${snapBytes} bytes)`);
assert(world.entities.length >= 20, `sim still has entities after combat (got ${world.entities.length})`);

// Anti-maphack in heavy play: player 0's snapshot should NOT contain ALL entities
const allEntities = world.entities.filter((e) => !e.dead).length;
const snapEntities = lastSnap.entities.length;
console.log(`  Fog filtering: ${snapEntities}/${allEntities} entities visible to player 0`);
assert(snapEntities < allEntities, `fog filtering active: client sees fewer than total (${snapEntities} < ${allEntities})`);

// Verify no enemy economy leaked
const enemyPlayers = lastSnap.players.filter((p) => p.id !== 0);
const economyLeaked = enemyPlayers.some((p) => p.silver !== undefined);
assert(!economyLeaked, "no enemy economy leaked in heavy-combat snapshot");

console.log("");
if (failures === 0) { console.log("ALL STRESS TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " STRESS TEST(S) FAILED ✗"); process.exit(1); }
