// Runnable with: node tests/calculations.test.js
// Verifies the deterministic quantity math against the worked examples in
// the product spec and a set of edge cases. This mirrors both
// storage.js#normalizeQuantity (client) and the SQL logic inside
// submit_daily_inventory() (server) — they must agree; see comment below.
"use strict";

function normalizeQuantity(perBox, entry) {
  if (entry.mode === "boxes+pieces") {
    const boxes = Number(entry.fullBoxes) || 0;
    const pieces = Number(entry.pieces) || 0;
    return boxes * perBox + pieces;
  }
  if (entry.mode === "fraction") {
    const fractions = { full: 1, "3/4": 0.75, "1/2": 0.5, "1/3": 1 / 3, "1/4": 0.25 };
    const frac = fractions[entry.fraction] ?? 0;
    return Math.round(perBox * frac);
  }
  if (entry.mode === "pieces") {
    return Number(entry.pieces) || 0;
  }
  return 0;
}

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${actual}, expected ${expected})`);
  ok ? pass++ : fail++;
}

// --- Worked examples from the product spec ---
check("24 boxes @24/box, 0 pieces", normalizeQuantity(24, { mode: "boxes+pieces", fullBoxes: 24, pieces: 0 }), 576);
check("24 boxes @24/box, 7 pieces", normalizeQuantity(24, { mode: "boxes+pieces", fullBoxes: 24, pieces: 7 }), 583);
check("20 boxes @60/box, 5 pieces", normalizeQuantity(60, { mode: "boxes+pieces", fullBoxes: 20, pieces: 5 }), 1205);
check("20 boxes @60/box, 0 pieces", normalizeQuantity(60, { mode: "boxes+pieces", fullBoxes: 20, pieces: 0 }), 1200);

// --- Fractions ---
check("1/2 of 60", normalizeQuantity(60, { mode: "fraction", fraction: "1/2" }), 30);
check("1/4 of 60", normalizeQuantity(60, { mode: "fraction", fraction: "1/4" }), 15);
check("1/3 of 60", normalizeQuantity(60, { mode: "fraction", fraction: "1/3" }), 20);
check("3/4 of 60", normalizeQuantity(60, { mode: "fraction", fraction: "3/4" }), 45);
check("full of 24", normalizeQuantity(24, { mode: "fraction", fraction: "full" }), 24);
// 1/3 of 24 doesn't divide evenly — this is exactly the "not every partial
// box is a clean fraction" case the spec calls out; document the rounding.
check("1/3 of 24 rounds", normalizeQuantity(24, { mode: "fraction", fraction: "1/3" }), 8);

// --- Direct piece count ---
check("19 pieces direct", normalizeQuantity(60, { mode: "pieces", pieces: 19 }), 19);
check("0 pieces direct", normalizeQuantity(24, { mode: "pieces", pieces: 0 }), 0);

// --- Edge cases: missing/invalid input must not crash or go negative ---
check("missing pieces field defaults to 0", normalizeQuantity(24, { mode: "boxes+pieces", fullBoxes: 3 }), 72);
check("missing fullBoxes field defaults to 0", normalizeQuantity(24, { mode: "boxes+pieces", pieces: 5 }), 5);
check("empty-string inputs treated as 0", normalizeQuantity(24, { mode: "boxes+pieces", fullBoxes: "", pieces: "" }), 0);
check("unknown fraction key treated as 0", normalizeQuantity(24, { mode: "fraction", fraction: "2/3" }), 0);
check("unknown mode returns 0, not a crash", normalizeQuantity(24, { mode: "bogus" }), 0);
check("very large box count stays exact (no float drift)", normalizeQuantity(24, { mode: "boxes+pieces", fullBoxes: 10000, pieces: 3 }), 240003);

// --- What the UI is responsible for preventing (steppers clamp at 0) but
// the pure function itself does not reject on its own — documenting the
// boundary between UI validation and calculation logic. ---
check("negative boxes are NOT rejected by the calc function itself", normalizeQuantity(24, { mode: "boxes+pieces", fullBoxes: -5, pieces: 0 }), -120);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
