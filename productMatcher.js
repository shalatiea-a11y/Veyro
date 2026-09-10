// Deterministic, non-AI matching of an extracted invoice line against the
// EXISTING product catalog only. This is exactly the boundary the spec
// draws: extraction (ocrProvider.js, currently mocked) produces text;
// this file decides which existing catalog product (if any) that text
// most likely refers to. It NEVER creates a product — a line that
// doesn't confidently match any of the 17 catalog entries comes back
// with product: null and confidence: "none", and the UI must show
// "Needs review" and require a human to pick the correct existing
// product (or leave it unresolved). There is no code path here that can
// invent a new catalog item.
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents (Swedish ö/å etc. still fold predictably)
    .replace(/[^a-z0-9åäö\s]/gi, "")
    .trim()
    .replace(/\s+/g, " ");
}

// confidence: "high" (exact normalized match), "medium" (one is a
// substring of the other, e.g. "cheddar 1kg" contains "cheddar" partial
// — but here specifically the catalog name is fully contained in the
// line or vice versa), "low" (shares at least one meaningful word),
// "none" (no usable overlap at all).
function matchProductLine(lineText, catalog) {
  const norm = normalize(lineText);
  if (!norm) return { product: null, confidence: "none" };

  const exact = catalog.find((p) => normalize(p.name) === norm);
  if (exact) return { product: exact, confidence: "high" };

  const contains = catalog.find((p) => {
    const pn = normalize(p.name);
    return pn.length > 2 && (norm.includes(pn) || pn.includes(norm));
  });
  if (contains) return { product: contains, confidence: "medium" };

  const lineWords = new Set(norm.split(" ").filter((w) => w.length > 2));
  let best = null;
  let bestOverlap = 0;
  for (const p of catalog) {
    const pWords = normalize(p.name).split(" ").filter((w) => w.length > 2);
    const overlap = pWords.filter((w) => lineWords.has(w)).length;
    if (overlap > bestOverlap) { bestOverlap = overlap; best = p; }
  }
  if (best && bestOverlap > 0) return { product: best, confidence: "low" };

  return { product: null, confidence: "none" };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { matchProductLine, normalize };
}
