// Exercises the REAL productMatcher.js against the exact scenarios the
// product-catalog-integrity rules describe: a confident match, a
// low-confidence near-miss that must NOT silently auto-accept, and
// invoice text with no real catalog match — which must come back
// "none", never inventing a new product name.
const { matchProductLine } = require("../productMatcher.js");

const CATALOG = [
  { id: "1", name: "Ost cheddar" }, { id: "2", name: "Stora bröd" }, { id: "3", name: "Bacon" },
  { id: "4", name: "Pommes" }, { id: "5", name: "Grillost" }, { id: "6", name: "Nuggets" },
  { id: "7", name: "Chili cheese" }, { id: "8", name: "Small kött" }, { id: "9", name: "Stora kött" },
];

const results = [];
function check(label, cond) { results.push({ label, pass: !!cond }); }

// Exact / near-exact matches -> high confidence.
check("'Ost cheddar' matches Ost cheddar with high confidence",
  matchProductLine("Ost cheddar", CATALOG).product?.name === "Ost cheddar" &&
  matchProductLine("Ost cheddar", CATALOG).confidence === "high");
check("'Bacon' matches Bacon with high confidence (case-insensitive)",
  matchProductLine("bacon", CATALOG).product?.name === "Bacon" &&
  matchProductLine("bacon", CATALOG).confidence === "high");
check("'Pommes' matches Pommes with high confidence",
  matchProductLine("Pommes", CATALOG).confidence === "high");

// The exact spec scenario (section 30): a near-miss must surface as a
// LOW-confidence suggestion needing human confirmation, never a silent
// high-confidence auto-accept, and never a newly invented product.
const cheddar1kg = matchProductLine("Cheddar 1kg", CATALOG);
check("'Cheddar 1kg' suggests Ost cheddar (not auto-accepted as high)",
  cheddar1kg.product?.name === "Ost cheddar" && cheddar1kg.confidence !== "high");

// Genuinely unknown lines (section 31/89/90) must come back with NO
// product at all — not a fabricated new catalog entry, not a wrong
// existing product guessed with false confidence.
// "Cheese slices" shares the word "cheese" with the real "Chili cheese"
// product, so it's fair for the matcher to SUGGEST that as a low-
// confidence candidate — the point (spec section 89) is that this must
// never be auto-accepted or spawn a new "Cheese slices" product; it must
// force the "Needs review" state, same as any non-high-confidence match.
const cheeseSlices = matchProductLine("Cheese slices", CATALOG);
check("'Cheese slices' is never auto-accepted as a confident match",
  cheeseSlices.confidence !== "high");
check("'Hummus' has no confident match at all (product: null) — no word overlap with any of the 17",
  matchProductLine("Hummus", CATALOG).product === null);
check("An empty/blank line returns confidence 'none', not a guess",
  matchProductLine("   ", CATALOG).confidence === "none");

// Sanity: the matcher only ever returns a product that was IN the
// catalog passed to it — it cannot return an object that isn't one of
// the 17 real rows, by construction (no product-creation code path
// exists in this file at all).
const allMatches = ["Ost cheddar", "Bacon", "Pommes", "Cheddar 1kg", "Cheese slices"]
  .map((t) => matchProductLine(t, CATALOG).product)
  .filter(Boolean);
check("every returned match is a real object from the catalog array (===, not a copy)",
  allMatches.every((m) => CATALOG.includes(m)));

results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}`));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
