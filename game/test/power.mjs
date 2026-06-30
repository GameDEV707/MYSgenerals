// MYS Generals — T28 Part B power tests (spec §24 → T28). The authoritative power gate in
// world.tryBuild() must REJECT a power-consuming building when there is no spare generation (no
// charge, no spawn, errors.needPower toast), ALLOW it when there is headroom, and NEVER block a
// power producer; plus the pure powerStatus() classifier (ok / low ≥90% / deficit). Headless.
// Run: NODE_OPTIONS="" node test/power.mjs
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { powerStatus } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id) {
  return { id, silver: 1000, iron: 1000, gold: 1000, color: "#4ea3ff", isAI: false, aiDiff: "normal", defeated: false,
    powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
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
// find a valid build tile for `building` near the player's CC (so placement passes and we isolate
// the power check).
function validSpot(w, building) {
  const c = cc(w);
  for (let r = 2; r <= 7; r++) for (let a = 0; a < 16; a++) {
    const x = Math.round(c.pos.x + Math.cos(a / 16 * Math.PI * 2) * r);
    const y = Math.round(c.pos.y + Math.sin(a / 16 * Math.PI * 2) * r);
    if (w.placementValid(0, building, x, y)) return { x, y };
  }
  return null;
}

console.log("powerStatus() classifies ok / low (≥90%) / deficit:");
assert(powerStatus(10, 0) === "ok", "0/10 → ok");
assert(powerStatus(10, 8) === "ok", "8/10 (80%) → ok");
assert(powerStatus(10, 9) === "low", "9/10 (90%) → low");
assert(powerStatus(10, 10) === "low", "10/10 (100%, not over) → low");
assert(powerStatus(10, 11) === "deficit", "11/10 → deficit");
assert(powerStatus(0, 0) === "ok", "0/0 → ok");

console.log("A power-consuming build is REJECTED when usage would exceed generation:");
{
  const w = freshWorld();
  const spot = validSpot(w, "silver_mine"); // silver_mine consumes 1 power, no prereq/deposit
  assert(!!spot, "found a valid placement near the CC");
  const p = w.players[0];
  p.powerGen = 9; p.powerUse = 9;        // no headroom; silver_mine demand 1 → 9+1 > 9
  const before = w.entities.length, silver0 = p.silver;
  w.drainEvents();
  w.tryBuild({ t: "build", owner: 0, building: "silver_mine", x: spot.x, y: spot.y });
  const ev = w.drainEvents();
  assert(w.entities.length === before, "no building was created");
  assert(p.silver === silver0, "the player was NOT charged");
  assert(ev.some((e) => e.e === "toast" && e.key === "errors.needPower"), "errors.needPower toast was emitted");
}

console.log("The same build is ALLOWED when there is enough headroom:");
{
  const w = freshWorld();
  const spot = validSpot(w, "silver_mine");
  const p = w.players[0];
  p.powerGen = 10; p.powerUse = 9;       // 9+1 = 10, not > 10 → allowed
  const before = w.entities.length, silver0 = p.silver;
  w.tryBuild({ t: "build", owner: 0, building: "silver_mine", x: spot.x, y: spot.y });
  assert(w.entities.length === before + 1, "the building was created with headroom");
  assert(p.silver < silver0, "the player was charged for it");
}

console.log("A power PRODUCER (power plant) is never blocked, even at full deficit:");
{
  const w = freshWorld();
  const spot = validSpot(w, "power_plant");
  assert(!!spot, "found a valid placement for the power plant");
  const p = w.players[0];
  p.powerGen = 5; p.powerUse = 20;       // already in deficit
  const before = w.entities.length;
  w.tryBuild({ t: "build", owner: 0, building: "power_plant", x: spot.x, y: spot.y });
  assert(w.entities.length === before + 1, "the power plant was built despite the deficit");
}

console.log("In-progress consumers count against headroom (cannot queue several over budget):");
{
  const w = freshWorld();
  const p = w.players[0];
  p.powerGen = 10; p.powerUse = 7;       // 3 spare
  const s1 = validSpot(w, "silver_mine");
  w.tryBuild({ t: "build", owner: 0, building: "silver_mine", x: s1.x, y: s1.y }); // demand 1 → committed 8
  // place a second consumer elsewhere; committed 7 + in-progress 1 = 8, +1 = 9 ≤ 10 → allowed
  const n1 = w.entities.length;
  // now force a bigger consumer that would exceed: iron_mine demand 2 needs a deposit, so simulate
  // by raising powerUse to the cap and trying another silver_mine
  p.powerUse = 9; // committed = 9 + the in-progress silver_mine(1) = 10, +1 = 11 > 10 → rejected
  const s2 = validSpot(w, "silver_mine");
  w.drainEvents();
  if (s2) w.tryBuild({ t: "build", owner: 0, building: "silver_mine", x: s2.x, y: s2.y });
  const ev = w.drainEvents();
  assert(w.entities.length === n1, "the over-budget second consumer was rejected (in-progress counted)");
  assert(ev.some((e) => e.e === "toast" && e.key === "errors.needPower"), "errors.needPower emitted for the over-budget build");
}

console.log("");
if (failures === 0) { console.log("ALL T28 POWER TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T28 POWER TEST(S) FAILED ✗"); process.exit(1); }
