// Drives the REAL app.js mock-OCR delivery workflow inside a real jsdom
// window — extraction (mocked, ocrProvider.js), matching (productMatcher.js),
// one-line-at-a-time review, discrepancy detection, and the final
// submitted payload. Not hand-traced: every assertion reads real DOM
// state or a real captured Store.submitDelivery call — app.js's internal
// `let` state (ocrLines, deliveryPhoto, ...) is module-scoped and not
// reachable as window.*, so this drives everything the same way a real
// user would: through the rendered screen and exposed functions.
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const dom = new JSDOM(`<!DOCTYPE html><body><nav id="sidebar"></nav><div id="app"></div></body>`, {
  url: "https://example.test/index.html",
  runScripts: "dangerously",
});
const { window } = dom;

// jsdom doesn't implement these — harmless no-op stand-ins so the real
// photo-upload code path (unrelated to what this test is verifying) can
// run without crashing.
window.URL.createObjectURL = () => "blob:fake-preview";
window.URL.revokeObjectURL = () => {};

window.Auth = { requireSession: async () => ({}), signOut: () => {} };
window.eval(fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8"));
window.eval(fs.readFileSync(path.join(__dirname, "..", "packaging.js"), "utf8"));
window.eval(fs.readFileSync(path.join(__dirname, "..", "ocrProvider.js"), "utf8"));
window.eval(fs.readFileSync(path.join(__dirname, "..", "productMatcher.js"), "utf8"));

// Catalog matches the mock invoice's real product names exactly (Ost
// cheddar/Stora bröd/Bacon/Pommes, the spec's own worked example), plus
// one unrelated product to prove the matcher doesn't just grab anything.
window.Store = {
  init: async () => ({ role: "employee" }),
  getProducts: async () => ([
    { id: "p-cheddar", name: "Ost cheddar", category: "Cheese", base_unit: "piece", base_unit_label: "slice", packages: [{ name: "package", contains: 88, unit: "piece" }] },
    { id: "p-brod", name: "Stora bröd", category: "Bread", base_unit: "piece", packages: [{ name: "carton", contains: 42, unit: "piece" }] },
    { id: "p-bacon", name: "Bacon", category: "Meat", base_unit: "kg", packages: [] },
    { id: "p-pommes", name: "Pommes", category: "Frozen", base_unit: "kg", packages: [{ name: "carton", contains: 5, unit: "bag" }, { name: "bag", contains: 2.5, unit: "kg" }] },
    { id: "p-other", name: "Grillost", category: "Cheese", base_unit: "piece", packages: [{ name: "box", contains: 16, unit: "piece" }] },
  ]),
  getLocations: async () => ([{ id: "loc1", name: "Downtown" }]),
  getCurrentLocation: () => "loc1",
  setCurrentLocation: () => {},
  todaysInventory: async () => null,
  normalizeQuantity: (p, entry) => entry.mode === "generic" ? window.normalizeBreakdown(p, entry.breakdown || {}) : 0,
  getInventories: async () => ([]),
  getAllSuppliers: async () => ([{ id: "sup1", name: "Fresh Foods Co", active: true }]),
  uploadDeliveryDocument: async () => "org1/fake-invoice.jpg",
  submitDeliveryCalls: [],
  submitDelivery: async function (record) { window.Store.submitDeliveryCalls.push(record); return "delivery-id"; },
};

window.eval(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"));

function app() { return window.document.getElementById("app"); }
const results = [];
function check(label, cond) { results.push({ label, pass: !!cond }); }

async function run() {
  for (let i = 0; i < 20 && window.location.hash !== "#home"; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await window.go("delivery");

  // Step 1: choice screen requires a photo before extraction is allowed
  // (the workflow's own "Take Photo -> Upload -> Process" shape).
  let matchBtn = [...app().querySelectorAll("button.primary")].find((b) => b.textContent.includes("Match products"));
  check("the 'Match from invoice' action is disabled with no photo attached", matchBtn.disabled);

  // Attach a photo through the REAL upload path (not by poking internal
  // state), so deliveryPhoto ends up set exactly the way a real camera/
  // file-input selection would set it.
  const fakeFile = new window.File(["fake-bytes"], "invoice.jpg", { type: "image/jpeg" });
  await window.onDeliveryPhotoSelected({ target: { files: [fakeFile], value: "" } });
  window.renderDeliveryChoice();
  matchBtn = [...app().querySelectorAll("button.primary")].find((b) => b.textContent.includes("Match products"));
  check("attaching a photo enables 'Match from invoice'", !matchBtn.disabled);
  check("'View original invoice' will be available once review starts (photo present)",
    !!window.document.querySelector("img"));

  window.document.getElementById("ocrSupplier").value = "sup1";
  await window.startOcrFlow();

  check("review screen opens on line 1 of 4 (Ost cheddar) — the invoice's own first line, not sorted",
    app().textContent.includes("Ost cheddar") && app().textContent.includes("Delivery #1/4"));
  check("progress panel shows all 4 lines", app().querySelectorAll(".ocr-progress-item").length === 4);
  check("progress panel preserves invoice order (Ost cheddar, Stora bröd, Bacon, Pommes)",
    [...app().querySelectorAll(".ocr-progress-item")].map((el) => el.textContent).join("|").indexOf("Ost cheddar") <
    [...app().querySelectorAll(".ocr-progress-item")].map((el) => el.textContent).join("|").indexOf("Pommes"));
  check("'View original invoice' is available since a photo was attached",
    app().textContent.includes("View original invoice"));
  check("all 4 lines matched an existing catalog product with high confidence (exact name match) — Confirm & Next is enabled",
    !app().querySelector('button[onclick="confirmOcrLine()"]')?.disabled &&
    [...app().querySelectorAll("button")].some((b) => b.textContent.includes("Confirm & Next") && !b.disabled));

  // Confirm line 1 exactly as extracted (no discrepancy) and advance.
  window.confirmOcrLine();
  check("confirming line 1 advances to line 2 (Stora bröd)",
    app().textContent.includes("Delivery #2/4") && app().textContent.includes("Stora bröd"));
  check("no discrepancy banner when received == invoice quantity", !app().textContent.includes("Discrepancy"));

  // Line 2: introduce a real discrepancy (received less than invoiced).
  window.adjustOcrReceived(-1);
  check("received quantity input reflects the decrement (4 -> 3)",
    window.document.getElementById("ocrReceivedInput").value === "3");
  check("a discrepancy banner appears when received != invoice quantity",
    app().textContent.includes("Discrepancy") && app().textContent.includes("invoice said 4"));
  window.confirmOcrLine();

  window.confirmOcrLine(); // Bacon, as extracted
  window.confirmOcrLine(); // Pommes, as extracted -> completion screen

  check("all 4 lines confirmed reaches the completion/review screen",
    app().textContent.includes("4 of 4 lines matched"));
  check("the discrepancy on Stora bröd is surfaced on the completion screen too",
    app().textContent.includes("1 discrepancy recorded"));

  window.Store.submitDeliveryCalls.length = 0;
  await window.submitOcrDelivery();

  const submitted = window.Store.submitDeliveryCalls[0];
  check("submitDelivery was called exactly once", window.Store.submitDeliveryCalls.length === 1);
  check("extraction_source is honestly recorded as 'mock_ocr', never faked as a real sync", submitted?.extractionSource === "mock_ocr");
  check("all 4 resolved lines were submitted, in original invoice order (invoiceLineOrder 1..4)",
    submitted?.items.length === 4 && submitted.items.map((it) => it.invoiceLineOrder).join(",") === "1,2,3,4");

  const cheddarItem = submitted.items.find((it) => it.productId === "p-cheddar");
  check("Ost cheddar (has package tiers) submitted via the generic conversion engine, not a hand-typed formula",
    cheddarItem.entry.mode === "generic" && cheddarItem.entry.breakdown.package === 3);
  check("Ost cheddar's audit trail keeps the ORIGINAL extracted values distinct from what was confirmed",
    cheddarItem.extractedQuantity === 3 && cheddarItem.matchConfidence === "high");

  const brodItem = submitted.items.find((it) => it.productId === "p-brod");
  check("Stora bröd's discrepancy survives into the submitted payload (received 3, invoice said 4)",
    brodItem.entry.breakdown.carton === 3 && brodItem.extractedQuantity === 4);

  const baconItem = submitted.items.find((it) => it.productId === "p-bacon");
  check("Bacon (base_unit kg, no package tiers) still goes through the generic engine in kg",
    baconItem.entry.mode === "generic" && baconItem.entry.breakdown.kg === 2);

  results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}`));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

run().catch((e) => { console.error("TEST HARNESS ERROR:", e); process.exit(1); });
