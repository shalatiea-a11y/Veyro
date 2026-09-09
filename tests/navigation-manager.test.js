const { JSDOM } = require("jsdom");
const fs = require("fs");

const dom = new JSDOM(`<!DOCTYPE html><body><div id="app"></div></body>`, {
  url: "https://example.test/manager.html",
  runScripts: "dangerously",
});
const { window } = dom;

window.Auth = { requireSession: async () => ({}), signOut: () => {} };
window.withBusyButton = async (btn, fn) => fn();
window.Store = {
  init: async () => ({ role: "admin" }),
  getLocations: async () => ([{ id: "loc1", name: "Downtown" }, { id: "loc2", name: "Airport" }]),
  todaysInventoriesCalls: 0,
  todaysInventories: async function () { window.Store.todaysInventoriesCalls++; return []; },
  getDeliveriesCalls: 0,
  getDeliveries: async function (opts) { window.Store.getDeliveriesCalls++; return []; },
  getInventories: async () => ([]),
};

const code = fs.readFileSync(require("path").join(__dirname, "..", "manager.js"), "utf8");
window.eval(code);

function currentPath() { return window.location.hash; }

async function run() {
  for (let i = 0; i < 20 && currentPath() !== "#dashboard"; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const results = [];
  function check(label, cond) { results.push({ label, pass: !!cond }); }

  check("boot lands on #dashboard", currentPath() === "#dashboard");
  check("history length is 1 after boot (replaceState)", window.history.length === 1);
  check("dashboard data fetched once", window.Store.todaysInventoriesCalls === 1);

  await window.goBranch("loc1");
  await new Promise((r) => setTimeout(r, 20));
  check("navigated to #branch", currentPath() === "#branch");
  check("history length is 2", window.history.length === 2);

  window.history.back();
  await new Promise((r) => setTimeout(r, 20));
  check("Back returns to #dashboard (not exiting the app)", currentPath() === "#dashboard");
  // Unlike the employee Home screen, the manager dashboard SHOULD refetch
  // on every return — a manager wants current numbers, not a stale cache
  // from before they drilled into a branch. This is intentional, not a bug.
  check("dashboard IS refreshed on return (manager wants live data)", window.Store.todaysInventoriesCalls === 2);

  results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}`));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}
run().catch((e) => { console.error("TEST HARNESS ERROR:", e); process.exit(1); });
