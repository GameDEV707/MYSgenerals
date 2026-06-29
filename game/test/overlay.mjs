// MYS Generals — T27 Part B overlay-layout test. Proves entityOverlayLayout() returns fixed,
// DISTINCT, ordered, non-overlapping slots so the rank/level pip, HP bar and the single secondary
// bar (construction/production/research) never collide, and that the renderer can reuse one object
// (no per-frame allocation). Pure (no browser).
// Run: NODE_OPTIONS="" node test/overlay.mjs
import { entityOverlayLayout } from "../dist/render/renderer.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

console.log("Slots are distinct, ordered (pip above secondary above HP), and non-overlapping:");
for (const topY of [0, 50, 123.5, 800]) {
  const s = entityOverlayLayout(topY);
  // bars are drawn upward (smaller y = higher on screen): pip < secondary < hp < topY
  assert(s.pipY < s.secY && s.secY < s.hpY && s.hpY < topY, `topY=${topY}: ordered pipY<secY<hpY<topY`);
  assert(s.hpY !== s.secY && s.secY !== s.pipY && s.hpY !== s.pipY, `topY=${topY}: all three slots distinct`);
  // each row is barH tall; require at least barH separation so rows never overlap
  assert(s.hpY - s.secY >= s.barH, `topY=${topY}: HP and secondary rows do not overlap`);
  assert(s.secY - s.pipY >= s.barH, `topY=${topY}: secondary and pip rows do not overlap`);
  assert(s.barH > 0, `topY=${topY}: positive bar height`);
}

console.log("The hero mana bar shares the SECONDARY slot (a hero shows no build bar — never doubled):");
{
  const s = entityOverlayLayout(100);
  assert(s.manaY === s.secY, "manaY === secY (one shared secondary row)");
}

console.log("Layout is a pure function of topY (deterministic):");
{
  const a = entityOverlayLayout(200), b = entityOverlayLayout(200);
  assert(a.hpY === b.hpY && a.secY === b.secY && a.pipY === b.pipY, "same input → same slots");
}

console.log("Optional out-param is reused (no per-frame allocation in the hot path):");
{
  const scratch = { hpY: 0, secY: 0, manaY: 0, pipY: 0, barH: 0 };
  const r1 = entityOverlayLayout(10, scratch);
  assert(r1 === scratch, "returns the SAME object that was passed in");
  const r2 = entityOverlayLayout(999, scratch);
  assert(r2 === scratch && scratch.hpY === entityOverlayLayout(999).hpY, "reusing the scratch updates it in place with correct values");
}

console.log("");
if (failures === 0) { console.log("ALL T27 OVERLAY-LAYOUT TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T27 OVERLAY-LAYOUT TEST(S) FAILED ✗"); process.exit(1); }
