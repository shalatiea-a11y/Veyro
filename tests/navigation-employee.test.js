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
window.Store = {
  init: async () => ({ role: "employee" }),
  getProducts: async () => ([
    { id: "p1", name: "Big Meat", category: "Meat", unit: "box", unitsPerBox: 24 },
    { id: "p2", name: "Small Meat", category: "Meat", unit: "box", unitsPerBox: 60 },
  ]),
  getLocations: async () => ([{ id: "loc1", name: "Downtown" }, { id: "loc2", name: "Airport" }]),
  getCurrentLocation: () => window.__currentLocation || "loc1",
  setCurrentLocation: (id) => { window.__currentLocation = id; },
  todaysInventoryCalls: 0,
  todaysInventory: async function (locId) {
    window.Store.todaysInventoryCalls++;
    return null;
  },
  normalizeQuantity: (p, entry) => (Number(entry.fullBoxes) || 0) * p.unitsPerBox + (Number(entry.pieces) || 0),
  saveInventory: async () => "sub-id",
  getInventories: async () => ([]),
};

const code = fs.readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8");
window.eval(code);

function currentPath() { return window.location.hash; }

async function run() {
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

  results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}`));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

run().catch((e) => { console.error("TEST HARNESS ERROR:", e); process.exit(1); });
