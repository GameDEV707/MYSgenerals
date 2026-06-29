// MYS Generals — T26 production tests (spec §24 → T26 Part A/B): parallel build bays, assembly
// speed, cancel/refund + re-index, and the queue-full toast. Pure headless sim (no browser).
// Run: NODE_OPTIONS="" node test/production.mjs
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { MAX_QUEUE } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id) {
  return { id, silver: 1000, iron: 1000, gold: 1000, color: "#4ea3ff", isAI: false, aiDiff: "normal", defeated: false,
    powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
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

console.log("Parallel bays — with bays=2 two queued units progress together and spawn ~together:");
{
  const w = freshWorld();
  const b = cc(w); b.bays = 2;
  b.queue.push({ unit: "miner", progress: 0, time: 12 });
  b.queue.push({ unit: "miner", progress: 0, time: 12 });
  let t1 = -1, t2 = -1;
  for (let i = 0; i < 400; i++) { w.tick(); const ub = w.players[0].unitsBuilt; if (ub >= 1 && t1 < 0) t1 = i; if (ub >= 2 && t2 < 0) { t2 = i; break; } }
  assert(t2 >= 0, "both parallel-bay units were produced");
  assert(t2 - t1 <= 3, `both bays finished within ~3 ticks (gap ${t2 - t1})`);
  assert(t1 >= 235 && t1 <= 246, `first finished at ~240 ticks (12s @20Hz), got ${t1}`);
}

console.log("Single bay (default) builds serially — the 2nd unit finishes ~twice as late:");
{
  const w = freshWorld();
  const b = cc(w); b.bays = 1;
  b.queue.push({ unit: "miner", progress: 0, time: 12 });
  b.queue.push({ unit: "miner", progress: 0, time: 12 });
  let t2 = -1;
  for (let i = 0; i < 700; i++) { w.tick(); if (w.players[0].unitsBuilt >= 2) { t2 = i; break; } }
  assert(t2 >= 475 && t2 <= 486, `serial 2nd unit finished at ~480 ticks, got ${t2}`);
}

console.log("Assembly speed — speedLevel=2 (x1.5) completes a unit in ~2/3 of the ticks:");
{
  const w = freshWorld();
  const b = cc(w); b.speedLevel = 2; // x1.5
  b.queue.push({ unit: "miner", progress: 0, time: 12 });
  let t = -1;
  for (let i = 0; i < 400; i++) { w.tick(); if (w.players[0].unitsBuilt >= 1) { t = i; break; } }
  assert(t >= 155 && t <= 166, `x1.5 speed finished at ~160 ticks (240/1.5), got ${t}`);
}

console.log("Cancel from index 1 refunds 100% (not started) and re-indexes the queue:");
{
  const w = freshWorld();
  const b = cc(w); b.bays = 1;
  b.queue.push({ unit: "miner", progress: 0, time: 12 }); // index 0
  b.queue.push({ unit: "infantry", progress: 0, time: 20 }); // index 1 (not started with bays=1)
  for (let i = 0; i < 5; i++) w.tick(); // advance head only
  assert(b.queue[0].progress > 0, "head item (index 0) is in progress");
  assert(b.queue[1].progress === 0, "index 1 has not started (single bay)");
  const before = w.players[0].silver;
  w.cancelQueue(b.id, 1); // infantry cost silver 5 → 100% refund
  assert(w.players[0].silver === before + 5, `index-1 cancel refunded 100% of cost (got +${w.players[0].silver - before})`);
  assert(b.queue.length === 1 && b.queue[0].unit === "miner", "queue re-indexed; the head miner remains");
}

console.log("Queue full — training past MAX_QUEUE emits toast.queueFull:");
{
  const w = freshWorld();
  const b = cc(w);
  for (let i = 0; i < MAX_QUEUE; i++) b.queue.push({ unit: "miner", progress: 0, time: 12 });
  w.drainEvents();
  w.tryTrain({ t: "train", building: b.id, unit: "miner" });
  const ev = w.drainEvents();
  assert(b.queue.length === MAX_QUEUE, "queue did not exceed MAX_QUEUE");
  assert(ev.some((e) => e.e === "toast" && e.key === "toast.queueFull"), "toast.queueFull was emitted at the cap");
}

console.log("");
if (failures === 0) { console.log("ALL T26 PRODUCTION TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T26 PRODUCTION TEST(S) FAILED ✗"); process.exit(1); }
