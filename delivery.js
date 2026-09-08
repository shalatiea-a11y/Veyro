// Delivery Receiving — manual entry. NOT built here: camera capture, AI
// document extraction, product matching, and expected-vs-received
// discrepancy detection (see README "Known limitations" — those need a
// real decision about an AI provider and a source of "expected quantity"
// data that doesn't exist yet; faking either would mean fabricating AI
// output or invented purchase-order numbers). This records what an
// employee actually counts off a delivery, structured and atomic — the
// same server-side-recomputed, location-scoped guarantee as inventory.
const app = document.getElementById("app");
let LOCATIONS = [], SUPPLIERS = [], PRODUCTS = [];
let items = []; // { productId, productName, entry, unitPrice }

function currentLocation() {
  const id = Store.getCurrentLocation();
  return LOCATIONS.find((l) => l.id === id) || LOCATIONS[0];
}

function showError(err) {
  console.error(err);
  const box = document.getElementById("deliveryError");
  if (box) { box.textContent = err.message || String(err); box.style.display = "block"; }
}

function render() {
  const loc = currentLocation();
  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="window.location.href='index.html'">←</button><div class="brand">Delivery Receiving</div></div>
    <div class="screen">
      <p class="muted">Location: <strong>${loc ? loc.name : "none"}</strong></p>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
        <div class="stepper-row"><label>Supplier</label>
          <select id="supplier" style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
            ${SUPPLIERS.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}
          </select>
        </div>
        <div class="stepper-row"><label>Invoice #</label>
          <input id="invoiceNumber" style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" placeholder="optional">
        </div>
      </div>

      <p class="muted">Add what was received</p>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
        <div class="stepper-row"><label>Product</label>
          <select id="product" style="flex:1;margin-left:12px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
            ${PRODUCTS.map((p) => `<option value="${p.id}">${p.name} (1 ${p.package_unit} = ${p.units_per_package} pcs)</option>`).join("")}
          </select>
        </div>
        <div class="stepper-row"><label>Full boxes</label>
          <input id="fullBoxes" type="number" min="0" value="0" style="width:100px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
        </div>
        <div class="stepper-row"><label>Pieces</label>
          <input id="pieces" type="number" min="0" value="0" style="width:100px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
        </div>
        <div class="stepper-row"><label>Unit price (optional)</label>
          <input id="unitPrice" type="number" min="0" step="0.01" style="width:100px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
        </div>
        <button class="pill" onclick="addItem()" style="margin-top:8px">Add to delivery</button>
      </div>

      ${items.length ? `
        <p class="muted">Items in this delivery</p>
        ${items.map((it, i) => `
          <div class="review-row">
            <span>${it.productName} — ${it.totalPieces} pcs${it.unitPrice != null ? ` @ ${it.unitPrice}` : ""}</span>
            <button onclick="removeItem(${i})" style="border:none;background:none;color:#b91c1c;cursor:pointer">Remove</button>
          </div>
        `).join("")}
      ` : `<p class="muted">No items added yet.</p>`}

      <div id="deliveryError" class="muted" style="color:#b91c1c;display:none;margin-top:10px"></div>
      <button class="primary sticky" ${items.length === 0 ? "disabled" : ""} onclick="submitDelivery()">Submit Delivery (${items.length} items)</button>
    </div>
  `;
}

function addItem() {
  const productId = document.getElementById("product").value;
  const product = PRODUCTS.find((p) => p.id === productId);
  const fullBoxes = Number(document.getElementById("fullBoxes").value) || 0;
  const pieces = Number(document.getElementById("pieces").value) || 0;
  const unitPriceRaw = document.getElementById("unitPrice").value;
  const unitPrice = unitPriceRaw === "" ? null : Number(unitPriceRaw);

  if (fullBoxes === 0 && pieces === 0) {
    showError(new Error("Enter at least one box or piece before adding."));
    return;
  }
  document.getElementById("deliveryError").style.display = "none";
  const entry = { mode: "boxes+pieces", fullBoxes, pieces };
  items.push({
    productId,
    productName: product.name,
    entry,
    unitPrice,
    totalPieces: Store.normalizeQuantity({ unitsPerBox: product.units_per_package }, entry),
  });
  render();
}

function removeItem(index) {
  items.splice(index, 1);
  render();
}

async function submitDelivery() {
  const loc = currentLocation();
  const supplierId = document.getElementById("supplier").value;
  const invoiceNumber = document.getElementById("invoiceNumber").value.trim();
  if (!supplierId) {
    showError(new Error("Select a supplier first."));
    return;
  }
  try {
    await Store.submitDelivery({
      locationId: loc.id,
      supplierId,
      invoiceNumber,
      invoiceDate: new Date().toISOString().slice(0, 10),
      notes: null,
      items,
    });
    items = [];
    app.innerHTML = `
      <div class="screen center">
        <div class="check">✓</div>
        <h1>Delivery recorded</h1>
        <p class="muted">Saved for ${loc.name}</p>
        <button class="primary" onclick="window.location.href='index.html'">Back to Home</button>
      </div>
    `;
  } catch (err) {
    showError(err);
  }
}

async function boot() {
  await Auth.requireSession();
  app.innerHTML = `<div class="screen"><p class="muted">Loading…</p></div>`;
  try {
    await Store.init();
    [LOCATIONS, SUPPLIERS, PRODUCTS] = await Promise.all([
      Store.getLocations(),
      Store.getAllSuppliers(),
      Store.getAllProducts(),
    ]);
    SUPPLIERS = SUPPLIERS.filter((s) => s.active);
    PRODUCTS = PRODUCTS.filter((p) => p.active);
    if (LOCATIONS.length === 0) throw new Error("No locations available to you yet.");
    if (SUPPLIERS.length === 0) throw new Error("No suppliers configured yet — an admin needs to add one first (Admin → Suppliers).");
    render();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="screen"><p class="muted" style="color:#b91c1c">${err.message}</p></div>`;
  }
}
boot();
