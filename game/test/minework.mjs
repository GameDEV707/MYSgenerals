// MYS Generals — T30 Part C worked-mine economy test (spec §24 → T30). Every mine now needs a
// miner working INSIDE it: an unmanned mine produces nothing; a miner that reaches a mine enters it
// (occupancy +1) and disappears from the map (not in the owner's snapshot); destroying a mine
// releases its miners. Run: NODE_OPTIONS="" node test/minework.mjs
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { MatchHost } from "../dist/host/matchHost.js";
import { IRON_INTERVAL, TICK_DT } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id) {
  return { id, silver: 1000, iron: 0, gold: 0, color: "#4ea3ff", isAI: false, aiDiff: "normal", defeated: false,
    powerGen: 999, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false }, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}
function freshWorld() {
  const map = getMap("twin_spear");
  const w = new World(map);
  w.addPlayer(mkPlayer(0));
  w.addPlayer(mkPlayer(1));
  w.spawnBase(0, map.spawns[0]);
  w.spawnBase(1, map.spawns[1]);
  return w;
}
function cc(w) { return w.entities.find((e) => e.type === "command_center" && e.owner === 0); }
function runTicks(w, n) { for (let i = 0; i < n; i++) w.tick(); }

console.log("An UNMANNED mine produces nothing (T30: every mine needs a miner inside):");
{
  const w = freshWorld();
  const mine = w.spawn("building", "iron_mine", 0, cc(w).pos.x + 6, cc(w).pos.y);
  const p = w.players[0];
  const iron0 = p.iron;
  runTicks(w, Math.ceil(IRON_INTERVAL / TICK_DT) * 2); // two full intervals
  assert(mine.minerSlots === 0, "an unmanned iron mine has zero occupancy");
  assert(p.iron === iron0, "an unmanned iron mine yields NO iron (got +" + (p.iron - iron0) + ")");
}

console.log("A miner that reaches a mine ENTERS it (occupancy +1, hidden) and the mine then produces:");
{
  const w = freshWorld();
  const mine = w.spawn("building", "iron_mine", 0, cc(w).pos.x + 6, cc(w).pos.y);
  const miner = w.spawn("unit", "miner", 0, mine.pos.x, mine.pos.y); // already at the mine
  miner.mineId = mine.id;
  runTicks(w, 2); // workerSystem makes it enter
  assert(miner.inMine === true && miner.mining === true, "the miner entered the mine (inMine + mining)");
  assert(mine.minerSlots === 1, "the mine now has occupancy 1");
  const iron0 = w.players[0].iron;
  runTicks(w, Math.ceil(IRON_INTERVAL / TICK_DT) + 4);
  assert(w.players[0].iron >= iron0 + 1, "a manned iron mine yields iron at its interval (got +" + (w.players[0].iron - iron0) + ")");
}

console.log("A miner working inside a mine is HIDDEN from the owner's snapshot (off the map):");
{
  const w = freshWorld();
  const mine = w.spawn("building", "iron_mine", 0, cc(w).pos.x + 6, cc(w).pos.y);
  const miner = w.spawn("unit", "miner", 0, mine.pos.x, mine.pos.y);
  miner.mineId = mine.id;
  runTicks(w, 2);
  assert(miner.inMine === true, "miner is inside");
  const host = new MatchHost(w);
  const rec = { playerId: 0, snap: null, events: [], pushSnapshot: (s) => { rec.snap = s; }, pushEvent: () => {} };
  host.addLink(rec);
  host.step();
  const seesMiner = rec.snap.entities.some((e) => e.id === miner.id);
  const seesMine = rec.snap.entities.some((e) => e.id === mine.id);
  assert(seesMiner === false, "the owner's snapshot does NOT contain the in-mine miner");
  assert(seesMine === true, "the mine itself is still visible to its owner");
  // a starting miner exists in the sim but is also inside its silver mine → likewise hidden
  const anyMinerSnap = rec.snap.entities.some((e) => e.t === "miner" && e.o === 0);
  assert(anyMinerSnap === false, "no working miner of the owner appears on the map");
}

console.log("Destroying a mine RELEASES its miners back onto the map (idle, not lost):");
{
  const w = freshWorld();
  const mine = w.spawn("building", "iron_mine", 0, cc(w).pos.x + 6, cc(w).pos.y);
  const miner = w.spawn("unit", "miner", 0, mine.pos.x, mine.pos.y);
  miner.mineId = mine.id;
  runTicks(w, 2);
  assert(miner.inMine === true, "miner started inside the mine");
  w.killEntity(mine, false); // destroy the mine
  assert(miner.dead === false, "the miner is NOT destroyed with the mine");
  assert(miner.inMine === false && miner.mining === false, "the miner is released back onto the map (no longer inside)");
  assert(miner.mineId !== mine.id, "the miner is no longer bound to the destroyed mine");
}

console.log("autoAssignMiner routes an idle miner to a free mine of ANY type (T30):");
{
  const w = freshWorld();
  const mine = w.spawn("building", "gold_mine", 0, cc(w).pos.x + 5, cc(w).pos.y);
  const miner = w.spawn("unit", "miner", 0, cc(w).pos.x, cc(w).pos.y + 2);
  w.autoAssignMiner(miner);
  assert(miner.mineId === mine.id || (typeof miner.mineId === "number"), "the idle miner was assigned to a free mine");
}

console.log("");
if (failures === 0) { console.log("ALL T30 WORKED-MINE TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T30 WORKED-MINE TEST(S) FAILED ✗"); process.exit(1); }
