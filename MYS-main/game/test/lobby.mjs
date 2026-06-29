// MYS Generals — lobby controller tests (spec §18.3). Slots, AI add/kick, split-screen, ready,
// map change, start gating, player-list build. Run: node test/lobby.mjs
import { Lobby } from "../dist/host/lobby.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

console.log("Lobby slots & start gating (§18.3):");
const lob = new Lobby("http://192.168.1.5:3000", "twin_rivers", "ABCD");
assert(lob.state.slots.length === 2, "twin_rivers → 2 slots");
assert(lob.state.slots[0].kind === "human", "slot 0 is the host (human)");
assert(lob.state.slots[1].kind === "open", "slot 1 starts open");
assert(lob.canStart() === false, "cannot start with only the host (needs 2 participants)");

lob.addAI("hard");
assert(lob.state.slots[1].kind === "ai" && lob.state.slots[1].ai === "hard", "addAI fills the open slot with a hard AI");
assert(lob.canStart() === false, "still cannot start: host is not ready");
lob.setReady(0, true);
assert(lob.canStart() === true, "can start once the host is ready (host + AI)");

console.log("Colors stay distinct (§18.3):");
const hostColor = lob.state.slots[0].color;
lob.setColor(1, hostColor); // try to clash with host's color
assert(lob.state.slots[1].color !== hostColor, "cannot set a slot to a color already in use");

console.log("Split-screen toggle (§18.3 / §21):");
const l2 = new Lobby("http://192.168.1.5:3000", "crossfire");
assert(l2.state.slots.length === 4, "crossfire → 4 slots");
l2.setSplit(true);
assert(l2.state.splitScreen === true, "split-screen enabled");
const locals = l2.localPlayerIds();
assert(locals.length === 2 && locals[0] === 0, "two LOCAL players (A=host=0, B=first open slot) for loopback");
const bIdx = locals[1];
assert(l2.state.slots[bIdx].kind === "human" && l2.state.slots[bIdx].ready, "split adds a local Player B (human, auto-ready)");
l2.setReady(0, true);
assert(l2.canStart(), "can start a split-screen match");

console.log("Player-list build (ids = slot index):");
const players = l2.buildPlayers();
assert(players.length >= 2, "builds a player list for occupied slots");
assert(players.every((p) => typeof p.id === "number"), "each player has a numeric id");
assert(players.some((p) => !p.isAI) && l2.humanSlots().length >= 1, "includes human participants");

console.log("Disable split reverts the local Player B (§18.3):");
l2.setSplit(false);
assert(l2.state.slots[bIdx].kind === "open", "Player B slot reverts to open when split is disabled");

console.log("");
if (failures === 0) { console.log("ALL LOBBY TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " LOBBY TEST(S) FAILED ✗"); process.exit(1); }
