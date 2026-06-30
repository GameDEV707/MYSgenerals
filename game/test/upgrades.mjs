// MYS Generals — T30 upgrade tests (spec §24 → T30 Parts A & B). A timed LEVEL upgrade lifts the
// Command Center (max L3, gates the build tree) and the defensive towers (max L3, +range/+damage
// per level). Verified host-side: cost paid, upgrade takes HALF the build time, the new level
// applies on completion, the level is capped, and a defence's effective range + damage rise per level.
// Run: NODE_OPTIONS="" node test/upgrades.mjs
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { BUILDING_DEFS } from "../dist/data.js";
import { CC_UPGRADE_TIMES, MAX_BASE_LEVEL, MAX_DEFENSE_LEVEL, DEFENSE_RANGE_PER_LEVEL, DEFENSE_DAMAGE_PER_LEVEL, defenseUpgradeCost, upgradeTime, TICK_DT } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

function mkPlayer(id) {
  return { id, silver: 5000, iron: 5000, gold: 5000, color: "#4ea3ff", isAI: false, aiDiff: "normal", defeated: false,
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

console.log("The Command Center upgrades L1 → L2 (paid, timed at the defined duration):");
{
  const w = freshWorld();
  const c = cc(w);
  const p = w.players[0];
  const s0 = p.silver, i0 = p.iron;
  w.tryUpgradeBuilding(c.id, "level");
  assert(c.upgrading && c.upgrading.to === 2, "upgrade started toward Lvl 2");
  assert(p.silver < s0 && p.iron < i0, "the upgrade was paid for");
  assert(near(c.upgrading.time, CC_UPGRADE_TIMES[0]), "CC L1→L2 takes the defined time (" + CC_UPGRADE_TIMES[0] + "s)");
  runTicks(w, Math.ceil(CC_UPGRADE_TIMES[0] / TICK_DT) + 2);
  assert(c.level === 2 && c.upgrading === null, "after the timer the CC is Level 2");
}

console.log("The Command Center is capped at Level 3:");
{
  const w = freshWorld();
  const c = cc(w);
  c.level = MAX_BASE_LEVEL; // 3
  const p = w.players[0]; const s0 = p.silver;
  w.tryUpgradeBuilding(c.id, "level");
  assert(c.upgrading === null, "no upgrade starts past the max level");
  assert(p.silver === s0, "a maxed CC is not charged");
}

console.log("A second upgrade cannot start while one is already running:");
{
  const w = freshWorld();
  const c = cc(w);
  w.tryUpgradeBuilding(c.id, "level");
  const p = w.players[0]; const s1 = p.silver;
  w.tryUpgradeBuilding(c.id, "level"); // already upgrading → ignored
  assert(p.silver === s1, "a concurrent upgrade is rejected (not charged again)");
}

console.log("A defensive tower upgrades in HALF its build time and gains range + damage per level:");
{
  const w = freshWorld();
  const def = BUILDING_DEFS.guard_tower;
  const tower = w.spawn("building", "guard_tower", 0, cc(w).pos.x + 5, cc(w).pos.y);
  const wd = tower.weaponDef;
  const baseRange = w.effRange(tower, wd), baseDmg = w.effDamage(tower, wd);
  assert(near(baseRange, def.weapon.range), "Lvl 1 range = base weapon range");
  assert(near(baseDmg, def.weapon.damage), "Lvl 1 damage = base weapon damage");

  const p = w.players[0]; const s0 = p.silver, i0 = p.iron;
  w.tryUpgradeBuilding(tower.id, "level");
  assert(tower.upgrading && tower.upgrading.to === 2, "tower upgrade started toward Lvl 2");
  assert(near(tower.upgrading.time, upgradeTime(def.buildTime)), "upgrade takes half the build time (" + upgradeTime(def.buildTime) + "s, build " + def.buildTime + "s)");
  const cost = defenseUpgradeCost(def.cost);
  assert(p.silver === s0 - (cost.silver || 0) && p.iron === i0 - (cost.iron || 0), "tower upgrade was paid for");

  runTicks(w, Math.ceil(upgradeTime(def.buildTime) / TICK_DT) + 2);
  assert(tower.level === 2 && tower.upgrading === null, "after the timer the tower is Level 2");
  assert(near(w.effRange(tower, wd), def.weapon.range + DEFENSE_RANGE_PER_LEVEL), "Lvl 2 range = base + " + DEFENSE_RANGE_PER_LEVEL);
  assert(near(w.effDamage(tower, wd), def.weapon.damage * (1 + DEFENSE_DAMAGE_PER_LEVEL)), "Lvl 2 damage = base × " + (1 + DEFENSE_DAMAGE_PER_LEVEL));
}

console.log("Defensive towers are capped at Level 3, and effRange/effDamage scale to it:");
{
  const w = freshWorld();
  const def = BUILDING_DEFS.guard_tower;
  const tower = w.spawn("building", "guard_tower", 0, cc(w).pos.x + 5, cc(w).pos.y);
  tower.level = MAX_DEFENSE_LEVEL; // 3
  assert(near(w.effRange(tower, tower.weaponDef), def.weapon.range + 2 * DEFENSE_RANGE_PER_LEVEL), "Lvl 3 range = base + 2");
  assert(near(w.effDamage(tower, tower.weaponDef), def.weapon.damage * (1 + 2 * DEFENSE_DAMAGE_PER_LEVEL)), "Lvl 3 damage = base × 1.5");
  const p = w.players[0]; const s0 = p.silver;
  w.tryUpgradeBuilding(tower.id, "level");
  assert(tower.upgrading === null && p.silver === s0, "a maxed tower does not upgrade / is not charged");
}

console.log("An unaffordable upgrade is rejected (no charge, no level change):");
{
  const w = freshWorld();
  const tower = w.spawn("building", "guard_tower", 0, cc(w).pos.x + 5, cc(w).pos.y);
  const p = w.players[0];
  p.silver = 0; p.iron = 0; p.gold = 0;
  w.drainEvents();
  w.tryUpgradeBuilding(tower.id, "level");
  const ev = w.drainEvents();
  assert(tower.upgrading === null && tower.level === 1, "broke player cannot upgrade the tower");
  assert(ev.some((e) => e.e === "toast" && e.kind === "danger"), "a shortfall toast is emitted");
}

console.log("");
if (failures === 0) { console.log("ALL T30 UPGRADE TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T30 UPGRADE TEST(S) FAILED ✗"); process.exit(1); }
