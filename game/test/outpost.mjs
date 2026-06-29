// MYS Generals — T32 outpost (capturable garrisoned sub-base) test (spec §24 → T32 Part B).
// An outpost is a NEUTRAL defensive tower: it fires on intruders, is invulnerable to direct attack,
// and is captured by holding it under fire. On capture it fires for its new owner, becomes a forward
// build anchor (sub-base), and can be re-captured. Run: NODE_OPTIONS="" node test/outpost.mjs
import { World, NEUTRAL } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { OUTPOST_CAPTURE_TIME } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id) {
  return { id, silver: 5000, iron: 5000, gold: 5000, color: "#4ea3ff", isAI: false, aiDiff: "normal", defeated: false,
    powerGen: 999, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false }, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}
// `withCCs` keeps both players alive (each owns a Command Center far from the central outpost) so the
// sim keeps running; the "not a CC" block omits them on purpose.
function fresh(withCCs = true) {
  const map = getMap("iron_crossroads");
  const w = new World(map);
  w.addPlayer(mkPlayer(0)); w.addPlayer(mkPlayer(1));
  w.setupNeutrals();
  if (withCCs) {
    w.spawn("building", "command_center", 0, map.spawns[0].x, map.spawns[0].y);
    w.spawn("building", "command_center", 1, map.spawns[1].x, map.spawns[1].y);
  }
  return w;
}
function anOutpost(w) { return w.entities.find((e) => e.type === "outpost"); }

console.log("Outpost is a neutral garrisoned tower:");
{
  const w = fresh();
  const op = anOutpost(w);
  assert(!!op, "an outpost exists on the map");
  assert(op.owner === NEUTRAL, "it starts NEUTRAL");
  assert(!!op.weaponDef, "it has a garrison weapon");
  assert(op.kind === "neutral", "it is a neutral entity");
}

console.log("The garrison fires on an intruding enemy (and does not get stronger / no rank):");
{
  const w = fresh();
  const op = anOutpost(w);
  const ix = Math.floor(op.pos.x) + 3, iy = Math.floor(op.pos.y);
  const foot = w.spawn("unit", "infantry", 0, ix, iy); // within the gun's range (7)
  foot.stance = "hold"; // sit still so we just measure incoming fire
  const hp0 = foot.hp;
  for (let i = 0; i < 60; i++) w.tick(); // ~3 s
  assert(foot.hp < hp0 || foot.dead, "an intruding infantry takes garrison fire");
  assert(op.rank === 0 && op.level === 1, "the garrison never gains rank/level (fixed strength)");
}

console.log("The outpost is invulnerable to direct attack:");
{
  const w = fresh();
  const op = anOutpost(w);
  const hp0 = op.hp;
  // splash near it + a direct attack order should NOT damage a neutral structure
  w.splashDamage({ x: op.pos.x, y: op.pos.y }, 4, 9999, "Explosive", 0, null);
  const tank = w.spawn("unit", "heavy_tank", 0, Math.floor(op.pos.x) + 2, Math.floor(op.pos.y));
  w.issue({ t: "attack", ids: [tank.id], target: op.id });
  for (let i = 0; i < 40; i++) w.tick();
  assert(op.hp === hp0 && !op.dead, "neutral outpost takes no damage from splash or attack orders");
}

console.log("Capture by presence flips ownership (hold it under fire with a tanky unit):");
{
  const w = fresh();
  const op = anOutpost(w);
  // a heavy tank (VehicleHeavy) shrugs off the bullet garrison long enough to capture it
  w.spawn("unit", "heavy_tank", 0, Math.floor(op.pos.x) + 2, Math.floor(op.pos.y));
  const ticks = Math.ceil(OUTPOST_CAPTURE_TIME / 0.05) + 60;
  for (let i = 0; i < ticks; i++) w.tick();
  assert(op.owner === 0, "after holding it, the outpost is captured (owner 0)");
  assert(op.hp === op.maxHp, "the outpost itself was never destroyed — only captured");
}

console.log("A captured outpost is a forward sub-base (build anchor) and fires for its owner:");
{
  const w = fresh();
  const op = anOutpost(w);
  op.owner = 0; w.occupy(op, true); // simulate a completed capture
  // build anchor: a clear grass spot near the outpost is now buildable for owner 0…
  let anchored = false;
  for (let r = 3; r <= 7 && !anchored; r++) for (let a = 0; a < 16 && !anchored; a++) {
    const x = Math.round(op.pos.x + Math.cos(a / 16 * Math.PI * 2) * r);
    const y = Math.round(op.pos.y + Math.sin(a / 16 * Math.PI * 2) * r);
    if (w.placementValid(0, "power_plant", x, y)) anchored = true;
  }
  assert(anchored, "owner can build around the captured outpost (sub-base anchor)");
  // the captured outpost now shoots an enemy unit
  const enemy = w.spawn("unit", "infantry", 1, Math.floor(op.pos.x) + 3, Math.floor(op.pos.y));
  enemy.stance = "hold";
  const ehp0 = enemy.hp;
  for (let i = 0; i < 60; i++) w.tick();
  assert(enemy.hp < ehp0 || enemy.dead, "the captured outpost fires at enemy units");
  assert(op.owner === 0, "it remains the owner's until re-captured");
}

console.log("An outpost is not a Command Center (owning one doesn't keep a player alive):");
{
  const w = fresh(false); // no Command Centers this time
  const op = anOutpost(w);
  op.owner = 0;
  // owner 0 has no CC → winCheck should still eliminate them despite owning an outpost
  w.tick();
  assert(w.players[0].defeated === true, "owning only an outpost does not satisfy the CC win condition");
}

console.log("");
if (failures === 0) { console.log("ALL T32 OUTPOST TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T32 OUTPOST TEST(S) FAILED ✗"); process.exit(1); }
