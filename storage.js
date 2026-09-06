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
      .select("*")
      .eq("active", true)
      .order("category")
      .order("name");
    if (error) throw error;
    return data.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      unit: p.package_unit,
      unitsPerBox: p.units_per_package,
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
    "inventory_items(product_id, normalized_quantity, products(name))";

  function toRecord(submission) {
    return {
      id: submission.id,
      locationId: submission.location_id,
      date: submission.inventory_date,
      timestamp: new Date(submission.submitted_at).getTime(),
      employee: submission.profiles?.full_name || "Unknown",
      items: (submission.inventory_items || []).map((it) => ({
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
    const items = record.items.map((it) => ({
      product_id: it.productId,
      entry_mode: MODE_TO_DB[it.entry.mode],
      entered_full_boxes: it.entry.fullBoxes ?? null,
      entered_pieces: it.entry.pieces ?? null,
      entered_fraction: it.entry.fraction ?? null,
    }));
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
      .select("*")
      .eq("organization_id", organization_id)
      .order("category")
      .order("name");
    if (error) throw error;
    return data;
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
  };
})();
