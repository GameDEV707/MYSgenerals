// MYS Generals — T34 Neutral FORTRESS faction test (spec §24 → T34 Part B). A fortress is an
// unowned (white), HOSTILE keep with a FIXED garrison (anti-air "zenit" tanks + tanks + gun towers).
// It is two-way targetable and captured by shooting it DOWN from range: at 0 HP it flips to the
// attacker (keep + surviving garrison) instead of dying, awards a bounty, and becomes a build anchor.
// The derrick/outpost stay non-targetable capture-by-presence points. Run: NODE_OPTIONS="" node test/fortress.mjs
import { World, NEUTRAL } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { FORTRESS_CAPTURE_BOUNTY, FORTRESS_GARRISON, BUILD_RADIUS } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id) {
  return { id, silver: 0, iron: 0, gold: 0, color: "#4ea3ff", isAI: false, aiDiff: "normal", defeated: false,
    powerGen: 999, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false }, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}
function fresh() {
  const w = new World(getMap("iron_octagon"));
  w.addPlayer(mkPlayer(0)); w.addPlayer(mkPlayer(1));
  w.setupNeutrals();
  return w;
}
const keeps = (w) => w.entities.filter((e) => e.type === "fortress" && !e.dead);
const garrisonOf = (w, keep) => w.entities.filter((e) => e.fortressId === keep.id && e.id !== keep.id && !e.dead);

console.log("setupNeutrals spawns three white, hostile fortress keeps with fixed garrisons:");
{
  const w = fresh();
  const ks = keeps(w);
  assert(ks.length === 3, "three fortress keeps spawned");
  let allOk = true, weaponed = true, hostile = true;
  for (const k of ks) {
    if (k.kind !== "neutral" || k.type !== "fortress" || k.owner !== NEUTRAL) allOk = false;
    if (!k.weaponDef) weaponed = false;
    if (!k.hostileNeutral || k.fortressId !== k.id) hostile = false;
  }
  assert(allOk, "each keep is kind:neutral type:fortress owner:-1");
  assert(weaponed, "each keep has a weapon");
  assert(hostile, "each keep is hostileNeutral and links to itself (fortressId === id)");

  const perKeep = FORTRESS_GARRISON.units.reduce((s, u) => s + u.n, 0) + FORTRESS_GARRISON.towers.reduce((s, t) => s + t.n, 0);
  let garrisonOk = true, taggedOk = true;
  for (const k of ks) {
    const g = garrisonOf(w, k);
    if (g.length !== perKeep) garrisonOk = false;
    if (!g.every((e) => e.hostileNeutral && e.owner === NEUTRAL && e.fortressId === k.id)) taggedOk = false;
  }
  assert(garrisonOk, `each keep has its full fixed garrison (${perKeep} entities)`);
  assert(taggedOk, "every garrison entity is hostile, neutral, and tagged with its keep id");
}

console.log("The garrison includes anti-air 'zenit' units and gun towers:");
{
  const w = fresh();
  const k = keeps(w)[0];
  const g = garrisonOf(w, k);
  assert(g.some((e) => e.type === "anti_air"), "garrison contains anti-air (zenit) units");
  assert(g.filter((e) => e.kind === "unit").length >= 3, "garrison fields multiple defending vehicles");
  assert(g.some((e) => e.type === "cannon_tower" || e.type === "rocket_tower"), "garrison contains gun towers");
}

console.log("Two-way hostility — only the fortress + garrison, not the derrick/outpost:");
{
  const w = fresh();
  const k = keeps(w)[0];
  const foot = w.spawn("unit", "infantry", 0, Math.floor(k.pos.x) + 3, Math.floor(k.pos.y));
  assert(w.isEnemy(foot, k) === true, "a player unit treats the fortress as an enemy (can target it)");
  assert(w.isEnemy(k, foot) === true, "the fortress treats a player unit as an enemy (fires back)");
  const outpost = w.entities.find((e) => e.type === "outpost");
  assert(w.isEnemy(foot, outpost) === false, "the outpost stays non-targetable (capture-by-presence unchanged)");
  const derrick = w.entities.find((e) => e.type === "oil_derrick");
  assert(w.isEnemy(foot, derrick) === false, "the oil derrick stays non-targetable");
  const gunit = garrisonOf(w, k).find((e) => e.kind === "unit");
  assert(w.isEnemy(foot, gunit) === true && w.isEnemy(gunit, foot) === true, "garrison units are two-way hostile too");
}

console.log("Capture-by-defeat — at 0 HP the keep flips to the attacker (it is not destroyed):");
{
  const w = fresh();
  const k = keeps(w)[0];
  const survivors = garrisonOf(w, k);
  // kill ONE garrison unit first so we can prove the killed defenders do NOT come back on capture.
  const doomed = survivors.find((e) => e.kind === "unit");
  doomed.hp = 1; w.dealDamageRaw(doomed, 9999, "Cannon", 0);
  assert(doomed.dead === true, "a garrison unit taken to 0 HP DIES (no capture, no flip)");

  const bankBefore = w.players[0].silver;
  k.hp = 50;
  w.dealDamageRaw(k, 9999, "Cannon", 0); // owner 0 lands the finishing blow
  assert(!k.dead, "the keep is NOT destroyed at 0 HP");
  assert(k.owner === 0, "the keep flips to the attacker (owner 0)");
  assert(k.hp === k.maxHp, "the captured keep resets to full HP");
  assert(k.hostileNeutral === false, "the captured keep is no longer a hostile neutral");
  const flipped = w.entities.filter((e) => e.fortressId === k.id && e.id !== k.id && !e.dead);
  assert(flipped.length > 0 && flipped.every((e) => e.owner === 0 && !e.hostileNeutral), "surviving garrison flips to the capturer");
  assert(!flipped.some((e) => e.id === doomed.id), "the destroyed defender stays dead (not revived)");
  assert(w.players[0].silver === bankBefore + FORTRESS_CAPTURE_BOUNTY, "the capturer's bank gains the capture bounty");
}

console.log("A captured fortress is a forward build anchor:");
{
  const w = fresh();
  const k = keeps(w)[0];
  k.hp = 50; w.dealDamageRaw(k, 9999, "Cannon", 0);
  assert(k.owner === 0, "fortress captured by owner 0");
  let anchored = false;
  for (let r = 4; r <= BUILD_RADIUS && !anchored; r++) for (let a = 0; a < 24 && !anchored; a++) {
    const x = Math.round(k.pos.x + Math.cos(a / 24 * Math.PI * 2) * r);
    const y = Math.round(k.pos.y + Math.sin(a / 24 * Math.PI * 2) * r);
    if (w.placementValid(0, "power_plant", x, y)) anchored = true;
  }
  assert(anchored, "owner can build around the captured fortress (forward sub-base anchor)");
}

console.log("");
if (failures === 0) { console.log("ALL T34 FORTRESS TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T34 FORTRESS TEST(S) FAILED ✗"); process.exit(1); }
