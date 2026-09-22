// Weekly business summary, emailed to every admin/manager in each
// organization: waste cost (SEK), inventory completion, deliveries
// received, and any products currently below their par level.
//
// Triggered by pg_cron (see schema.sql's "Weekly report scheduling"
// section) via pg_net once a week — not by a signed-in user, so this
// function is NOT protected by Supabase's normal JWT check (verify_jwt
// false at deploy time). Instead it checks a shared secret header the
// cron job sends, so a stranger can't trigger emails by guessing the URL.
//
// Uses the service-role key to read across the whole database (a
// cross-org report can't be scoped by one user's RLS), but only ever
// SENDS data about an organization to that organization's own
// admins/managers — never mixes orgs in one email.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Resend's shared test sender — works with no domain setup, but Resend
// only delivers it to the account's own verified address until a real
// sending domain is verified. See the deployment README.
const FROM_ADDRESS = Deno.env.get("REPORT_FROM_ADDRESS") || "Veyro Reports <onboarding@resend.dev>";

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-cron-secret, content-type" };
}

function fmtKr(n: number) {
  return `${Math.round(n).toLocaleString("sv-SE")} kr`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });

  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders() });
  }
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY is not configured" }), { status: 400, headers: corsHeaders() });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sinceDate = since.slice(0, 10);

  const { data: orgs, error: orgsErr } = await supabase.from("organizations").select("id, name");
  if (orgsErr) return new Response(JSON.stringify({ error: orgsErr.message }), { status: 500, headers: corsHeaders() });

  const results: Record<string, unknown>[] = [];

  for (const org of orgs || []) {
    const { data: recipients } = await supabase
      .from("profiles")
      .select("full_name, role, id")
      .eq("organization_id", org.id)
      .in("role", ["admin", "manager"]);
    if (!recipients || recipients.length === 0) continue;

    const emails: string[] = [];
    for (const r of recipients) {
      const { data: authUser } = await supabase.auth.admin.getUserById(r.id);
      if (authUser?.user?.email) emails.push(authUser.user.email);
    }
    if (emails.length === 0) continue;

    const { data: locations } = await supabase.from("locations").select("id, name").eq("organization_id", org.id).eq("active", true);

    const { data: waste } = await supabase
      .from("waste_entries")
      .select("normalized_quantity, unit_cost_at_entry, products(name)")
      .eq("organization_id", org.id)
      .gte("recorded_at", since);
    const wasteWithCost = (waste || []).filter((w: any) => w.unit_cost_at_entry != null);
    const wasteTotal = wasteWithCost.reduce((sum: number, w: any) => sum + Number(w.unit_cost_at_entry) * Number(w.normalized_quantity), 0);
    const byProduct: Record<string, number> = {};
    wasteWithCost.forEach((w: any) => {
      const name = w.products?.name || "Unknown";
      byProduct[name] = (byProduct[name] || 0) + Number(w.unit_cost_at_entry) * Number(w.normalized_quantity);
    });
    const topWaste = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const wasteMissingCost = (waste || []).length - wasteWithCost.length;

    const { data: deliveries } = await supabase
      .from("deliveries")
      .select("id")
      .eq("organization_id", org.id)
      .gte("received_at", since);

    const { data: submissions } = await supabase
      .from("inventory_submissions")
      .select("location_id, inventory_date")
      .eq("organization_id", org.id)
      .gte("inventory_date", sinceDate);
    const daysDoneByLocation: Record<string, Set<string>> = {};
    (submissions || []).forEach((s: any) => {
      (daysDoneByLocation[s.location_id] ||= new Set()).add(s.inventory_date);
    });
    const completionRows = (locations || []).map((l: any) => ({
      name: l.name,
      daysDone: daysDoneByLocation[l.id]?.size || 0,
    }));

    const { data: lowStockProducts } = await supabase
      .from("products")
      .select("id, name, par_level, base_unit, base_unit_label")
      .eq("organization_id", org.id)
      .not("par_level", "is", null);
    const lowStockRows: string[] = [];
    if (lowStockProducts && lowStockProducts.length > 0) {
      // Most recent submission per location this week, newest first, with
      // its items — same shape as storage.js's own SUBMISSION_SELECT, just
      // queried directly here since this function runs outside the client.
      const { data: recentSubs } = await supabase
        .from("inventory_submissions")
        .select("location_id, inventory_date, inventory_items(product_id, normalized_quantity)")
        .eq("organization_id", org.id)
        .gte("inventory_date", sinceDate)
        .order("inventory_date", { ascending: false });
      const locationNameById: Record<string, string> = Object.fromEntries((locations || []).map((l: any) => [l.id, l.name]));
      const latestByLocationProduct: Record<string, number> = {};
      const seenLocation = new Set<string>();
      (recentSubs || []).forEach((sub: any) => {
        if (seenLocation.has(sub.location_id)) return; // already have a newer count for this location
        seenLocation.add(sub.location_id);
        (sub.inventory_items || []).forEach((it: any) => {
          latestByLocationProduct[`${sub.location_id}:${it.product_id}`] = Number(it.normalized_quantity);
        });
      });
      lowStockProducts.forEach((p: any) => {
        seenLocation.forEach((locId) => {
          const have = latestByLocationProduct[`${locId}:${p.id}`];
          if (have != null && have < Number(p.par_level)) {
            lowStockRows.push(`${p.name} — ${locationNameById[locId] || "?"}: ${have}/${p.par_level} ${p.base_unit_label || p.base_unit}`);
          }
        });
      });
    }

    const html = `
      <h2>Veyro — weekly summary for ${org.name}</h2>
      <p style="color:#6b7280">${sinceDate} – today</p>

      <h3>Waste</h3>
      <p style="font-size:24px;font-weight:700;margin:4px 0">${fmtKr(wasteTotal)}</p>
      ${wasteMissingCost > 0 ? `<p style="color:#6b7280;font-size:13px">+ ${wasteMissingCost} logged item(s) with no known cost yet</p>` : ""}
      ${topWaste.length ? `<ul>${topWaste.map(([n, v]) => `<li>${n} — ${fmtKr(v)}</li>`).join("")}</ul>` : "<p>No waste logged this week.</p>"}

      <h3>Deliveries received</h3>
      <p>${(deliveries || []).length} this week</p>

      <h3>Morning inventory completion</h3>
      <ul>${completionRows.map((r) => `<li>${r.name}: ${r.daysDone}/7 days</li>`).join("")}</ul>

      ${lowStockRows.length ? `<h3 style="color:#b91c1c">Below par level</h3><ul>${lowStockRows.map((r) => `<li>${r}</li>`).join("")}</ul>` : ""}

      <p style="color:#9ca3af;font-size:12px;margin-top:24px">Automated weekly report from Veyro.</p>
    `;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: emails,
        subject: `Veyro weekly summary — ${org.name}`,
        html,
      }),
    });
    results.push({ org: org.name, recipients: emails.length, emailStatus: emailRes.status });
  }

  return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
});
