// MYS Generals — T30 Part A base-tech-gating test (spec §24 → T30). The Command-Center level gates
// the build tree: Barracks + Cannon Tower need CC Lvl 2, War Factory + Rocket Tower need CC Lvl 3;
// mines / power / Guard Tower are available at Lvl 1. The authoritative tryBuild() rejects an
// under-level build (errors.needBaseLevel toast, no charge) and accepts it once the CC is high enough.
// Run: NODE_OPTIONS="" node test/basetech.mjs
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { REQUIRED_BASE_LEVEL } from "../dist/constants.js";

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
function validSpot(w, building) {
  const c = cc(w);
  for (let r = 3; r <= 9; r++) for (let a = 0; a < 24; a++) {
    const x = Math.round(c.pos.x + Math.cos(a / 24 * Math.PI * 2) * r);
    const y = Math.round(c.pos.y + Math.sin(a / 24 * Math.PI * 2) * r);
    if (w.placementValid(0, building, x, y)) return { x, y };
  }
  return null;
}
// try to build `b`; returns { built, toastKey }
function attempt(w, b) {
  const spot = validSpot(w, b);
  if (!spot) return { built: false, toastKey: null, noSpot: true };
  const before = w.entities.filter((e) => e.owner === 0 && e.type === b).length;
  w.drainEvents();
  w.tryBuild({ t: "build", owner: 0, building: b, x: spot.x, y: spot.y });
  const ev = w.drainEvents();
  const after = w.entities.filter((e) => e.owner === 0 && e.type === b).length;
  const toast = ev.find((e) => e.e === "toast");
  return { built: after > before, toastKey: toast ? toast.key : null };
}

console.log("REQUIRED_BASE_LEVEL gates the right buildings:");
assert(REQUIRED_BASE_LEVEL.barracks === 2, "Barracks requires CC Lvl 2");
assert(REQUIRED_BASE_LEVEL.cannon_tower === 2, "Cannon Tower requires CC Lvl 2");
assert(REQUIRED_BASE_LEVEL.war_factory === 3, "War Factory requires CC Lvl 3");
assert(REQUIRED_BASE_LEVEL.rocket_tower === 3, "Rocket Tower requires CC Lvl 3");
assert((REQUIRED_BASE_LEVEL.silver_mine ?? 1) === 1 && (REQUIRED_BASE_LEVEL.guard_tower ?? 1) === 1, "mines + Guard Tower available at Lvl 1");

console.log("At Command-Center Level 1 only the L1 tech is buildable:");
{
  const w = freshWorld();
  assert(cc(w).level === 1, "Command Center starts at Level 1");
  assert(attempt(w, "guard_tower").built === true, "Guard Tower builds at Lvl 1");
  const barr = attempt(w, "barracks");
  assert(barr.built === false, "Barracks is REJECTED at Lvl 1");
  assert(barr.toastKey === "errors.needBaseLevel", "rejection emits errors.needBaseLevel");
  assert(attempt(w, "war_factory").built === false, "War Factory is REJECTED at Lvl 1");
}

console.log("At Level 2 the Barracks + Cannon Tower unlock (War Factory still locked):");
{
  const w = freshWorld();
  cc(w).level = 2;
  assert(attempt(w, "barracks").built === true, "Barracks builds at Lvl 2");
  assert(attempt(w, "cannon_tower").built === true, "Cannon Tower builds at Lvl 2");
  // give it a FINISHED barracks so the war_factory `requires` gate passes — isolating the base-level
  // gate, which must still reject the War Factory at Lvl 2.
  w.spawn("building", "barracks", 0, cc(w).pos.x - 6, cc(w).pos.y + 1);
  const wf = attempt(w, "war_factory");
  assert(wf.built === false && wf.toastKey === "errors.needBaseLevel", "War Factory still base-level-locked at Lvl 2");
}

console.log("At Level 3 the War Factory + Rocket Tower unlock:");
{
  const w = freshWorld();
  cc(w).level = 3;
  // war_factory also requires a barracks present — give it one
  w.spawn("building", "barracks", 0, cc(w).pos.x + 1, cc(w).pos.y + 6);
  assert(attempt(w, "war_factory").built === true, "War Factory builds at Lvl 3 (with a Barracks present)");
  assert(attempt(w, "rocket_tower").built === true, "Rocket Tower builds at Lvl 3");
}

console.log("maxBaseLevel() reports the player's highest Command-Center level:");
{
  const w = freshWorld();
  assert(w.maxBaseLevel(0) === 1, "fresh base → maxBaseLevel 1");
  cc(w).level = 3;
  assert(w.maxBaseLevel(0) === 3, "after levelling → maxBaseLevel 3");
}

console.log("");
if (failures === 0) { console.log("ALL T30 BASE-TECH TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T30 BASE-TECH TEST(S) FAILED ✗"); process.exit(1); }
