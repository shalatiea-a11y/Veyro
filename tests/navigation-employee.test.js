// Drives the ACTUAL app.js navigation/history logic inside a real jsdom
// window (with real History API + popstate dispatch), mocking only the
// Supabase-backed Store/Auth calls. This is a genuine test of the state
// machine — not a hand-trace — because jsdom's history object behaves
// like a real browser's for pushState/replaceState/back().
const { JSDOM } = require("jsdom");
const fs = require("fs");

const dom = new JSDOM(`<!DOCTYPE html><body><div id="app"></div></body>`, {
  url: "https://example.test/index.html",
  runScripts: "dangerously",
});
const { window } = dom;

// Mocks for everything app.js expects to exist already (auth.js, storage.js).
window.Auth = { requireSession: async () => ({}), signOut: () => {} };
window.eval(fs.readFileSync(require("path").join(__dirname, "..", "ui.js"), "utf8"));
window.eval(fs.readFileSync(require("path").join(__dirname, "..", "packaging.js"), "utf8"));
window.Store = {
  init: async () => ({ role: "employee" }),
  getProducts: async () => ([
    { id: "p1", name: "Big Meat", category: "Meat", unit: "box", unitsPerBox: 24 },
    { id: "p2", name: "Small Meat", category: "Meat", unit: "box", unitsPerBox: 60 },
    // A product with real package config — routes through the NEW
    // generic conversion-engine UI instead of the legacy boxes+pieces one.
    {
      id: "p3", name: "Pommes", category: "Frozen", unit: "unit", unitsPerBox: 1,
      base_unit: "kg", base_unit_label: "kg", open_piece_notes: false,
      packages: [{ name: "carton", contains: 5, unit: "bag" }, { name: "bag", contains: 2.5, unit: "kg" }],
    },
  ]),
  getLocations: async () => ([{ id: "loc1", name: "Downtown" }, { id: "loc2", name: "Airport" }]),
  getCurrentLocation: () => window.__currentLocation || "loc1",
  setCurrentLocation: (id) => { window.__currentLocation = id; },
  todaysInventoryCalls: 0,
  todaysInventory: async function (locId) {
    window.Store.todaysInventoryCalls++;
    return null;
  },
  normalizeQuantity: (p, entry) => entry.mode === "generic"
    ? window.normalizeBreakdown(p, entry.breakdown || {})
    : (Number(entry.fullBoxes) || 0) * p.unitsPerBox + (Number(entry.pieces) || 0),
  saveInventoryCalls: [],
  saveInventory: async function (record) { window.Store.saveInventoryCalls.push(record); return "sub-id"; },
  getInventories: async () => ([]),
  getAllSuppliersCalls: 0,
  getAllSuppliers: async function () {
    window.Store.getAllSuppliersCalls++;
    return [{ id: "sup1", name: "Fresh Foods Co", active: true }];
  },
};

const code = fs.readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8");
window.eval(code);

function currentPath() { return window.location.hash; }

async function run() {
  const app = window.document.getElementById("app");
  // boot() is called at the bottom of app.js already (fire and forget).
  // Give it a tick to finish its async chain.
  for (let i = 0; i < 20 && currentPath() !== "#home"; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }

  const results = [];
  function check(label, cond) { results.push({ label, pass: !!cond }); }

  check("boot lands on #home", currentPath() === "#home");
  check("history length is exactly 1 after boot (replaceState, no extra entry)", window.history.length === 1);
  check("todaysInventory fetched exactly once during boot", window.Store.todaysInventoryCalls === 1);

  // Home -> Categories -> Product list -> Product entry (the reported flow)
  await window.go("categories");
  check("navigated to #categories", currentPath() === "#categories");
  check("history grew by 1 push", window.history.length === 2);

  await window.go("productList", "Meat");
  check("navigated to #productList", currentPath() === "#productList");

  await window.go("productEntry", "p1");
  check("navigated to #productEntry", currentPath() === "#productEntry");
  check("history length is 4 (home, categories, productList, productEntry)", window.history.length === 4);

  // Now press Back three times (simulates Android Back) and confirm it
  // walks OUT one screen at a time instead of leaving the app.
  window.history.back();
  await new Promise((r) => setTimeout(r, 20));
  check("Back #1: returned to #productList (not exited)", currentPath() === "#productList");

  window.history.back();
  await new Promise((r) => setTimeout(r, 20));
  check("Back #2: returned to #categories", currentPath() === "#categories");

  window.history.back();
  await new Promise((r) => setTimeout(r, 20));
  check("Back #3: returned to #home", currentPath() === "#home");

  // Returning to Home via Back must NOT re-fetch today's status —
  // that's the specific redundant-loading bug being fixed.
  check("no extra todaysInventory fetch just from navigating back to Home",
    window.Store.todaysInventoryCalls === 1);

  // Switching location SHOULD invalidate the cache (different location,
  // genuinely different answer).
  await window.go("locationPicker");
  window.document.getElementById("app").querySelectorAll(".list-row")[1].click(); // Airport
  await new Promise((r) => setTimeout(r, 20));
  check("switching location DOES trigger a fresh fetch", window.Store.todaysInventoryCalls === 2);
  check("current location actually changed", window.Store.getCurrentLocation() === "loc2");

  // Delivery Receiving used to be a full page navigation (window.location.href
  // = 'delivery.html'), which is exactly what produced the white-screen
  // complaint no loading-UI fix could touch. It's now a normal go() view —
  // same in-memory screen swap, same real history entry, same Back behavior
  // as every other screen, with no document reload at all.
  await window.go("home", { force: true });
  await window.go("delivery");
  check("Delivery opens as an in-app view (a real history entry, not a page navigation)",
    currentPath() === "#delivery");
  check("suppliers are fetched lazily on first visit to Delivery", window.Store.getAllSuppliersCalls === 1);
  check("Delivery opens on the invoice-matching choice screen (supplier select present)",
    !!window.document.getElementById("ocrSupplier"));
  check("Manual entry is still reachable, not deleted",
    app.textContent.includes("Enter items manually instead"));

  window.history.back();
  await new Promise((r) => setTimeout(r, 20));
  check("Back from Delivery returns to Home (still in-app, not exiting)", currentPath() === "#home");

  await window.go("delivery");
  check("returning to Delivery does NOT refetch suppliers (no unnecessary duplicate request)",
    window.Store.getAllSuppliersCalls === 1);

  // Package/unit conversion engine wired into the real Product Entry
  // screen: a product with configured package tiers (Pommes) must render
  // the NEW generic field-per-unit UI (not the old boxes+pieces tabs),
  // update its live total as the employee types, and save with the raw
  // breakdown intact — never a client-computed total.
  await window.go("productEntry", "p3");
  check("Pommes gets the generic entry UI: a 'carton' field exists", !!app.querySelector("#qty-carton"));
  check("Pommes gets the generic entry UI: a 'bag' field exists", !!app.querySelector("#qty-bag"));
  check("Pommes gets the generic entry UI: a 'kg' field exists (its base_unit)", !!app.querySelector("#qty-kg"));
  check("Pommes does NOT get the legacy boxes+pieces tabs", !app.querySelector(".tabs"));

  app.querySelector("#qty-bag").value = "17";
  app.querySelector("#qty-bag").dispatchEvent(new window.Event("input"));
  check("typing 17 in 'bag' live-updates the total to 42.5 kg (17 x 2.5, the spec's own worked example)",
    app.querySelector("#totalVal").textContent.includes("42.5"));
  check("the equivalent line shows the decomposed breakdown (3 carton + 2 bag)",
    app.querySelector("#equivLine").textContent.includes("3 carton") && app.querySelector("#equivLine").textContent.includes("2 bag"));

  await window.commitEntry("p3");
  await window.go("review");
  check("Review shows Pommes in kg, not a hardcoded 'pcs'", app.textContent.includes("42.5 kg"));

  window.Store.saveInventoryCalls.length = 0;
  await window.submitInventory();
  const saved = window.Store.saveInventoryCalls[0];
  const pommesItem = saved && saved.items.find((it) => it.productId === "p3");
  check("submitted inventory sends Pommes' RAW breakdown ({bag:'17'}), not a pre-computed total",
    !!pommesItem && pommesItem.entry.mode === "generic" && String(pommesItem.entry.breakdown.bag) === "17");

  results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}`));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

run().catch((e) => { console.error("TEST HARNESS ERROR:", e); process.exit(1); });
