// MYS Generals — custom-team mode tests: lobby team assignment + buildPlayers, team-aware
// spawning (shared base + one hero per player), allies (no friendly fire) and team win condition.
// Run: NODE_OPTIONS="" node test/teammode.mjs
import { Lobby } from "../dist/host/lobby.js";
import { World } from "../dist/sim/world.js";
import { getMap } from "../dist/sim/map.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id, team) {
  return { id, silver: 15, iron: 0, gold: 0, color: "#4ea3ff", isAI: false, aiDiff: "normal", team, defeated: false,
    powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false }, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}

console.log("Lobby custom-team mode:");
const lob = new Lobby("", "crossfire", "TEAM"); // 4 slots
lob.setGameType("team");
assert(lob.state.gameType === "team", "game type switches to team");
// fill: host (slot0) + 3 AIs → 2v2 needs two on each side
lob.addAITeam(0, "normal"); // slot 1 → blue
lob.addAITeam(1, "normal"); // slot 2 → red
lob.addAITeam(1, "normal"); // slot 3 → red
lob.setTeam(0, 0);          // host blue
lob.setReady(0, true);
assert(lob.teamMembers(0).length === 2 && lob.teamMembers(1).length === 2, "2v2 split across the two sides");
assert(lob.canStart() === true, "can start when both sides have members and host ready");

const specs = lob.buildPlayers();
const blue = specs.filter((s) => s.team === 0), red = specs.filter((s) => s.team === 1);
assert(blue.length === 2 && red.length === 2, "buildPlayers tags each player with a side");
assert(blue.every((s) => s.color === blue[0].color) && red.every((s) => s.color === red[0].color), "each side shares its colour");
assert(blue[0].color !== red[0].color, "the two sides use distinct colours");

console.log("Team spawning (shared base + one hero per player):");
const map = getMap("crossfire");
const w = new World(map);
specs.forEach((s, i) => w.addPlayer(mkPlayer(i, s.team)));
w.spawnAllBases("team");
const ccs = w.entities.filter((e) => e.type === "command_center" && !e.dead);
assert(ccs.length === 2, "one shared Command Center per side (2 total), not one per player");
const heroes = w.entities.filter((e) => e.type === "hero" && !e.dead);
assert(heroes.length === 4, "one hero per player (4 total) — each player drives their own");
// each player owns exactly one hero
const heroOwners = new Set(heroes.map((h) => h.owner));
assert(heroOwners.size === 4, "every player owns their own hero");
// non-leader teammates have no command center of their own
const leaderOwners = new Set(ccs.map((c) => c.owner));
assert(leaderOwners.size === 2, "exactly two players (one per side) own the base");

console.log("Allies don't fight each other:");
const h0 = heroes.find((h) => w.players[h.owner].team === 0);
const h0b = heroes.find((h) => w.players[h.owner].team === 0 && h.owner !== h0.owner);
const r0 = heroes.find((h) => w.players[h.owner].team === 1);
assert(w.isEnemy(h0, h0b) === false, "same-side heroes are allies (not enemies)");
assert(w.isEnemy(h0, r0) === true, "opposite-side heroes are enemies");

console.log("Team win condition (a side survives while it holds any base):");
// destroy ONE blue base owner's CC: blue still has... actually blue has ONE shared CC. Kill red's CC → blue wins.
const redCC = ccs.find((c) => w.players[c.owner].team === 1);
redCC.hp = 0; w.onKill(redCC, h0.owner, h0);
w.tick();
const redPlayers = w.players.filter((p) => p.team === 1);
assert(redPlayers.every((p) => p.defeated), "losing the side's only base eliminates ALL its members");
assert(w.winner >= 0 && w.players[w.winner].team === 0, "the surviving side wins");

console.log("");
if (failures === 0) { console.log("ALL TEAM-MODE TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " TEAM-MODE TEST(S) FAILED ✗"); process.exit(1); }
