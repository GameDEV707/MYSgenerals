// MYS Generals — T31 worker-model tests (spec §24 → T31). The two worker jobs are split: the
// ENGINEER is the builder (constructs buildings, captures), the MINER is mining-only and exactly ONE
// miner works a mine. The player starts with an Engineer; an idle Miner with no free mine waits and
// auto-enters the next mine. Run: NODE_OPTIONS="" node test/workers.mjs
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { BUILDING_DEFS, UNIT_DEFS } from "../dist/data.js";
import { mineSlotCap } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id) {
  return { id, silver: 5000, iron: 5000, gold: 5000, color: "#4ea3ff", isAI: false, aiDiff: "normal", defeated: false,
    powerGen: 999, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false }, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}
function freshWorld() {
  const map = getMap("twin_rivers");
  const w = new World(map);
  w.addPlayer(mkPlayer(0));
  w.addPlayer(mkPlayer(1));
  w.spawnBase(0, map.spawns[0]);
  w.spawnBase(1, map.spawns[1]);
  return w;
}
function cc(w) { return w.entities.find((e) => e.type === "command_center" && e.owner === 0); }
function own(w, type) { return w.entities.filter((e) => e.owner === 0 && e.type === type && !e.dead); }
function validSpot(w, b) {
  const c = cc(w);
  for (let r = 3; r <= 9; r++) for (let a = 0; a < 24; a++) {
    const x = Math.round(c.pos.x + Math.cos(a / 24 * Math.PI * 2) * r);
    const y = Math.round(c.pos.y + Math.sin(a / 24 * Math.PI * 2) * r);
    if (w.placementValid(0, b, x, y)) return { x, y };
  }
  return null;
}
function runTicks(w, n) { for (let i = 0; i < n; i++) w.tick(); }

console.log("Train costs: Miner = 5 silver, Engineer = 20 silver, both built at the Command Center:");
assert(UNIT_DEFS.miner.cost.silver === 5 && !UNIT_DEFS.miner.cost.gold, "Miner costs 5 silver");
assert(UNIT_DEFS.engineer.cost.silver === 20 && !UNIT_DEFS.engineer.cost.gold, "Engineer costs 20 silver (no gold)");
assert(BUILDING_DEFS.command_center.produces.includes("miner"), "CC produces Miner");
assert(BUILDING_DEFS.command_center.produces.includes("engineer"), "CC produces Engineer");

console.log("The player STARTS with an Engineer (builder) on the field, plus the mined silver mine:");
{
  const w = freshWorld();
  const engs = own(w, "engineer");
  assert(engs.length === 1, "exactly one starting Engineer");
  assert(engs[0].inMine === false && engs[0].mining === false, "the starting Engineer is a free unit on the map");
  const miners = own(w, "miner");
  assert(miners.length === 1 && miners[0].inMine === true, "the starting Miner is working inside the silver mine");
  assert(own(w, "silver_mine")[0].minerSlots === 1, "the silver mine is staffed (1 miner)");
}

console.log("The ENGINEER is the builder — tryBuild dispatches it, never a Miner:");
{
  const w = freshWorld();
  const spot = validSpot(w, "power_plant");
  w.tryBuild({ t: "build", owner: 0, building: "power_plant", x: spot.x, y: spot.y });
  const eng = own(w, "engineer")[0];
  assert(!!eng.buildTask, "the Engineer received the buildTask");
  assert(own(w, "miner").every((m) => !m.buildTask), "no Miner was pulled to build");
  // nearestIdleWorker returns an engineer
  const worker = w.nearestIdleWorker(0, cc(w).pos);
  assert(worker === null || worker.type === "engineer", "nearestIdleWorker only returns engineers");
}

console.log("A constructing building advances FASTER with the engineer-builder present:");
{
  const w = freshWorld();
  const b = w.spawn("building", "power_plant", 0, cc(w).pos.x + 5, cc(w).pos.y);
  b.constructing = true; b.buildTotal = 30; b.buildProgress = 0;
  // no builder near → fallback slow rate
  const p0 = b.buildProgress; runTicks(w, 1); const slow = b.buildProgress - p0;
  // put an engineer on it with a matching buildTask → full rate
  const eng = own(w, "engineer")[0];
  eng.buildTask = { bid: "power_plant", pos: { ...b.pos }, entId: b.id }; eng.pos = { x: b.pos.x, y: b.pos.y };
  const p1 = b.buildProgress; runTicks(w, 1); const fast = b.buildProgress - p1;
  assert(fast > slow, "construction is faster with the engineer present (" + fast.toFixed(4) + " > " + slow.toFixed(4) + ")");
}

console.log("ONE miner per mine (every type), enforced by mineSlotCap and the worker system:");
{
  assert(mineSlotCap("silver_mine") === 1 && mineSlotCap("iron_mine") === 1 && mineSlotCap("gold_mine") === 1 && mineSlotCap("oil_derrick") === 1, "mineSlotCap is 1 for every mine type");
  const w = freshWorld();
  const mine = w.spawn("building", "iron_mine", 0, cc(w).pos.x + 6, cc(w).pos.y);
  const m1 = w.spawn("unit", "miner", 0, mine.pos.x, mine.pos.y);
  const m2 = w.spawn("unit", "miner", 0, mine.pos.x, mine.pos.y);
  m1.mineId = mine.id; m2.mineId = mine.id;
  runTicks(w, 3);
  const inside = w.entities.filter((e) => e.type === "miner" && e.mining && e.mineId === mine.id).length;
  assert(mine.minerSlots === 1 && inside === 1, "only ONE miner works the mine (the other is re-routed)");
}

console.log("autoAssignMiner spreads idle miners one-per-mine (skips an already-worked mine):");
{
  const w = freshWorld();
  const iron = w.spawn("building", "iron_mine", 0, cc(w).pos.x + 5, cc(w).pos.y);
  const gold = w.spawn("building", "gold_mine", 0, cc(w).pos.x - 5, cc(w).pos.y);
  const a = w.spawn("unit", "miner", 0, cc(w).pos.x, cc(w).pos.y + 2);
  const b = w.spawn("unit", "miner", 0, cc(w).pos.x, cc(w).pos.y + 3);
  w.autoAssignMiner(a); w.autoAssignMiner(b);
  assert(a.mineId !== b.mineId && a.mineId != null && b.mineId != null, "the two idle miners pick two DIFFERENT free mines");
}

console.log("An idle Miner with no free mine WAITS, then auto-enters the next mine built:");
{
  const w = freshWorld();
  // the only mine (starting silver) is already worked → a new miner has nowhere to go
  const m = w.spawn("unit", "miner", 0, cc(w).pos.x + 8, cc(w).pos.y + 8);
  w.autoAssignMiner(m);
  assert(m.mineId == null, "with every mine staffed, the new miner waits (no assignment)");
  // build a fresh mine AT the miner's spot → the worker system should route + enter it
  const mine = w.spawn("building", "gold_mine", 0, m.pos.x, m.pos.y);
  runTicks(w, 3);
  assert(m.mineId === mine.id, "the waiting miner is auto-assigned once a free mine appears");
  assert(m.inMine === true && mine.minerSlots === 1, "and it auto-enters the new mine");
}

console.log("");
if (failures === 0) { console.log("ALL T31 WORKER TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T31 WORKER TEST(S) FAILED ✗"); process.exit(1); }
