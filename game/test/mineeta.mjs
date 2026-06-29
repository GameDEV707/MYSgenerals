// MYS Generals — T29 Part B mine-ETA test. The pure mineEta() helper computes the seconds until a
// resource mine's next +1 from its resAccum + the relevant interval (and minerSlots for silver),
// reports "idle" for a silver mine with no miners, and counts down as resAccum rises. Verified
// across silver / iron / gold / captured oil. Headless, dependency-free.
// Run: NODE_OPTIONS="" node test/mineeta.mjs
import { mineEta, MINER_OUTPUT_INTERVAL, SILVER_MINE_SLOTS, IRON_INTERVAL, GOLD_INTERVAL, OIL_INTERVAL } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

console.log("A silver mine with NO miners is idle (no countdown, prompts to assign miners):");
{
  const e = mineEta("silver_mine", 0, 0);
  assert(e !== null, "returns a readout for a silver mine");
  assert(e.idle === true, "idle === true with 0 miners");
  assert(e.seconds === null, "idle reports no countdown (seconds null)");
  assert(e.progress === 0, "idle progress is 0");
  assert(e.resource === "silver", "yields silver");
}

console.log("A silver mine's countdown scales with the number of working miners (capped at the slots):");
{
  // rate = slots / MINER_OUTPUT_INTERVAL per second; from empty, seconds-to-next = MINER_OUTPUT_INTERVAL / slots.
  assert(near(mineEta("silver_mine", 0, 1).seconds, MINER_OUTPUT_INTERVAL / 1), "1 miner → 10s to next");
  assert(near(mineEta("silver_mine", 0, 2).seconds, MINER_OUTPUT_INTERVAL / 2), "2 miners → 5s to next");
  assert(near(mineEta("silver_mine", 0, 3).seconds, MINER_OUTPUT_INTERVAL / 3), "3 miners → 10/3 s to next");
  // extra miners beyond the work-slot cap do not speed it up further
  assert(near(mineEta("silver_mine", 0, 5).seconds, mineEta("silver_mine", 0, SILVER_MINE_SLOTS).seconds), "miners beyond the cap don't help");
  assert(mineEta("silver_mine", 0, 5).idle === false, "a capped/over-full silver mine is not idle");
}

console.log("Iron and gold mines count down on their fixed intervals (no miners needed):");
{
  assert(near(mineEta("iron_mine", 0, 0).seconds, IRON_INTERVAL), "iron from empty → 15s");
  assert(mineEta("iron_mine", 0, 0).resource === "iron" && mineEta("iron_mine", 0, 0).idle === false, "iron yields iron, never idle");
  assert(near(mineEta("gold_mine", 0, 0).seconds, GOLD_INTERVAL), "gold from empty → 30s");
  assert(mineEta("gold_mine", 0, 0).resource === "gold", "gold yields gold");
}

console.log("A captured oil derrick yields silver on the oil interval:");
{
  const e = mineEta("oil_derrick", 0, 0);
  assert(near(e.seconds, OIL_INTERVAL), "oil from empty → 5s");
  assert(e.resource === "silver" && e.idle === false, "oil yields silver, never idle");
}

console.log("The countdown shrinks as resAccum rises toward the next unit (across all mine types):");
for (const type of ["silver_mine", "iron_mine", "gold_mine", "oil_derrick"]) {
  const slots = 2; // only used by silver
  const lo = mineEta(type, 0.0, slots).seconds;
  const mid = mineEta(type, 0.5, slots).seconds;
  const hi = mineEta(type, 0.9, slots).seconds;
  assert(lo > mid && mid > hi, `${type}: seconds decrease 0.0 → 0.5 → 0.9 (counts down)`);
  assert(near(mineEta(type, 0.5, slots).progress, 0.5), `${type}: progress mirrors resAccum (0.5)`);
  assert(near(mineEta(type, 1.0, slots).seconds, 0), `${type}: at full accum the next unit is imminent (~0s)`);
}

console.log("resAccum is clamped (defensive) and non-mine types return null:");
{
  assert(mineEta("iron_mine", 1.5, 0).seconds <= 0 + 1e-9, "resAccum > 1 clamps to 0s remaining");
  assert(mineEta("iron_mine", -1, 0).seconds <= IRON_INTERVAL + 1e-9, "negative resAccum clamps to full interval");
  assert(mineEta("barracks", 0.4, 0) === null, "a non-mine building → null");
  assert(mineEta("command_center", 0, 3) === null, "command center → null");
}

console.log("");
if (failures === 0) { console.log("ALL T29 MINE-ETA TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T29 MINE-ETA TEST(S) FAILED ✗"); process.exit(1); }
