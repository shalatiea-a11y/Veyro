// Delivery Receiving. What IS built: real camera capture (via the
// browser's native file-input capture, which every mobile browser
// supports without needing raw getUserMedia stream handling), secure
// upload to a private per-organization storage folder, and manual entry
// of what was received. What is NOT built, deliberately: AI reading of
// the photo, product matching, and expected-vs-received discrepancy
// detection — see README "What's deliberately not built" for why faking
// any of those would violate this project's own rules against fabricated
// AI output and invented data. The photo is stored as supporting
// evidence attached to a manually-entered delivery, not as an input the
// system currently interprets.
const app = document.getElementById("app");
let LOCATIONS = [], SUPPLIERS = [], PRODUCTS = [];
let items = []; // { productId, productName, entry, unitPrice, totalPieces }
let photo = null; // { file, previewUrl, uploadedPath, status: 'idle'|'uploading'|'uploaded'|'failed' }

function currentLocation() {
  const id = Store.getCurrentLocation();
  return LOCATIONS.find((l) => l.id === id) || LOCATIONS[0];
}

function showError(err) {
  console.error(err);
  const box = document.getElementById("deliveryError");
  if (box) { box.textContent = err.message || String(err); box.style.display = "block"; }
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // matches the bucket's file_size_limit in schema.sql

function render() {
  const loc = currentLocation();
  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="window.location.href='index.html'">←</button><div class="brand">Delivery Receiving</div></div>
    <div class="screen">
      <p class="muted">Location: <strong>${loc ? loc.name : "none"}</strong></p>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
        <p class="muted" style="margin-top:0">Photo of invoice (optional, kept as a record — not read automatically)</p>
        ${photoSectionHtml()}
      </div>

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
      <button id="submitDeliveryBtn" class="primary sticky" ${!canSubmit() ? "disabled" : ""} onclick="submitDelivery()">
        ${photo && photo.status === "uploading" ? "Uploading photo…" : `Submit Delivery (${items.length} items)`}
      </button>
    </div>
  `;
}

function canSubmit() {
  return items.length > 0 && (!photo || photo.status === "uploaded" || photo.status === "failed");
}

function photoSectionHtml() {
  if (!photo) {
    return `
      <div style="display:flex;gap:8px">
        <label class="pill" style="cursor:pointer">
          📷 Take Photo
          <input type="file" accept="image/*" capture="environment" onchange="onPhotoSelected(event)" style="display:none">
        </label>
        <label class="pill" style="cursor:pointer">
          Upload from device
          <input type="file" accept="image/*" onchange="onPhotoSelected(event)" style="display:none">
        </label>
      </div>
    `;
  }
  const statusLine = {
    uploading: `<p class="muted">Uploading…</p>`,
    uploaded: `<p class="muted" style="color:#15803d">✓ Attached</p>`,
    failed: `<p class="muted" style="color:#b91c1c">Upload failed — you can still submit without the photo, or retry.</p>`,
  }[photo.status] || "";
  return `
    <div style="display:flex;gap:12px;align-items:flex-start">
      <img src="${photo.previewUrl}" style="width:96px;height:96px;object-fit:cover;border-radius:10px;border:1px solid #e5e7eb">
      <div style="flex:1">
        ${statusLine}
        <div style="display:flex;gap:8px;margin-top:6px">
          ${photo.status === "failed" ? `<button class="pill" onclick="retryPhotoUpload()">Retry upload</button>` : ""}
          <button class="pill" onclick="removePhoto()">Remove photo</button>
        </div>
      </div>
    </div>
  `;
}

async function onPhotoSelected(event) {
  const file = event.target.files[0];
  event.target.value = ""; // allow re-selecting the same file later
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showError(new Error("That file isn't an image. Please choose a photo."));
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    showError(new Error(`That photo is too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — the limit is 8 MB. Try again with lower camera quality, or retake it.`));
    return;
  }
  document.getElementById("deliveryError").style.display = "none";

  photo = { file, previewUrl: URL.createObjectURL(file), uploadedPath: null, status: "uploading" };
  render();
  await uploadCurrentPhoto();
}

async function uploadCurrentPhoto() {
  try {
    const path = await Store.uploadDeliveryDocument(photo.file);
    photo.uploadedPath = path;
    photo.status = "uploaded";
  } catch (err) {
    console.error(err);
    photo.status = "failed";
  }
  render();
}

function retryPhotoUpload() {
  photo.status = "uploading";
  render();
  uploadCurrentPhoto();
}

function removePhoto() {
  if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
  // Best-effort cleanup of the already-uploaded object; if this fails
  // (e.g. offline) it just leaves an orphaned file in storage — no data
  // integrity impact, since nothing references it once we clear `photo`.
  if (photo?.uploadedPath) {
    supabaseClient.storage.from("delivery-documents").remove([photo.uploadedPath]).catch(() => {});
  }
  photo = null;
  render();
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
  const btn = document.getElementById("submitDeliveryBtn");
  try {
    await withBusyButton(btn, () => Store.submitDelivery({
      locationId: loc.id,
      supplierId,
      invoiceNumber,
      invoiceDate: new Date().toISOString().slice(0, 10),
      notes: null,
      items,
      documentPath: photo?.status === "uploaded" ? photo.uploadedPath : null,
    }), { busyText: "Confirming…", doneText: "Confirmed ✓" });
    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    items = [];
    photo = null;
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

function emptyState(title, body, actionHtml) {
  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="window.location.href='index.html'">←</button><div class="brand">Delivery Receiving</div></div>
    <div class="screen center" style="padding-top:60px">
      <h1 style="font-size:20px">${title}</h1>
      <p class="muted">${body}</p>
      ${actionHtml || ""}
    </div>
  `;
}

// Paints the header immediately, before any network call — this is what
// makes the tap feel instant instead of a blank/white body while
// Store.init() and the three data queries below are still in flight.
// Nothing here depends on data, so it can render synchronously.
function renderShell() {
  app.innerHTML = `<div class="topbar"><button class="back" onclick="window.location.href='index.html'">←</button><div class="brand">Delivery Receiving</div></div>`;
}

async function boot() {
  renderShell();
  await Auth.requireSession();
  try {
    const profile = await Store.init();
    [LOCATIONS, SUPPLIERS, PRODUCTS] = await Promise.all([
      Store.getLocations(),
      Store.getAllSuppliers(),
      Store.getAllProducts(),
    ]);
    SUPPLIERS = SUPPLIERS.filter((s) => s.active);
    PRODUCTS = PRODUCTS.filter((p) => p.active);

    if (LOCATIONS.length === 0) {
      emptyState(
        "No location assigned",
        "You're not assigned to any location yet. Ask an administrator to assign you one (Admin → Team)."
      );
      return;
    }
    if (SUPPLIERS.length === 0) {
      if (profile.role === "admin") {
        emptyState(
          "No suppliers configured",
          "Add a supplier before receiving your first delivery.",
          `<button class="primary" onclick="window.location.href='admin.html?tab=suppliers'">Add Supplier</button>`
        );
      } else {
        emptyState(
          "No suppliers configured",
          "Ask an administrator to add a supplier before you can receive a delivery."
        );
      }
      return;
    }
    // Without this check, addItem() would crash on an empty <select> (no
    // active products -> PRODUCTS.find() returns undefined -> reading
    // undefined.name throws) with no visible error, just a dead button.
    if (PRODUCTS.length === 0) {
      if (profile.role === "admin") {
        emptyState(
          "No products configured",
          "Add at least one product before receiving a delivery.",
          `<button class="primary" onclick="window.location.href='admin.html?tab=products'">Add Product</button>`
        );
      } else {
        emptyState(
          "No products configured",
          "Ask an administrator to configure at least one product before you can receive a delivery."
        );
      }
      return;
    }
    render();
  } catch (err) {
    console.error(err);
    app.innerHTML = errorScreen(err.message);
    const btn = app.querySelector(".retry-btn");
    if (btn) btn.onclick = () => boot();
  }
}
boot();
