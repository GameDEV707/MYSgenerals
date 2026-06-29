// MYS Generals — T32 D1 miner mine-finding test (spec §24 → T32 Part D). The miner assignment is
// REACHABILITY-AWARE: it picks the nearest mine it can actually path to (skipping ones walled off),
// and a miner that cannot reach its assigned mine re-routes to a reachable one instead of stalling.
// Run: NODE_OPTIONS="" node test/minefind.mjs
import { World } from "../dist/sim/world.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id) {
  return { id, silver: 100, iron: 0, gold: 0, color: "#4ea3ff", isAI: false, aiDiff: "normal", defeated: false,
    powerGen: 99, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false }, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}
// A 24×24 arena split by a SOLID wall column at x=11 (no gap): the left half and the right half are
// mutually unreachable on the ground.
function splitMap() {
  const w = 24, h = 24;
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) terrain[y * w + 11] = 4; // wall
  return { id: "t", nameKey: "menu.mapA", w, h, terrain, spawns: [{ x: 3, y: 3 }, { x: 20, y: 20 }], deposits: [], neutrals: [] };
}

console.log("autoAssignMiner picks the nearest REACHABLE free mine (skips a walled-off nearer one):");
{
  const w = new World(splitMap());
  w.addPlayer(mkPlayer(0)); w.addPlayer(mkPlayer(1));
  const reachable = w.spawn("building", "silver_mine", 0, 4, 5);   // left half, ~5 tiles away
  const walledOff = w.spawn("building", "silver_mine", 0, 13, 5);  // right half, ~4 tiles away but UNREACHABLE
  const miner = w.spawn("unit", "miner", 0, 9, 5);                 // left half, nearer to the walled-off mine
  assert(w.dist(miner.pos, walledOff.pos) < w.dist(miner.pos, reachable.pos), "the walled-off mine is the NEARER one by distance");
  w.autoAssignMiner(miner);
  assert(miner.mineId === reachable.id, "miner is assigned the reachable mine, not the nearer unreachable one");
}

console.log("A miner stuck on an unreachable claim re-routes to a reachable mine (no stalling):");
{
  const w = new World(splitMap());
  w.addPlayer(mkPlayer(0)); w.addPlayer(mkPlayer(1));
  // keep both players alive so the sim keeps ticking
  w.spawn("building", "command_center", 0, 3, 3);
  w.spawn("building", "command_center", 1, 20, 20);
  const reachable = w.spawn("building", "silver_mine", 0, 5, 8);
  const walledOff = w.spawn("building", "silver_mine", 0, 14, 8); // right half (unreachable)
  const miner = w.spawn("unit", "miner", 0, 8, 8);
  // force a bad claim on the unreachable mine
  miner.mineId = walledOff.id; miner.mining = false; miner.path = []; miner.moveTarget = null;
  for (let i = 0; i < 120; i++) w.tick();
  assert(miner.mineId === reachable.id, "the stuck miner dropped the unreachable claim and took the reachable mine");
  assert(miner.mining === true && miner.inMine === true, "and it walked in and is now digging");
}

console.log("");
if (failures === 0) { console.log("ALL T32 MINE-FIND TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T32 MINE-FIND TEST(S) FAILED ✗"); process.exit(1); }
