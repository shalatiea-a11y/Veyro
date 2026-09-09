// Drives the ACTUAL runAsyncView() from ui.js inside a real jsdom DOM to
// prove three things the report's "never stuck on Loading" requirement
// depends on, rather than hand-tracing the code:
//   1. A fast-resolving call never paints the loading screen at all.
//   2. A slow call past the delay threshold DOES show it.
//   3. A rejected call renders Retry (not a screen stuck on "Loading…"),
//      and clicking Retry re-runs the same load+render.
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const dom = new JSDOM(`<!DOCTYPE html><body><div id="app"></div></body>`, {
  url: "https://example.test/index.html",
  runScripts: "dangerously",
});
const { window } = dom;
window.eval(fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8"));

const app = window.document.getElementById("app");
const results = [];
function check(label, cond) { results.push({ label, pass: !!cond }); }

async function run() {
  // 1. Fast call: no loading flash.
  app.innerHTML = "";
  await window.runAsyncView(app, {
    load: () => Promise.resolve("ok"),
    render: (v) => { app.innerHTML = `<p>${v}</p>`; },
    delayMs: 150,
  });
  check("fast call never showed a loading screen", !app.innerHTML.includes("Loading"));
  check("fast call rendered the real result", app.textContent.includes("ok"));

  // 2. Slow call: loading screen appears after the threshold, then clears.
  app.innerHTML = "";
  const slowPromise = window.runAsyncView(app, {
    load: () => new Promise((resolve) => setTimeout(() => resolve("slow-ok"), 300)),
    render: (v) => { app.innerHTML = `<p>${v}</p>`; },
    delayMs: 50,
  });
  await new Promise((r) => setTimeout(r, 100));
  check("slow call shows loading screen once past the delay threshold", app.innerHTML.includes("Loading"));
  await slowPromise;
  check("slow call replaces loading with the real result once resolved", app.textContent.includes("slow-ok"));

  // 3. Rejected call: never left stuck on "Loading…"; Retry re-runs it.
  app.innerHTML = "";
  let attempts = 0;
  await window.runAsyncView(app, {
    load: () => {
      attempts++;
      return attempts === 1 ? Promise.reject(new Error("network down")) : Promise.resolve("recovered");
    },
    render: (v) => { app.innerHTML = `<p>${v}</p>`; },
    delayMs: 150,
  });
  check("failed call does NOT stay stuck on 'Loading…'", !app.innerHTML.includes("Loading"));
  check("failed call shows a Retry control", !!app.querySelector(".retry-btn"));

  app.querySelector(".retry-btn").click();
  await new Promise((r) => setTimeout(r, 20));
  check("clicking Retry re-runs load and renders the recovered result", app.textContent.includes("recovered"));
  check("Retry actually called load() a second time", attempts === 2);

  results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}`));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}
run().catch((e) => { console.error("TEST HARNESS ERROR:", e); process.exit(1); });
