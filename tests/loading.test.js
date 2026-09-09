// Drives the ACTUAL runAsyncView() from ui.js inside a real jsdom DOM to
// prove the "never stuck, no loading screen" behavior the user asked for:
// data renders as soon as it's ready, with nothing painted while a request
// is in flight, and a rejection shows Retry instead of leaving the
// container stuck on whatever was there before.
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
  // A resolved call renders the real result with nothing else ever shown.
  app.innerHTML = "";
  await window.runAsyncView(app, {
    load: () => Promise.resolve("ok"),
    render: (v) => { app.innerHTML = `<p>${v}</p>`; },
  });
  check("no loading text/spinner is ever painted", !app.innerHTML.toLowerCase().includes("loading"));
  check("the real result is rendered", app.textContent.includes("ok"));

  // A slower call still never shows anything but the final result — no
  // loading screen regardless of how long the request takes.
  app.innerHTML = "";
  await window.runAsyncView(app, {
    load: () => new Promise((resolve) => setTimeout(() => resolve("slow-ok"), 200)),
    render: (v) => { app.innerHTML = `<p>${v}</p>`; },
  });
  check("a slow call still shows no loading screen, only the final result", app.textContent.includes("slow-ok") && !app.innerHTML.toLowerCase().includes("loading"));

  // A rejected call never leaves the container stuck; Retry re-runs it.
  app.innerHTML = "";
  let attempts = 0;
  await window.runAsyncView(app, {
    load: () => {
      attempts++;
      return attempts === 1 ? Promise.reject(new Error("network down")) : Promise.resolve("recovered");
    },
    render: (v) => { app.innerHTML = `<p>${v}</p>`; },
  });
  check("failed call is never stuck on a loading state", !app.innerHTML.toLowerCase().includes("loading"));
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
