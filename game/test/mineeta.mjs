// MYS Generals — T29 Part B mine-ETA test. The pure mineEta() helper computes the seconds until a
// resource mine's next +1 from its resAccum + the relevant interval (and minerSlots for silver),
// reports "idle" for a silver mine with no miners, and counts down as resAccum rises. Verified
// across silver / iron / gold / captured oil. Headless, dependency-free.
// Run: NODE_OPTIONS="" node test/mineeta.mjs
import { mineEta, MINER_OUTPUT_INTERVAL, SILVER_MINE_SLOTS, IRON_INTERVAL, GOLD_INTERVAL, OIL_INTERVAL } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

console.log("A silver mine with NO miner is idle (no countdown, prompts to assign a miner):");
{
  const e = mineEta("silver_mine", 0, 0);
  assert(e !== null, "returns a readout for a silver mine");
  assert(e.idle === true, "idle === true with 0 miners");
  assert(e.seconds === null, "idle reports no countdown (seconds null)");
  assert(e.progress === 0, "idle progress is 0");
  assert(e.resource === "silver", "yields silver");
}

console.log("T31: ONE miner works a silver mine → its single-miner rate (no multi-miner scaling):");
{
  // from empty, a worked silver mine takes MINER_OUTPUT_INTERVAL to the next +1, regardless of count.
  assert(near(mineEta("silver_mine", 0, 1).seconds, MINER_OUTPUT_INTERVAL), "1 miner → 10s to next");
  assert(mineEta("silver_mine", 0, 1).idle === false, "a worked silver mine is not idle");
  // even if more miners are (defensively) reported, the rate does not scale up
  assert(near(mineEta("silver_mine", 0, 3).seconds, MINER_OUTPUT_INTERVAL), "rate does not scale with extra miners (one-per-mine)");
}

console.log("Iron and gold mines (T30: need a miner inside) count down on their fixed intervals when occupied:");
{
  assert(near(mineEta("iron_mine", 0, 1).seconds, IRON_INTERVAL), "iron (occupied) from empty → 15s");
  assert(mineEta("iron_mine", 0, 1).resource === "iron" && mineEta("iron_mine", 0, 1).idle === false, "iron yields iron when occupied");
  assert(near(mineEta("gold_mine", 0, 1).seconds, GOLD_INTERVAL), "gold (occupied) from empty → 30s");
  assert(mineEta("gold_mine", 0, 1).resource === "gold", "gold yields gold");
}

console.log("T30: every mine (iron/gold/oil too) is idle with NO miner inside (no output):");
{
  assert(mineEta("iron_mine", 0, 0).idle === true && mineEta("iron_mine", 0, 0).seconds === null, "iron with 0 miners → idle");
  assert(mineEta("gold_mine", 0, 0).idle === true && mineEta("gold_mine", 0, 0).seconds === null, "gold with 0 miners → idle");
  assert(mineEta("oil_derrick", 0, 0).idle === true && mineEta("oil_derrick", 0, 0).seconds === null, "captured oil with 0 miners → idle");
  // resource is still reported while idle so the UI can colour the hint
  assert(mineEta("iron_mine", 0, 0).resource === "iron" && mineEta("gold_mine", 0, 0).resource === "gold", "idle mines still report their resource");
}

console.log("A captured oil derrick (occupied) yields silver on the oil interval:");
{
  const e = mineEta("oil_derrick", 0, 1);
  assert(near(e.seconds, OIL_INTERVAL), "oil (occupied) from empty → 5s");
  assert(e.resource === "silver" && e.idle === false, "oil yields silver when occupied");
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
  assert(mineEta("iron_mine", 1.5, 1).seconds <= 0 + 1e-9, "resAccum > 1 clamps to 0s remaining");
  assert(mineEta("iron_mine", -1, 1).seconds <= IRON_INTERVAL + 1e-9, "negative resAccum clamps to full interval");
  assert(mineEta("barracks", 0.4, 1) === null, "a non-mine building → null");
  assert(mineEta("command_center", 0, 3) === null, "command center → null");
}

console.log("");
if (failures === 0) { console.log("ALL T29 MINE-ETA TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T29 MINE-ETA TEST(S) FAILED ✗"); process.exit(1); }
