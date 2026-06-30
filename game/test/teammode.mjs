// MYS Generals — custom-team mode tests: lobby team assignment + buildPlayers, team-aware
// spawning (shared base + one hero AND one builder Engineer per player), allies (no friendly fire),
// team win condition, and shared vision + shared economy/control (a teammate driving the team's
// engineer and building into the one shared base).
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

console.log("Shared vision + shared economy/control (the reported bug):");
import { MatchHost } from "../dist/host/matchHost.js";
const map2 = getMap("crossfire");
const w2 = new World(map2);
// team 0 = players 0 (leader, base) + 1 (hero-only teammate); team 1 = player 2 (enemy)
[ [0,0], [1,0], [2,1] ].forEach(([id, tm]) => w2.addPlayer(mkPlayer(id, tm)));
w2.spawnAllBases("team");
const host = new MatchHost(w2);
const leaderCC = w2.entities.find((e) => e.type === "command_center" && e.owner === 0);
// player 1 is the hero-only teammate — without vision sharing it could never see the base.
const grid1 = host.computeVisibility(1);
const ccTileVisible = grid1[Math.floor(leaderCC.pos.y) * map2.w + Math.floor(leaderCC.pos.x)] === 1;
assert(ccTileVisible, "teammate (hero-only) shares vision of the team's HQ tile");

const snap1 = host.buildSnapshot(1, grid1);
const seesCC = snap1.entities.some((e) => e.id === leaderCC.id && e.o === 0);
assert(seesCC, "teammate's snapshot includes the shared HQ (was the missing bosh shtab)");
// the HQ comes through as full detail (own/ally), so its queue/level data is available to control it
const ccSnap = snap1.entities.find((e) => e.id === leaderCC.id);
assert(ccSnap && ("q" in ccSnap || ccSnap.k === "b"), "shared HQ arrives as full-detail (controllable) entity");

// shared economy: the teammate's HUD economy reflects the side's base owner, not their empty purse
w2.players[0].silver = 123; w2.players[1].silver = 7;
const snap1b = host.buildSnapshot(1, host.computeVisibility(1));
const you1 = snap1b.players.find((p) => p.id === 1);
assert(you1.silver === 123, "teammate sees the SIDE's shared economy (base owner's silver)");

// the enemy's HQ is NOT shared with team 0 (fog still applies across sides)
const enemyCC = w2.entities.find((e) => e.type === "command_center" && e.owner === 2);
const enemyTileVisible = grid1[Math.floor(enemyCC.pos.y) * map2.w + Math.floor(enemyCC.pos.x)] === 1;
assert(!enemyTileVisible, "enemy side's HQ stays hidden (no cross-side vision leak)");

console.log("Teammate drives their OWN engineer and BUILDS into the shared base (the reported bug):");
// Each non-leader teammate is now spawned their own builder Engineer, owned by the side's base owner
// (player 0 = the shared economy) so it builds into the one team base while the teammate (player 1)
// drives it via shared control.
const sideEngineers = w2.entities.filter((e) => e.type === "engineer" && e.owner === 0 && !e.dead);
assert(sideEngineers.length >= 2, "the side has a builder for the leader AND one for the teammate (>= 2 engineers)");

// Player 1 (the teammate) commands an ally-owned engineer — the host must NOT silently drop it.
const eng = sideEngineers[0];
host.submit({ playerId: 1, clientTick: 1, cmd: { t: "move", ids: [eng.id], x: Math.floor(eng.pos.x) + 6, y: Math.floor(eng.pos.y) + 6 } });
w2.tick();
assert(eng.moveTarget !== null, "teammate (player 1) CAN move an ally-owned engineer (host accepts shared control)");

// Player 1 builds a Power Plant next to the shared HQ. The host coerces the owner to the side's base
// owner (player 0), spends the SHARED wallet and dispatches a side engineer — so the building rises.
w2.players[0].silver = 999;
let bx = -1, by = -1;
for (let r = 2; r <= 7 && bx < 0; r++) {
  for (let dy = -r; dy <= r && bx < 0; dy++) for (let dx = -r; dx <= r && bx < 0; dx++) {
    const tx = Math.floor(leaderCC.pos.x) + dx, ty = Math.floor(leaderCC.pos.y) + dy;
    if (w2.placementValid(0, "power_plant", tx, ty)) { bx = tx; by = ty; }
  }
}
assert(bx >= 0, "a valid build spot exists next to the shared HQ");
host.submit({ playerId: 1, clientTick: 2, cmd: { t: "build", owner: 1, building: "power_plant", x: bx, y: by } });
w2.tick();
const newPP = w2.entities.find((e) => e.type === "power_plant" && !e.dead);
assert(!!newPP, "teammate's build actually places a building (was silently dropped before the fix)");
assert(newPP && newPP.owner === 0, "the teammate's building is owned by / charged to the side's shared base owner");

console.log("");
if (failures === 0) { console.log("ALL TEAM-MODE TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " TEAM-MODE TEST(S) FAILED ✗"); process.exit(1); }