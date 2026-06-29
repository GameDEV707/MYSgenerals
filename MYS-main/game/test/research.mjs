// MYS Generals — T26 research tests (spec §24 → T26 Part C): the Research Center runs timed
// global upgrades whose effects apply to damage / armor / build-time, and Factory Tech gates the
// Part B factory upgrades. Pure headless sim (no browser).
// Run: NODE_OPTIONS="" node test/research.mjs
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { RESEARCH_BY_ID } from "../dist/data.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }
function approx(a, b, eps, m) { assert(Math.abs(a - b) <= eps, `${m} (got ${a}, want ~${b})`); }

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

console.log("Weapons I — deducts cost, then after its research time raises research.weapons:");
{
  const w = freshWorld();
  const rc = w.spawn("building", "research_center", 0, w.map.spawns[0].x + 2, w.map.spawns[0].y + 6);
  rc.constructing = false;
  const cost = RESEARCH_BY_ID.weapons1.cost; // { gold:1, iron:10, silver:40 }
  const s0 = w.players[0].silver, i0 = w.players[0].iron, g0 = w.players[0].gold;
  w.tryResearch(rc.id, "weapons1");
  assert(rc.researching && rc.researching.id === "weapons1", "research started in the center's slot");
  assert(w.players[0].silver === s0 - cost.silver && w.players[0].iron === i0 - cost.iron && w.players[0].gold === g0 - cost.gold, "research cost was paid on start");
  for (let i = 0; i < 520; i++) w.tick(); // 25s = 500 ticks
  assert(w.players[0].research.weapons === 1, "research.weapons raised to 1 after the research time");
  assert(rc.researching === null, "the research slot is free again after completion");
}

console.log("Weapons research adds +15% outgoing damage:");
{
  const w = freshWorld();
  const tgtA = w.spawn("unit", "infantry", 1, 30, 30);
  const tgtB = w.spawn("unit", "infantry", 1, 32, 30);
  const hpA0 = tgtA.hp, hpB0 = tgtB.hp;
  w.players[0].research.weapons = 0;
  w.dealDamageRaw(tgtA, 100, "Bullet", 0); // x1.0 vs InfantryLight
  w.players[0].research.weapons = 1;
  w.dealDamageRaw(tgtB, 100, "Bullet", 0);
  const dropA = hpA0 - tgtA.hp, dropB = hpB0 - tgtB.hp;
  approx(dropA, 100, 0.01, "baseline Bullet damage = 100");
  approx(dropB, 115, 0.01, "Weapons I = +15% damage (115)");
}

console.log("Armor research reduces incoming damage (effective +15% HP):");
{
  const w = freshWorld();
  const tgt = w.spawn("unit", "infantry", 1, 30, 30);
  const hp0 = tgt.hp;
  w.players[1].research.armor = 1; // defender's research
  w.dealDamageRaw(tgt, 100, "Bullet", 0);
  approx(hp0 - tgt.hp, 100 / 1.15, 0.05, "Armor I divides incoming damage by 1.15");
}

console.log("Logistics shortens tryTrain build time by 20%:");
{
  const w = freshWorld();
  const bar = w.spawn("building", "barracks", 0, w.map.spawns[0].x + 2, w.map.spawns[0].y + 6);
  bar.constructing = false;
  w.tryTrain({ t: "train", building: bar.id, unit: "infantry" }); // buildTime 20
  approx(bar.queue[0].time, 20, 0.001, "without Logistics the build time is 20s");
  bar.queue.length = 0;
  w.players[0].research.logistics = true;
  w.tryTrain({ t: "train", building: bar.id, unit: "infantry" });
  approx(bar.queue[0].time, 16, 0.001, "with Logistics the build time is 16s (-20%)");
}

console.log("Factory Tech gates the Part B factory upgrades:");
{
  const w = freshWorld();
  const bar = w.spawn("building", "barracks", 0, w.map.spawns[0].x + 2, w.map.spawns[0].y + 6);
  bar.constructing = false;
  w.players[0].research.factoryTech = 0;
  w.tryUpgradeBuilding(bar.id, "bay");
  assert(bar.bays === 1, "bay upgrade is blocked without Factory Tech I");
  w.players[0].research.factoryTech = 1;
  w.tryUpgradeBuilding(bar.id, "bay");
  assert(bar.bays === 2, "with Factory Tech I the bay upgrade succeeds (1→2)");
  w.tryUpgradeBuilding(bar.id, "bay");
  assert(bar.bays === 2, "bay 2→3 is blocked until Factory Tech II");
  w.players[0].research.factoryTech = 2;
  w.tryUpgradeBuilding(bar.id, "bay");
  assert(bar.bays === 3, "with Factory Tech II the bay upgrade reaches 3");
  w.tryUpgradeBuilding(bar.id, "speed");
  assert(bar.speedLevel === 1, "assembly-speed upgrade works with Factory Tech");
}

console.log("");
if (failures === 0) { console.log("ALL T26 RESEARCH TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T26 RESEARCH TEST(S) FAILED ✗"); process.exit(1); }
