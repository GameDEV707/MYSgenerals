// MYS Generals — headless simulation smoke test (Vitest-equivalent; sandbox has no npm).
// Verifies §13 damage matrix, §6 economy rates, §10.5 veterancy, §23 win/lose, §5 locale parity.
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";
import { damageMultiplier } from "../dist/data.js";
import { localeParity, t, setLang } from "../dist/i18n.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { console.error("  ✗ " + msg); failures++; } else { console.log("  ✓ " + msg); } }
function approx(a, b, eps, msg) { assert(Math.abs(a - b) <= eps, `${msg} (got ${a}, want ~${b})`); }

console.log("Damage matrix (§13.1):");
assert(damageMultiplier("Cannon", "AirLight") === 0, "Cannon cannot hit air");
assert(damageMultiplier("Bullet", "InfantryLight") === 1, "Bullet 100% vs infantry");
assert(damageMultiplier("Rocket", "VehicleHeavy") === 1.2, "Rocket 120% vs vehicles");
assert(damageMultiplier("Explosive", "StructureArmored") === 1.5, "Explosive 150% vs structures");
assert(damageMultiplier("Bullet", "VehicleHeavy") === 0.25, "Bullet 25% vs vehicles");

console.log("Locale parity (§5.4):");
const missing = localeParity();
assert(missing.length === 0, "all keys present in en/ru/uz" + (missing.length ? ": " + missing.slice(0, 5).join(",") : ""));
setLang("uz");
assert(t("hud.silver") === "Kumush", "uz Silver = Kumush");
assert(t("buildings.commandCenter.name").includes("shtab"), "uz Command Center localized");
setLang("ru");
assert(t("hud.victory") === "ПОБЕДА", "ru Victory cyrillic");
setLang("en");

function makePlayer(id, isAI, color) {
  return { id, silver: 15, iron: 0, gold: 0, color, isAI, aiDiff: "normal", defeated: false,
    powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}

console.log("Economy (§6 / §26.1):");
const map = getMap("twin_rivers");
const w = new World(map);
w.addPlayer(makePlayer(0, false, "#4ea3ff"));
w.addPlayer(makePlayer(1, true, "#ff5a4d"));
w.spawnBase(0, map.spawns[0]);
w.spawnBase(1, map.spawns[1]);
w.setupNeutrals();
assert(w.players[0].silver === 15, "starts with 15 silver");
// run ~10.25s (205 ticks) -> 1 miner => +1 silver
for (let i = 0; i < 205; i++) w.tick();
assert(w.players[0].silver === 16, "1 miner yields +1 silver / 10s (got " + w.players[0].silver + ")");
// power: CC(+5) - silver mine(-1) = +4, not brownout
assert(w.players[0].brownout === false, "no brownout with base + 1 mine");

console.log("Veterancy thresholds (§26.4):");
assert(w.rankFor(0) === 0, "0 xp = Rookie");
assert(w.rankFor(100) === 1, "100 xp = Veteran");
assert(w.rankFor(300) === 2, "300 xp = Elite");
assert(w.rankFor(700) === 3, "700 xp = Heroic");

console.log("Hero xp curve (§9.1):");
assert(w.heroXpNeeded(1) === 120, "level 1 threshold");
assert(w.heroXpNeeded(2) === 360, "level 2 threshold");

console.log("Win/lose (§23):");
w.eliminate(1);
w.tick();
assert(w.winner === 0, "eliminating player 1 makes player 0 winner (got " + w.winner + ")");

console.log("Placement validation (§7.3):");
const w2 = new World(map);
w2.addPlayer(makePlayer(0, false, "#4ea3ff"));
w2.addPlayer(makePlayer(1, true, "#ff5a4d"));
w2.spawnBase(0, map.spawns[0]);
assert(w2.placementValid(0, "power_plant", map.spawns[0].x + 2, map.spawns[0].y + 5) !== undefined, "placement check runs");
assert(w2.placementValid(0, "power_plant", 1000, 1000) === false, "out-of-bounds placement rejected");

console.log("");
if (failures === 0) { console.log("ALL TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " TEST(S) FAILED ✗"); process.exit(1); }
