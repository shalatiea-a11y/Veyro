// Generic, deterministic package/unit conversion engine. No AI, no
// guessing — pure arithmetic over a product's configured package
// hierarchy (see supabase/schema.sql's product_packages table).
//
// A product has a base_unit ('piece' | 'kg' | 'ml') and zero or more
// ordered package tiers, OUTERMOST first, e.g. Pommes:
//   base_unit: 'kg'
//   packages: [{ name: 'carton', contains: 5,   unit: 'bag' },
//              { name: 'bag',    contains: 2.5, unit: 'kg'  }]
// Each tier's `unit` is either another tier's `name` (nesting one level
// in) or the product's base_unit (bottoming out). A product with an
// empty packages array (Nuggets, Chili cheese) only accepts entries in
// its base_unit directly — this is what makes "no automatic bag->piece
// conversion" fall out of the model itself rather than needing a
// special-case flag: if no tier is configured for a unit, resolving it
// throws, exactly like the server-side resolve_generic_inventory_quantity()
// function in supabase/schema.sql (which this mirrors for live UI
// feedback — the server is always the authoritative recompute, this is
// only for instant preview).
//
// Reserved key: "_note_pieces" in a breakdown is an optional, informational
// piece count that is NEVER converted or added to the total — it exists
// so a product like Nuggets can record "looked like about 40 pieces"
// without the system inventing a pieces-per-bag rule that isn't known.
const NOTE_KEY = "_note_pieces";

function resolveMultiplier(product, unitName) {
  const packages = product.packages || [];
  let unit = unitName;
  let multiplier = 1;
  let hops = 0;
  const chain = [];
  while (unit !== product.base_unit) {
    hops++;
    if (hops > 6) {
      throw new Error(`Product "${product.name}" package configuration is too deep or malformed`);
    }
    const pkg = packages.find((p) => p.name === unit);
    if (!pkg) {
      throw new Error(`"${product.name}" has no package tier named "${unit}"`);
    }
    multiplier *= pkg.contains;
    chain.push(pkg);
    unit = pkg.unit;
  }
  return { multiplier, chain };
}

// breakdown: { [unitName]: quantity, _note_pieces?: number }
// Returns the total in the product's base_unit. Mirrors
// resolve_generic_inventory_quantity() in schema.sql exactly — this is a
// client-side PREVIEW only; the server recomputes independently at
// submit time and never trusts this result.
function normalizeBreakdown(product, breakdown) {
  let total = 0;
  for (const key of Object.keys(breakdown || {})) {
    if (key === NOTE_KEY) continue;
    const qty = Number(breakdown[key]);
    if (!qty || qty <= 0) continue;
    const { multiplier } = resolveMultiplier(product, key);
    total += qty * multiplier;
  }
  return round(total);
}

// Greedy largest-tier-first decomposition of a base_unit total into a
// human breakdown, e.g. Pommes 42.5 kg -> "3 carton + 2 bag" (the exact
// example in the spec: 17 bags = 42.5 kg = 3 cartons + 2 bags remaining).
// Purely a DISPLAY helper — never affects what gets saved.
function decompose(product, totalBaseUnits) {
  const packages = product.packages || [];
  let remaining = round(totalBaseUnits);
  const parts = [];
  for (const pkg of packages) {
    const { multiplier } = resolveMultiplier(product, pkg.name);
    const count = Math.floor(round(remaining / multiplier) + 1e-9);
    if (count > 0) {
      parts.push({ name: pkg.name, count });
      remaining = round(remaining - count * multiplier);
    }
  }
  if (remaining > 1e-9 || parts.length === 0) {
    parts.push({ name: product.base_unit, count: round(remaining) });
  }
  return parts;
}

function formatBreakdown(parts) {
  return parts.map((p) => `${formatNumber(p.count)} ${p.name}`).join(" + ");
}

function formatNumber(n) {
  return Math.round(n * 1000) / 1000 % 1 === 0 ? String(Math.round(n)) : String(Math.round(n * 1000) / 1000);
}

// Guards against the classic 0.1 + 0.2 style drift on repeated
// multiply/divide of the decimal package sizes this project actually
// uses (2.5, 0.25, 114, 45, ...). All of those are exact in IEEE754 at
// these magnitudes; this rounding is a safety net for compound chains
// (e.g. a 3-tier hierarchy), not a fix for a known bug.
function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveMultiplier, normalizeBreakdown, decompose, formatBreakdown, NOTE_KEY };
}
