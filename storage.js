// Supabase-backed data layer. Multi-tenant isolation (which organization's
// rows you can see or write) is enforced by Postgres RLS policies in
// supabase/schema.sql — this file just issues queries scoped to whatever
// the signed-in user is authorized to see.
const Store = (() => {
  let profile = null;
  const LOCAL_KEY = "rios_current_location"; // device-local UI preference only, not business data

  async function init() {
    profile = await Auth.getProfile();
    if (!profile) {
      // Signed in (passed Auth.requireSession()) but no profiles row yet —
      // either a fresh signup.html signup whose email-confirmation flow
      // hasn't reached redeem_invite() yet, or a demo account an admin
      // hasn't linked via SQL. Either way, join.html is where that gets
      // resolved, same as Auth.requireSession() redirecting to login.html
      // for "not signed in at all". Guard against join.html itself calling
      // Store.init() and redirect-looping.
      if (!location.pathname.endsWith("join.html")) {
        window.location.href = "join.html";
      }
      throw new Error("No profile linked to this account yet — redirecting to finish setup.");
    }
    return profile;
  }

  function requireProfile() {
    if (!profile) throw new Error("Store.init() must be called before use");
    return profile;
  }

  async function getProducts() {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*, product_packages(sort_order, name, contains, unit)")
      .eq("active", true)
      .order("category")
      .order("name");
    if (error) throw error;
    // packages stays [] for any product with no product_packages rows —
    // that's exactly what tells the UI to fall back to the original
    // single-tier boxes+pieces/fraction/pieces entry mode, so existing
    // products with no package configuration behave exactly as before.
    return data.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      unit: p.package_unit,
      unitsPerBox: p.units_per_package,
      base_unit: p.base_unit,
      base_unit_label: p.base_unit_label || p.base_unit,
      unit_weight_g: p.unit_weight_g,
      unit_volume_ml: p.unit_volume_ml,
      net_weight_kg: p.net_weight_kg,
      open_piece_notes: p.open_piece_notes,
      packages: (p.product_packages || [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((t) => ({ name: t.name, contains: Number(t.contains), unit: t.unit })),
    }));
  }

  async function getLocations() {
    const { data, error } = await supabaseClient
      .from("locations")
      .select("id, name")
      .eq("active", true)
      .order("name");
    if (error) throw error;
    return data;
  }

  async function getCategories() {
    const products = await getProducts();
    return [...new Set(products.map((p) => p.category))];
  }

  function getCurrentLocation() { return localStorage.getItem(LOCAL_KEY); }
  function setCurrentLocation(id) { localStorage.setItem(LOCAL_KEY, id); }

  // Deterministic normalization: full boxes + loose pieces -> total pieces.
  // Never involves AI — exact arithmetic on the configured conversion rate.
  function normalizeQuantity(product, entry) {
    if (entry.mode === "generic") {
      // Delegates to the shared deterministic engine (packaging.js) so
      // there's exactly one implementation of the conversion math on the
      // client — this call is only ever a live preview; submit_daily_inventory()
      // in Postgres is the one that's actually trusted.
      return typeof normalizeBreakdown === "function"
        ? normalizeBreakdown(product, entry.breakdown || {})
        : 0;
    }
    const perBox = product.unitsPerBox;
    if (entry.mode === "boxes+pieces") {
      const boxes = Number(entry.fullBoxes) || 0;
      const pieces = Number(entry.pieces) || 0;
      return boxes * perBox + pieces;
    }
    if (entry.mode === "fraction") {
      const fractions = { full: 1, "3/4": 0.75, "1/2": 0.5, "1/3": 1 / 3, "1/4": 0.25 };
      const frac = fractions[entry.fraction] ?? 0;
      return Math.round(perBox * frac);
    }
    if (entry.mode === "pieces") {
      return Number(entry.pieces) || 0;
    }
    return 0;
  }

  const MODE_TO_DB = { "boxes+pieces": "boxes_pieces", fraction: "fraction", pieces: "pieces" };

  // Both queries below embed inventory_items(...) directly in the select
  // instead of fetching submissions and then looping to fetch each one's
  // items separately (an N+1 pattern the first version of this file had —
  // fine at demo scale with 1-2 submissions, but would mean hundreds of
  // extra round-trips per page load for a real multi-location chain's
  // history). One request, one join, done by PostgREST/Postgres.
  const SUBMISSION_SELECT =
    "id, location_id, submitted_at, inventory_date, profiles(full_name), " +
    "inventory_items(id, product_id, normalized_quantity, products(name))";

  function toRecord(submission) {
    return {
      id: submission.id,
      locationId: submission.location_id,
      date: submission.inventory_date,
      timestamp: new Date(submission.submitted_at).getTime(),
      employee: submission.profiles?.full_name || "Unknown",
      items: (submission.inventory_items || []).map((it) => ({
        itemId: it.id,
        productId: it.product_id,
        productName: it.products?.name || "Unknown product",
        totalPieces: it.normalized_quantity,
      })),
    };
  }

  async function todaysInventory(locationId) {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseClient
      .from("inventory_submissions")
      .select(SUBMISSION_SELECT)
      .eq("location_id", locationId)
      .eq("inventory_date", today)
      .maybeSingle();
    if (error) throw error;
    return data ? toRecord(data) : null;
  }

  // Bounded by default (most recent 200 submissions org-wide, or 50 for a
  // single location) — an unbounded "fetch the whole table" query is a
  // real scalability hazard once a chain has months of daily history
  // across many branches. Callers that genuinely need more can raise the
  // limit explicitly.
  async function getInventories({ locationId, limit } = {}) {
    let query = supabaseClient
      .from("inventory_submissions")
      .select(SUBMISSION_SELECT)
      .order("submitted_at", { ascending: false })
      .limit(limit ?? (locationId ? 50 : 200));
    if (locationId) query = query.eq("location_id", locationId);
    const { data, error } = await query;
    if (error) throw error;
    return data.map(toRecord);
  }

  // For the manager dashboard's "today" summary, which only ever needs
  // one row per location — a single filtered query rather than pulling
  // history and filtering client-side.
  async function todaysInventories() {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseClient
      .from("inventory_submissions")
      .select(SUBMISSION_SELECT)
      .eq("inventory_date", today);
    if (error) throw error;
    return data.map(toRecord);
  }

  // Writes go through the submit_daily_inventory() Postgres function
  // (supabase/schema.sql) rather than direct table inserts: it recomputes
  // the box/piece math server-side (never trusting the client's total),
  // validates the location/products belong to the caller's own
  // organization, and writes the submission + all items in one atomic
  // transaction — so a mid-way failure can never leave an orphaned
  // submission row that blocks a retry.
  async function saveInventory(record) {
    requireProfile();
    const items = record.items.map((it) => it.entry.mode === "generic"
      ? { product_id: it.productId, entry_mode: "generic", entered_breakdown: it.entry.breakdown }
      : {
        product_id: it.productId,
        entry_mode: MODE_TO_DB[it.entry.mode],
        entered_full_boxes: it.entry.fullBoxes ?? null,
        entered_pieces: it.entry.pieces ?? null,
        entered_fraction: it.entry.fraction ?? null,
      });
    const { data, error } = await supabaseClient.rpc("submit_daily_inventory", {
      p_location_id: record.locationId,
      p_items: items,
      p_inventory_date: record.date,
    });
    if (error) throw error;
    return data;
  }

  // --- Admin configuration (products/locations/team) ---
  // These issue plain inserts/updates rather than an RPC, unlike
  // saveInventory: there's no multi-row atomicity concern (each is a
  // single-row write) and no client-trusted calculation to guard against.
  // The real authorization boundary is still server-side — the
  // "admin insert/update" RLS policies in schema.sql reject these from
  // anyone whose role isn't 'admin', regardless of what the UI shows.

  async function getAllProducts() {
    const { organization_id } = requireProfile();
    const { data, error } = await supabaseClient
      .from("products")
      .select("*, product_packages(id, sort_order, name, contains, unit)")
      .eq("organization_id", organization_id)
      .order("category")
      .order("name");
    if (error) throw error;
    return data.map((p) => ({
      ...p,
      product_packages: (p.product_packages || []).slice().sort((a, b) => a.sort_order - b.sort_order),
    }));
  }

  // Replaces a product's entire package-tier list. Simpler and safer than
  // per-row add/remove RPCs for a rarely-changed, short list (typically
  // 0-2 tiers) — admin.js sends the full desired list each time.
  async function setProductPackages(productId, tiers) {
    const { error: delErr } = await supabaseClient.from("product_packages").delete().eq("product_id", productId);
    if (delErr) throw delErr;
    if (tiers.length === 0) return;
    const { error: insErr } = await supabaseClient.from("product_packages").insert(
      tiers.map((t, i) => ({ product_id: productId, sort_order: i + 1, name: t.name, contains: t.contains, unit: t.unit }))
    );
    if (insErr) throw insErr;
  }

  async function updateProductBaseUnit(productId, { baseUnit, baseUnitLabel, openPieceNotes }) {
    const { error } = await supabaseClient.from("products").update({
      base_unit: baseUnit, base_unit_label: baseUnitLabel || null, open_piece_notes: !!openPieceNotes,
    }).eq("id", productId);
    if (error) throw error;
  }

  async function createProduct({ name, category, packageUnit, unitsPerPackage }) {
    const { organization_id } = requireProfile();
    const { error } = await supabaseClient.from("products").insert({
      organization_id, name, category,
      package_unit: packageUnit, units_per_package: unitsPerPackage,
    });
    if (error) throw error;
  }

  async function setProductActive(id, active) {
    const { error } = await supabaseClient.from("products").update({ active }).eq("id", id);
    if (error) throw error;
  }

  async function getAllLocations() {
    const { organization_id } = requireProfile();
    const { data, error } = await supabaseClient
      .from("locations")
      .select("*")
      .eq("organization_id", organization_id)
      .order("name");
    if (error) throw error;
    return data;
  }

  async function createLocation({ name }) {
    const { organization_id } = requireProfile();
    const { error } = await supabaseClient.from("locations").insert({ organization_id, name });
    if (error) throw error;
  }

  async function setLocationActive(id, active) {
    const { error } = await supabaseClient.from("locations").update({ active }).eq("id", id);
    if (error) throw error;
  }

  // Team + their location assignments, one query each (not per-row) to
  // avoid repeating the N+1 mistake fixed elsewhere in this file.
  async function getTeam() {
    const { organization_id } = requireProfile();
    const [{ data: profiles, error: pErr }, { data: assignments, error: aErr }] = await Promise.all([
      supabaseClient.from("profiles").select("id, full_name, role").eq("organization_id", organization_id).order("full_name"),
      supabaseClient.from("employee_locations").select("profile_id, location_id, locations(name)"),
    ]);
    if (pErr) throw pErr;
    if (aErr) throw aErr;
    return profiles.map((p) => ({
      ...p,
      locations: assignments.filter((a) => a.profile_id === p.id).map((a) => ({ id: a.location_id, name: a.locations?.name })),
    }));
  }

  async function assignEmployeeLocation(profileId, locationId) {
    const { error } = await supabaseClient.from("employee_locations").insert({ profile_id: profileId, location_id: locationId });
    if (error) throw error;
  }

  async function unassignEmployeeLocation(profileId, locationId) {
    const { error } = await supabaseClient.from("employee_locations")
      .delete().eq("profile_id", profileId).eq("location_id", locationId);
    if (error) throw error;
  }

  function generateInviteCode() {
    // Short, human-typeable (no ambiguous 0/O/1/I), not a security secret on
    // its own — the 7-day expiry + single-use enforcement in
    // redeem_invite() is what actually matters, this is just legible.
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }

  async function createInvite(role) {
    const { organization_id, id } = requireProfile();
    const code = generateInviteCode();
    const { error } = await supabaseClient.from("invites").insert({
      organization_id, code, role, created_by: id,
    });
    if (error) throw error;
    return code;
  }

  async function getInvites() {
    const { organization_id } = requireProfile();
    const { data, error } = await supabaseClient
      .from("invites")
      .select("*")
      .eq("organization_id", organization_id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async function revokeInvite(id) {
    const { error } = await supabaseClient.from("invites").delete().eq("id", id).is("used_at", null);
    if (error) throw error;
  }

  async function redeemInvite(code, fullName) {
    const { data, error } = await supabaseClient.rpc("redeem_invite", { p_code: code, p_full_name: fullName });
    if (error) throw error;
    return data;
  }

  // --- Inventory 2.0: controlled corrections ---
  // Goes through correct_inventory_item() (schema.sql), not a direct
  // update — that function recomputes the total from the package size
  // that applied at the original entry, and writes an immutable log row
  // preserving what was there before. RLS also enforces admin-only, this
  // is a second layer, not the boundary.
  async function correctInventoryItem(itemId, entry, reason) {
    const { data, error } = await supabaseClient.rpc("correct_inventory_item", {
      p_item_id: itemId,
      p_entry_mode: MODE_TO_DB[entry.mode],
      p_full_boxes: entry.fullBoxes ?? null,
      p_pieces: entry.pieces ?? null,
      p_fraction: entry.fraction ?? null,
      p_reason: reason || null,
    });
    if (error) throw error;
    return data;
  }

  async function getInventoryCorrections(itemId) {
    const { data, error } = await supabaseClient
      .from("inventory_item_corrections")
      .select("*")
      .eq("item_id", itemId)
      .order("corrected_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  // --- Suppliers (admin-managed, like products/locations) ---
  async function getAllSuppliers() {
    const { organization_id } = requireProfile();
    const { data, error } = await supabaseClient
      .from("suppliers").select("*").eq("organization_id", organization_id).order("name");
    if (error) throw error;
    return data;
  }

  async function createSupplier(name) {
    const { organization_id } = requireProfile();
    const { error } = await supabaseClient.from("suppliers").insert({ organization_id, name });
    if (error) throw error;
  }

  async function setSupplierActive(id, active) {
    const { error } = await supabaseClient.from("suppliers").update({ active }).eq("id", id);
    if (error) throw error;
  }

  // --- Delivery Receiving (manual entry — see README: camera/AI
  // extraction, product matching, and expected-vs-received discrepancy
  // detection are not implemented; this records what was actually typed
  // in, atomically, with the same server-side recomputation and
  // location-scoping guarantees as saveInventory). ---
  const DELIVERY_SELECT =
    "id, location_id, supplier_id, received_at, invoice_number, invoice_date, notes, document_path, " +
    "profiles(full_name), suppliers(name), " +
    "delivery_items(product_id, received_quantity, unit_price, products(name))";

  function toDeliveryRecord(d) {
    return {
      id: d.id,
      locationId: d.location_id,
      supplierName: d.suppliers?.name || "Unknown supplier",
      receivedBy: d.profiles?.full_name || "Unknown",
      receivedAt: new Date(d.received_at).getTime(),
      invoiceNumber: d.invoice_number,
      invoiceDate: d.invoice_date,
      notes: d.notes,
      documentPath: d.document_path,
      items: (d.delivery_items || []).map((it) => ({
        productName: it.products?.name || "Unknown product",
        receivedQuantity: it.received_quantity,
        unitPrice: it.unit_price,
      })),
    };
  }

  async function submitDelivery({ locationId, supplierId, invoiceNumber, invoiceDate, notes, items, documentPath, extractionSource }) {
    requireProfile();
    const payload = items.map((it) => it.entry.mode === "generic"
      ? {
        product_id: it.productId, entry_mode: "generic", entered_breakdown: it.entry.breakdown,
        unit_price: it.unitPrice ?? null, invoice_line_order: it.invoiceLineOrder ?? null,
        extracted_text: it.extractedText ?? null, extracted_quantity: it.extractedQuantity ?? null,
        match_confidence: it.matchConfidence ?? null, needs_review: it.needsReview ?? false,
      }
      : {
        product_id: it.productId,
        entry_mode: MODE_TO_DB[it.entry.mode],
        entered_full_boxes: it.entry.fullBoxes ?? null,
        entered_pieces: it.entry.pieces ?? null,
        entered_fraction: it.entry.fraction ?? null,
        unit_price: it.unitPrice ?? null,
        invoice_line_order: it.invoiceLineOrder ?? null,
        extracted_text: it.extractedText ?? null,
        extracted_quantity: it.extractedQuantity ?? null,
        match_confidence: it.matchConfidence ?? null,
        needs_review: it.needsReview ?? false,
      });
    const { data, error } = await supabaseClient.rpc("submit_delivery", {
      p_location_id: locationId,
      p_supplier_id: supplierId,
      p_invoice_number: invoiceNumber || null,
      p_invoice_date: invoiceDate || null,
      p_notes: notes || null,
      p_items: payload,
      p_document_path: documentPath || null,
      p_extraction_source: extractionSource || "manual",
    });
    if (error) throw error;
    return data;
  }

  // --- Delivery document photo (camera capture / file upload) ---
  // Uploaded to Supabase Storage's private "delivery-documents" bucket
  // (schema.sql) BEFORE the delivery row exists — the org-scoped storage
  // path doesn't need a delivery id, only the organization id, so the
  // photo can be captured first and linked in the same submit_delivery()
  // call once the employee finishes entering items. No AI reads this
  // photo (see README) — it's stored as supporting evidence for the
  // manually-entered delivery, viewable later by anyone authorized to see
  // that org's deliveries.
  async function uploadDeliveryDocument(file) {
    const { organization_id } = requireProfile();
    const ext = (file.name?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${organization_id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabaseClient.storage.from("delivery-documents").upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  async function attachDeliveryDocument(deliveryId, path) {
    const { error } = await supabaseClient.rpc("attach_delivery_document", {
      p_delivery_id: deliveryId, p_path: path,
    });
    if (error) throw error;
  }

  // Signed URL, not a public link — the bucket is private, so viewing a
  // photo (even one you're authorized to see) needs a short-lived signed
  // URL rather than a permanent public path.
  async function getDeliveryDocumentUrl(path) {
    const { data, error } = await supabaseClient.storage
      .from("delivery-documents")
      .createSignedUrl(path, 300); // 5 minutes — long enough to view, short enough not to matter if it leaks
    if (error) throw error;
    return data.signedUrl;
  }

  async function getDeliveries({ locationId, limit } = {}) {
    let query = supabaseClient
      .from("deliveries")
      .select(DELIVERY_SELECT)
      .order("received_at", { ascending: false })
      .limit(limit ?? (locationId ? 50 : 200));
    if (locationId) query = query.eq("location_id", locationId);
    const { data, error } = await query;
    if (error) throw error;
    return data.map(toDeliveryRecord);
  }

  return {
    init,
    getProducts,
    getLocations,
    getCategories,
    getCurrentLocation,
    setCurrentLocation,
    saveInventory,
    todaysInventory,
    todaysInventories,
    getInventories,
    normalizeQuantity,
    getAllProducts,
    createProduct,
    setProductPackages,
    updateProductBaseUnit,
    setProductActive,
    getAllLocations,
    createLocation,
    setLocationActive,
    getTeam,
    assignEmployeeLocation,
    unassignEmployeeLocation,
    createInvite,
    getInvites,
    revokeInvite,
    redeemInvite,
    correctInventoryItem,
    getInventoryCorrections,
    getAllSuppliers,
    createSupplier,
    setSupplierActive,
    submitDelivery,
    getDeliveries,
    uploadDeliveryDocument,
    attachDeliveryDocument,
    getDeliveryDocumentUrl,
  };
})();
