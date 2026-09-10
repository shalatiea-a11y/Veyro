# Restaurant Ops — Inventory MVP

A mobile-first, installable (PWA) product for the first slice of a larger
restaurant operations platform: morning inventory counting, with real
multi-tenant authentication and data isolation via Supabase.

**Philosophy:** the employee counts and confirms; the software calculates.
No AI is used here — box/piece conversions are deterministic arithmetic
against a configurable, per-organization product catalog.

## Status

Honest classification per area (see "Testing" for exactly what each claim rests on):

| Area | Status |
|---|---|
| Deterministic quantity calculations (boxes+pieces, fractions, pieces, edge cases) | **VERIFIED** — 19/19 automated tests, `tests/calculations.test.js` |
| Server-side recomputation of quantities (client can't fabricate a total) | **VERIFIED** against a real local Postgres instance |
| Cross-organization data isolation (RLS) | **VERIFIED** against a real local Postgres instance (see below) — not yet verified against the actual hosted Supabase project, since none exists yet |
| Atomic submission (no orphaned rows on partial failure) | **VERIFIED** — reproduced the old bug, confirmed the fix prevents it |
| Admin-only edit/delete of inventory history | **VERIFIED** locally |
| Per-employee location scoping (`employee_locations`) — employees can't read/write outside their assigned branch, only admins can edit the product/location catalog | **VERIFIED** locally, including a real RLS infinite-recursion bug found and fixed during testing (see "Phase 2" below) |
| Concurrent submissions to the same location/day don't corrupt data | **VERIFIED** — two genuinely parallel processes raced against real Postgres; exactly one won, zero orphaned rows (see "Phase 3") |
| Query scalability (no N+1, bounded result sets) | **VERIFIED** the fix's data shape against real Postgres; **NOT VERIFIED** under actual load/many-rows since this is still demo-scale data |
| PWA icons render correctly on iOS home screen | **NOT VERIFIED** on a physical device (no device access in this sandbox) — but the underlying defect (SVG icon, unsupported by iOS Safari) is fixed with real PNGs; verified the files are valid images of the correct dimensions |
| Admin UI (`admin.html`) — create/deactivate products & locations, assign/unassign employees to locations | **VERIFIED** the underlying writes against real Postgres (each SQL statement the UI issues, run directly); **NOT VERIFIED** in a browser — see Phase 4 below |
| `employee_locations` read policy scoped to the caller's own organization | **VERIFIED** (real bug, real fix — see Phase 4) |
| Employee self-service onboarding via invite code (`signup.html`/`join.html`, `redeem_invite()`) | **VERIFIED** against real Postgres: valid redemption, reused/expired/nonexistent code rejection, already-has-a-profile rejection, cross-org invite invisibility, and a genuine concurrent-redemption race (see Phase 5) — **NOT VERIFIED** in a browser, and the email-confirmation branch's exact behavior depends on Supabase Auth settings this sandbox can't configure or test |
| Employee/manager UI screens, real Supabase Auth login | **VERIFIED in production** — a real Supabase project was provisioned (project `veyro`), `schema.sql` run against it, an admin account created and confirmed to log in and use the app in a real browser. This is the first capability in this document verified outside this sandbox. |
| PWA install, offline behavior | **NOT VERIFIED** on a physical device |
| Delivery receiving (manual entry — see Phase 6) | Backend **VERIFIED** against real Postgres; browser UI **NOT VERIFIED** |
| Camera capture (real photo, via native file-input capture) + secure private-bucket document storage | **VERIFIED** the storage RLS against real Postgres with a Supabase-Storage-schema shim (see Phase 7) — **NOT VERIFIED** in an actual browser/camera |
| Invoice AI extraction, product matching, expected-vs-received discrepancy detection | **NOT BUILT** — see Phase 6/7, "What's deliberately not built" |
| Inventory corrections with audit trail (Phase 6) | **VERIFIED** against real Postgres |
| Suspicious-quantity soft warning (Phase 6) | Code-reviewed only, **NOT VERIFIED** — it's a UI interaction (`window.confirm`), not deterministic logic with a pure function to unit-test |
| Integrations (Oracle or any other external system), forecasting, ordering assistance | **NOT BUILT** — deliberately deferred; no external system has been identified or verified yet (see Phase 6) |

### How the backend was verified without a live Supabase project

This sandbox has PostgreSQL 16 installed locally (but no Supabase account/
credentials). To actually test the RLS policies and the `submit_daily_inventory`
function — rather than just reading them — a minimal shim was created that
emulates the two Supabase-specific pieces `schema.sql` depends on
(`auth.users`, `auth.uid()`), the full schema was applied to a throwaway
local database, and a non-superuser `authenticated` role was used so RLS
was actually enforced (superusers bypass RLS entirely, which would make
the test meaningless). Two organizations, three users (two in org 1 — one
employee, one admin — and one employee in a rival org 2) were created, and
the following were run as real queries impersonating each user:

- Org 1 employee sees only org 1's 3 locations and 10 products — confirmed.
- Org 1 employee submits inventory; server recomputes the total (verified
  it stores exactly 576 for 24 boxes @ 24/box, matching the spec).
- Org 1 employee tries to submit inventory **against the rival org's
  location** → rejected by the function's own check, before RLS even needs
  to intervene.
- Rival org employee runs a raw `SELECT` against `locations`/`products`/
  `inventory_submissions` → sees only their own org's rows, zero of org 1's.
- Rival org employee attempts a raw `INSERT` directly into
  `inventory_submissions` naming org 1's `organization_id` → rejected with
  "new row violates row-level security policy".
- Org 1 employee (role `employee`) attempts to `DELETE` a historical
  submission → `DELETE 0` (silently blocked by RLS, no rows affected).
- Org 1 **admin** performs the same delete → succeeds.
- Duplicate same-day submission for one location → rejected with a unique
  constraint violation, and critically, **zero rows left behind** — verified
  by counting rows as the table owner after the rejected attempt.
- To prove the atomicity fix actually mattered: the *old* two-step
  insert-then-insert pattern was manually reproduced (insert a submission,
  skip the items insert to simulate a mid-write failure) — this did leave
  an orphaned submission row, and a legitimate retry for that same
  location+day was then permanently rejected by the unique constraint with
  no way to recover. This confirms the bug was real and that
  `submit_daily_inventory()`'s single-transaction design fixes it.

What this does *not* prove: it does not exercise Supabase's actual Auth
service (GoTrue), PostgREST's HTTP layer, or the browser-side `auth.js`/
`storage.js`/`app.js` code against a real network — only the SQL/RLS layer,
which was the part most likely to hide a real vulnerability. The browser
flow still needs a real Supabase project to verify end-to-end.

### Phase 2: per-employee location scoping (`employee_locations`)

The first audit pass above left one gap explicitly flagged as a known
limitation: `locations` and `products` used `for all` RLS policies, so any
authenticated org member — including a plain employee — could directly
`INSERT`/`UPDATE`/`DELETE` those tables through the API, not just read
them. Closed by adding an `employee_locations` assignment table and
splitting every policy into per-action rules (read: broad; write:
admin-only; inventory read: employees scoped to their assigned
location(s), admins/managers see everything).

Testing this against the same local Postgres setup immediately surfaced a
real bug: the `locations` policy queries `employee_locations` to check an
employee's assignment, and the first version of the `employee_locations`
policy queried `locations` right back — Postgres detected the circular
dependency and refused every query on either table with "infinite
recursion detected in policy." Fixed by rewriting the `employee_locations`
policy to check `profile_id = auth.uid()` directly instead of joining
through `locations`. Re-ran the full scenario after the fix:

- An employee assigned only to "Downtown" sees exactly one location, not
  the other two — confirmed.
- The same employee's attempt to submit inventory for "Mall Branch"
  (same org, just unassigned) is rejected by `submit_daily_inventory()`
  — confirmed (the error message says "does not belong to your
  organization" rather than "not assigned," because RLS itself hides the
  unassigned location from the query the function uses to check it; this
  is a cosmetic inaccuracy, not a security gap — if anything it leaks
  less information to the caller than a precise message would).
- The same employee submitting to their own assigned location succeeds.
- Direct `INSERT` into `locations` or `products` by an employee is now
  rejected — confirmed (previously would have succeeded).
- A manager with **no** row in `employee_locations` at all still sees all
  3 org locations and all of the org's inventory submissions — confirmed
  the admin/manager blanket-visibility rule works independently of the
  assignment table.
- A manager's attempt to directly `INSERT` a product is rejected (manager
  is not admin) — confirmed the write restriction is role-specific, not
  just "not a plain employee."
- An admin's `INSERT` into `locations` succeeds — confirmed.

This is the same class of finding the rest of this document keeps
emphasizing: the recursion bug would not have been caught by reading the
SQL, only by actually running it.

### Phase 3: scalability, concurrency, and PWA correctness

A second audit pass, deliberately looking for things the first two passes
hadn't checked rather than re-running identical checks against unchanged
code:

- **N+1 query bug**: `getInventories()` fetched N submissions, then issued
  a *separate* query per submission for its line items — fine with 1-2 demo
  rows, but hundreds of extra round-trips per page load for a real chain's
  history. Fixed by embedding `inventory_items(...)` directly in the
  submission query (PostgREST/Postgres does the join server-side). Verified
  the resulting data shape by running the equivalent SQL join directly
  against Postgres — confirmed a single query returns both line items with
  correct server-computed totals (576 and 1205 for a two-product
  submission).
- **Unbounded queries**: nothing capped how many rows `getInventories()`
  could return — a real hazard once a chain has months of history. Added
  sane limits (200 org-wide / 50 per location) and a dedicated
  `todaysInventories()` for the manager dashboard's "today" summary, which
  only ever needs one row per location rather than the whole history table.
- **Concurrency**: fired two `submit_daily_inventory()` calls at the exact
  same location/day *genuinely in parallel* (two OS processes racing, not
  sequential transactions) against real Postgres. Exactly one committed;
  the other rolled back cleanly with the unique-constraint error and zero
  leftover rows — confirming the atomicity fix from Phase 1 holds under
  real concurrent load, not just sequential retries.
- **PWA icon defect**: `apple-touch-icon` pointed at an SVG, which iOS
  Safari does not support for home-screen icons — on an iPhone (a
  plausible device for restaurant staff) "Add to Home Screen" would have
  silently fallen back to a page screenshot instead of the intended icon.
  Generated real PNG icons (180×180 for `apple-touch-icon`, 192×192 and
  512×512 maskable icons for the manifest) and wired them into all three
  HTML pages (`login.html`/`manager.html` were missing manifest/icon links
  entirely).
- **Service worker cache-first bug**: the SW cached the app shell at
  install and never revalidated it, so a user who had already installed
  the PWA would keep running old `app.js`/`storage.js` indefinitely —
  including, hypothetically, a version with the security bugs fixed in
  Phase 1 — until the `CACHE` constant was bumped *and* they happened to
  reopen the app online. Rewrote to network-first with cache only as an
  offline fallback, and excluded cross-origin/non-GET requests from being
  intercepted (previously the fetch handler ran on every request including
  Supabase API calls, which happened to be harmless but was fragile).

### Phase 4: cross-tenant leak in `employee_locations`, and an admin UI

Before building anything new on top of the Phase 2 `employee_locations`
work, it was re-checked from scratch against real Postgres rather than
assumed correct — and this found a real cross-tenant vulnerability that
the Phase 2 test suite had missed: its read policy was

```sql
for select using (profile_id = auth.uid() or current_role_name() in ('admin', 'manager'))
```

which has **no organization scoping at all**. Any admin or manager, in
*any* organization, could read every row in `employee_locations` — i.e.
which employees are assigned to which locations, across every customer on
the platform. This slipped through Phase 2's verification because that
test scenario only ever seeded one organization, so "sees everyone" and
"sees everyone in my org" looked identical. This pass deliberately used a
two-organization scenario and caught it immediately: an org-1 admin could
see an org-2 employee's location assignment.

Fixed by scoping the admin/manager branch through `profiles` (safe — profiles'
own policy never queries `employee_locations`, so no repeat of the Phase 2
recursion bug):

```sql
profile_id = auth.uid()
or (current_role_name() in ('admin', 'manager')
    and profile_id in (select id from profiles where organization_id = current_org_id()))
```

Verified: an org-1 admin now sees exactly the 1 row belonging to their own
org (not the 2 that exist across both orgs, confirmed as table owner). Also
re-ran the full Phase 2 regression scenario (recursion-safety, admin-only
writes, employee/manager scoping) to confirm this fix didn't reintroduce
anything — no recursion errors, all prior checks still pass. The other two
places using the same `current_role_name() in ('admin','manager')` pattern
(`locations`, `inventory_submissions`) were already correctly wrapped in an
outer `organization_id = current_org_id() AND (...)`, so this was the one
instance of the bug, not a systemic pattern.

With that fixed, built `admin.html`/`admin.js`: create/deactivate products,
create/deactivate locations, and assign/unassign employees to locations —
the actual missing piece between this and a manager configuring their
organization without SQL access. It's a thin UI over new `storage.js`
functions (`getAllProducts`, `createProduct`, `setProductActive`,
`getAllLocations`, `createLocation`, `setLocationActive`, `getTeam`,
`assignEmployeeLocation`, `unassignEmployeeLocation`) that reuse the exact
patterns already in the file — no parallel data layer. The real
authorization boundary is still server-side: the RLS "admin insert/update"
policies reject these writes from anyone whose role isn't `admin`
regardless of what the page shows; the page's own role check is just UX.

Verified directly against Postgres: an admin creating a product, assigning
an employee to a location (who then immediately sees it via the
`locations` read policy), unassigning them (who then immediately loses
it), and deactivating a product — each exactly the SQL statement the UI
code issues, run and confirmed. **Not verified**: the actual page in a
browser (this sandbox has none) — the form rendering, button wiring, and
Supabase-JS-client plumbing around these verified SQL operations have not
been exercised end-to-end.

### Phase 5: employee self-service onboarding (invite codes)

Shipping `admin.html` immediately exposed the gap it didn't close: the
Team tab can assign *existing* profiles to locations, but there was still
no way to create a *new* profile without direct SQL access — the admin UI
couldn't actually onboard anyone. Closed with an invite-code flow:

- Admins generate a short code (`admin.html` → Team tab) scoped to a role
  and a 7-day expiry, stored in a new `invites` table.
- A new hire goes to `signup.html`, enters the code plus their own email/
  password/name. This calls Supabase Auth's `signUp()` (creating their
  `auth.users` row — outside this schema, Supabase-managed) and then a new
  `redeem_invite(code, full_name)` Postgres function that creates their
  `profiles` row.
- The tricky part: at the moment they redeem a code, they have no
  `profiles` row yet, so `current_org_id()` is null and none of the
  org-scoped RLS policies would let them read anything — including the
  invite row itself. `redeem_invite()` is `SECURITY DEFINER` specifically
  to bypass that for its own narrow lookup, but it only ever creates a
  profile for `auth.uid()` — the caller's own account — never an arbitrary
  one; the function body is the trust boundary, not a table grant.
- If the Supabase project requires email confirmation, there's no session
  yet at signup time to call `redeem_invite()` with. Handled by stashing
  the code/name in `localStorage` and adding `join.html`, which
  `storage.js`'s `Store.init()` now redirects to automatically (same
  pattern `Auth.requireSession()` already uses for "not logged in at all")
  whenever a signed-in user has no `profiles` row yet.

Verified against real Postgres, going beyond the happy path: a valid code
redeems correctly and the resulting profile is immediately usable (correct
org, correct role); reusing an already-used code is rejected; an expired
code is rejected; a nonexistent code is rejected cleanly rather than
crashing; an account that already has a profile is rejected from redeeming
a second code; an org-2 user cannot see org-1's invites at all (RLS holds
for this new table too, confirmed with the same two-organization
methodology as Phase 4, precisely because Phase 4 showed that isn't
automatic). Also fired two genuinely parallel redemption attempts at the
exact same code (matching the Phase 3 concurrency methodology) — the
function's `SELECT ... FOR UPDATE` row lock correctly serialized them:
exactly one account got linked, the other cleanly rejected, no duplicate
or partial profile.

**Not verified**: the actual pages in a browser, and — since this sandbox
cannot configure or drive Supabase Auth itself — the precise behavior of
the email-confirmation-required branch (the `localStorage` handoff to
`join.html`) end-to-end. The `redeem_invite()` half of that path (what
happens once they do reach `join.html` with a valid session) is verified;
the Supabase Auth email round-trip in front of it is not.

### Phase 6: Inventory 2.0 (corrections, sanity checks) + Delivery Receiving foundation

**Inventory corrections.** The gap: an admin could edit a submitted
inventory count directly (RLS already allowed it), but a raw `UPDATE`
would silently destroy the original value — the opposite of an audit
trail. Added `inventory_item_corrections` (append-only, insert policy
only — no update/delete, so a correction is a new fact, not an edit of
history) and `correct_inventory_item()`, which recomputes the total using
`units_per_package_at_entry` (the package size that applied *at the
original count*, never the product's current configuration — the same
principle already used for the original submission, now honored on
correction too). `manager.js` exposes this as a "Correct" button per line
item, admin-only, that asks for the new count and an optional reason.

Verified against real Postgres: an employee submits 20 boxes (480 pcs);
an employee attempting to correct their own entry is rejected (admin
only); an admin corrects it to 24 boxes, the item now shows 576, and the
correction log preserves the original 480, the new 576, and the reason —
confirmed by querying the table directly. This immediately surfaced a bug
identical in shape to the Phase 2/4 pattern: the function is `SECURITY
INVOKER`, so its own `INSERT` into the log table is itself subject to
RLS as the calling admin — and the table had no insert policy at all,
so even a legitimate admin correction was rejected with "new row
violates row-level security policy." Fixed by adding an explicit
admin-scoped insert policy (deliberately not switching to `SECURITY
DEFINER`, to stay consistent with how `submit_daily_inventory()` and
`submit_delivery()` already rely on RLS as the actual boundary). Also
confirmed a second organization cannot see the correction at all.

**Suspicious-quantity soft warning.** Per the spec's own instruction not
to silently reject unusual-but-possibly-real quantities: entering more
than 100 boxes now asks the employee to confirm ("240 boxes is unusually
high for Big Meat — that's 5,760 pieces — is that right?") before
accepting the entry, rather than blocking it or silently changing it.
Implemented as a plain confirmation prompt, not a custom modal component —
this is a UI interaction, not business logic, so it was code-reviewed
rather than unit-tested (there's no pure function here to test in
isolation the way `normalizeQuantity` has one).

**Delivery Receiving — foundation only, manual entry.** This is the
one place this phase deliberately did *not* build what was asked for.
The request included camera capture, AI document extraction, product
matching, and expected-vs-received discrepancy detection. None of those
are built. Reasons, not excuses:

- AI extraction needs a real decision — which provider, an API key, a
  cost/rate-limit policy — that only the product owner can make. Faking
  it (e.g. a hard-coded "AI" that just guesses from the invoice number)
  would be exactly the "do not fabricate AI you don't have" rule this
  same request insists on elsewhere.
- Discrepancy detection ("expected 24, received 22") needs a real source
  of *expected* quantities — a purchase order, a standing order, some
  configured expectation. None exists in this system yet. Inventing
  expected numbers to show a discrepancy screen would be fabricating data,
  not building a feature.
- Product matching (fuzzy-matching "Beef Patty Large 114g" to "Big Meat")
  is only meaningful once there's OCR'd invoice text to match *against* —
  building a matching UI with nothing to feed it would be building a
  facade.

What **is** built, because it's real and useful on its own: `suppliers`,
`deliveries`, `delivery_items` tables; `submit_delivery()` — same
atomic/server-recomputed/location-scoped pattern as
`submit_daily_inventory()`; a Suppliers tab in `admin.html`; and
`delivery.html`, where an employee manually records what a delivery
actually contained (product, boxes+pieces, optional unit price) instead
of that information going untracked. This is a real, smaller version of
the target workflow — "photograph → AI reads → verify" becomes "count →
enter → confirm" — with the exact same server-side guarantees inventory
already has, and a schema shaped so AI extraction and discrepancy
detection can attach to it later without a rewrite (the raw-entry vs.
verified-value separation the spec asks for is already how
`inventory_items` works, and `delivery_items` follows the same shape).

Verified against real Postgres: admin creates a supplier; an employee
attempting to create one directly is rejected (admin-only, matching the
products/locations pattern); an employee records a delivery of 24 boxes
Big Meat + 10 boxes Small Meat at their assigned location, and the stored
`received_quantity` values are exactly 576 and 600 (server-recomputed,
not client-trusted); an employee attempting a delivery at an unassigned
location is rejected; a second organization sees zero of these
deliveries or suppliers. `manager.js`'s branch view now also lists
recent deliveries per location — without that, a recorded delivery would
have no visibility anywhere, which would make the whole feature pointless
even at "foundation" scope.

**Not verified**: any of the new pages (`delivery.html`, the Suppliers
tab, the correction modal) in an actual browser — only their underlying
SQL operations, run directly and confirmed.

### Phase 7: real camera capture + secure document storage (still no AI)

The user reported a real bug: opening Delivery Receiving showed
`Could not find the table 'public.suppliers' in the schema cache` — the
Phase 6 migration had never actually been run against the live Supabase
project (this repo's `schema.sql` was updated, but nothing pushes that to
a live database automatically; that step is always manual — see Setup).
Not a code bug, but real feedback that the migration instructions needed
to be clearer, which they now are (see below).

Separately, the user asked for the full "photograph invoice → AI reads it
→ review → confirm" workflow. Built the honest subset:

- **Real camera capture**: `delivery.html` now has an actual "Take Photo"
  control using the browser's native `<input type="file" accept="image/*"
  capture="environment">` — this opens the device's real camera on every
  major mobile browser (including Samsung Internet) without needing raw
  `getUserMedia` stream/permission handling, which is more fragile across
  browsers. "Upload from device" is a separate fallback input. Client-side
  validation rejects non-images and files over 8MB with a clear message
  before attempting upload.
- **Secure storage**: photos upload to a new *private* Supabase Storage
  bucket, `delivery-documents`, restricted at the database level (RLS on
  `storage.objects`, same pattern as every other table) so a path's first
  segment must equal the caller's own `organization_id` — one org's
  employee cannot read or write into another org's folder even if they
  guessed a path. Viewing a photo later uses a short-lived (5-minute)
  signed URL, never a permanent public link, since the bucket is private.
- **`deliveries.document_path`**: linked atomically in the same
  `submit_delivery()` call that creates the delivery (the photo is
  uploaded to its org folder first — that only needs the org id, not a
  delivery id yet — then linked once the delivery is created), or
  attachable/replaceable afterward via a new `attach_delivery_document()`
  function, restricted to the original recorder or an admin.
- **Manager visibility**: a "View photo" button in the branch view opens
  the signed URL.

**What is still, deliberately, not built**: AI reading of the photo,
product matching, and expected-vs-received discrepancy detection. The
photo is stored as supporting evidence attached to a manually-entered
delivery — nothing currently interprets its contents. Building a fake
version of any of this (a hard-coded "AI" that guesses from the filename,
invented expected-quantity numbers with no purchase-order source, a
product-matching UI with nothing real to match against) would be exactly
what this project's own repeated instructions forbid. It needs the
product owner to choose a real AI/OCR provider and accept its cost/API-key
implications — a decision, not an engineering task.

**Verification, honestly**: `storage.objects`/`storage.buckets` don't
exist in vanilla PostgreSQL — real Supabase installs that schema, this
sandbox's local test database doesn't. Rather than leave the new RLS
policies unverified, the local test shim was extended to match Supabase's
real storage schema and `storage.foldername()` implementation closely
enough to actually test the logic (not just read it): confirmed an
employee can upload into their own org's folder, is rejected uploading
into another org's folder, a rival org sees zero of the first org's
documents, `submit_delivery()` links a document atomically at creation,
`attach_delivery_document()` is rejected for an unrelated employee and
succeeds for the original recorder or an admin. **Not verified**: the
actual camera/file-input UI, a real upload over a real network, or
viewing a signed URL — all in an actual browser, which this sandbox
doesn't have.

### Phase 8: real button feedback, honest empty states, real "needs attention"

The user asked for a broad "major UI/UX upgrade" — full visual redesign
(typography, spacing, color system, animations). That is **not** done
here, deliberately: this sandbox has no browser, so any visual claim
would be unverifiable, and shipping unverified visual changes at that
scope is exactly the "do not fabricate verification" rule this project
has followed throughout. What's built instead is the subset that's
structurally real and code-reviewable without needing to *see* it:

- **Real button states, everywhere that matters**: a new shared
  `ui.js`/`withBusyButton()` wraps Submit Inventory, Submit Delivery, the
  three admin "Add X" forms, invite generation, and inventory
  corrections. Each now shows "Saving…"/"Submitting…" while in flight and
  "Saved ✓"/"Submitted ✓" on success, and — since the button is disabled
  for the duration — a second tap while busy is a no-op rather than a
  second request. This addresses a specific, real, previously-reported
  problem: nothing indicated whether a click had done anything.
- **Role-aware empty state for Delivery Receiving**: replaced the plain
  red error text ("No suppliers configured yet…") with a proper empty
  state — an admin sees an explanation and an "Add Supplier" button that
  deep-links straight to `admin.html?tab=suppliers`; a non-admin sees
  "ask an administrator" instead of a dead-end action they can't use
  (RLS already prevented them from creating a supplier — now the UI
  doesn't even offer to).
- **"Needs attention" on the manager dashboard**, using only data that
  actually exists: locations that haven't started today's inventory, and
  a real count of deliveries received today. No discrepancy count, no
  "invoices need review" — that data doesn't exist (no AI extraction, no
  expected-vs-received comparison built), and showing a number for it
  would be exactly the "do not invent fake statistics" rule this
  document itself states.

**Verified**: all JS files parse (`node --check`), the 19 calculation
tests still pass, `manifest.json`/`vercel.json` are valid JSON, script
load order confirmed correct (`ui.js` loads before every page that calls
`withBusyButton`). **Not verified**: any of this in an actual browser —
whether a button visually looks right, whether the empty state renders
correctly, whether the dashboard's new section is legible on a phone.
No SQL changed this phase, so the Postgres-verified guarantees from
Phases 1–7 are unaffected.

### Phase 9: real Android Back behavior + the actual cause of double "Loading…"

Inspected rather than assumed. The architecture is multiple separate HTML
documents (`index.html`, `manager.html`, `delivery.html`, `admin.html`),
and within `index.html`/`manager.html` a small hand-rolled router
(`go()`/`views` in `app.js`, `renderDashboard()`/`showBranch()` in
`manager.js`) that swaps `#app`'s contents without ever touching browser
history. That's the root cause of both reported problems, not two
unrelated bugs:

- **Android Back exiting the app**: `Home → Categories → Product` was a
  *single* history entry (nothing ever called `pushState`), so Back from
  three screens deep skipped past all of it to whatever page opened
  `index.html` — often exiting the PWA. Fixed by having `go()` push a
  real history entry per screen change, with a `popstate` listener that
  replays the matching view. The same fix went into `manager.js`'s
  Dashboard↔Branch drill-down (`goDashboard()`/`goBranch()`), which had
  the identical shape of bug. The visible "←" buttons now call
  `history.back()` instead of re-rendering directly, so they stay in
  sync with whatever the hardware Back button does.
- **Double "Loading…"**: traced to `views.home()` unconditionally
  re-fetching "has this location submitted today" and repainting a full
  loading screen *every single time* the employee returned to Home —
  including just pressing Back from Categories, where nothing about that
  answer could have changed. Fixed with `homeStatusCache`, keyed by
  location id: a fresh fetch only happens when the location actually
  changes (different cache key, so no special-casing needed — a location
  switch naturally misses the cache) or right after a submission
  (explicitly passed `{ force: true }`, since the answer *did* just
  change). Plain back-and-forth navigation between Home and other
  in-app screens no longer re-fetches or re-shows a loading screen at
  all. The manager dashboard's equivalent screens (Dashboard/Branch)
  deliberately do **not** get this caching — a manager returning to the
  dashboard wants current numbers, not a stale snapshot from before they
  looked at a branch; that refetch is correct behavior, not the bug.

What was **not** changed, on purpose: this is still multiple separate
HTML documents, not a true single-page app. Navigating between
`index.html`, `delivery.html`, `admin.html`, and `manager.html` is a real
browser navigation and always was — which is *why* Back between those
pages already worked correctly (the browser's own history handles it) and
didn't need fixing. Turning this into one unified SPA would be a genuine
rewrite of the app's architecture for a problem that doesn't currently
exist; per this phase's own instruction not to rebuild working
functionality without a concrete reason, that wasn't done.

**Verified — for real, not by inspection alone**: this sandbox has no
browser, but it does have Node, so a real test harness was built using
`jsdom` (added as a dev-only dependency, see `package.json` — the app
itself still ships zero runtime dependencies and no build step) that
loads the actual `app.js`/`manager.js` source into a real DOM with a real
History API and drives it exactly like a user would:
`tests/navigation-employee.test.js` boots the app, walks
Home→Categories→ProductList→ProductEntry, confirms each step pushed
exactly one history entry, then calls `history.back()` three times and
confirms it lands on ProductList, then Categories, then Home — not
outside the app — and confirms returning to Home this way triggers zero
additional data fetches, while switching location correctly does trigger
one. `tests/navigation-manager.test.js` does the equivalent for
Dashboard↔Branch, including confirming the dashboard *does* refresh on
return (intentional, not a regression). All 14+7 assertions pass. This is
the strongest verification standard used anywhere in this document so
far for frontend logic — a real state machine actually exercised — but
it is still not the same as an actual phone: it cannot confirm how a
transition *looks*, whether a real Android "back gesture" (vs. an
in-browser Back button) fires the same `popstate` event identically
across Chrome/Samsung Internet, or timing/animation feel.

**Not done this phase, and why**: eliminating the fetch cost of
navigating *between* separate HTML pages (`index.html` → `delivery.html`,
etc.) — each is a full document load, so each re-runs
`Auth.requireSession()` and `Store.init()`'s profile lookup from scratch.
That's real, but fixing it means merging pages into one document (the
rewrite explicitly ruled out above), not a targeted fix like the two
above. Flagged as a known limitation rather than worked around with
something less honest.

## Architecture

```
Employee / Manager browser (PWA)
        |
Supabase JS client (auth.js, storage.js)
        |
Supabase (Postgres + Auth)
  - Row Level Security scopes every query to the caller's own
    organization_id — enforced by Postgres, not application code.
```

Tables (see `supabase/schema.sql`): `organizations`, `profiles` (extends
Supabase auth users with org + role), `locations`, `products`,
`inventory_submissions`, `inventory_items`. Each inventory item stores both
what the employee entered (`entered_full_boxes`, `entered_pieces`,
`entered_fraction`) and the calculated `normalized_quantity`, so historical
records stay auditable even if a product's package size changes later.

## Setup

**Important — read this before anything else**: updating `schema.sql` in
this repo does **not** change your live Supabase database. Nothing does
that automatically. Every time this file changes, you must copy the new
SQL and run it yourself in Supabase's SQL Editor — this has already
caused real confusion once (see Phase 7), so: if a new feature seems
broken or missing after a code update, check the Supabase SQL Editor
history first — it's very likely this file has changed and you haven't
run the new part yet.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/schema.sql`. This creates the schema,
   enables RLS, and seeds a demo organization ("Demo Restaurant Group")
   with 3 locations and 10 products.
3. In **Authentication → Users**, create one user (email + password) to be
   the first admin.
4. **One-time bootstrap only** — link that first admin via SQL (there's no
   admin yet to generate them an invite code):
   ```sql
   insert into profiles (id, organization_id, full_name, role)
   values ('<the user''s auth uid>', '00000000-0000-0000-0000-000000000001', 'Demo Admin', 'admin');
   ```
   Every other user after this one can be onboarded through the app itself
   — see "Adding more people" below. No further SQL is required.
5. In **Project Settings → API**, copy your Project URL and `anon` public
   key into `config.js`.
6. Serve the folder with any static file server (or open `login.html`
   directly) and sign in as the admin you just created.

### Adding more people (no SQL required)

Once the first admin is signed in: **Manager Dashboard → Admin → Team tab
→ Invite a new team member**, pick a role, and share the generated code
with them. They go to `signup.html`, enter the code plus their own email/
password/name, and their account is created and linked automatically. If
their role is `employee`, an admin still needs to assign which
location(s) they can work with (Team tab → pick a location → Assign) — an
employee with no location assigned will see zero locations and be unable
to start inventory, which is enforced by RLS, not a bug, but worth knowing
if a fresh account "shows nothing."

The `anon` key is safe to ship in frontend code — on its own it grants no
access; RLS policies are what actually restrict a signed-in user to their
own organization's rows.

## What's in this MVP

- **Login** (`login.html`) — Supabase email/password auth.
- **Employee app** (`index.html`) — pick a location, walk through product
  categories, enter quantities as full boxes + loose pieces, a box fraction
  (½, ⅓, ¼, ¾), or a direct piece count, and submit the day's inventory.
  One submission per location per day is enforced at the database level.
- **Manager dashboard** (`manager.html`) — which branches have completed
  today's inventory, and drill into any branch's submission history.
- **Admin UI** (`admin.html`, linked from the manager dashboard for
  `admin`-role users) — create/deactivate products and locations, and
  assign employees to the location(s) they can count inventory for.
  Replaces the need for direct SQL access to configure an organization.
- **Configurable product catalog** — each organization's products, package
  units and pieces-per-package live in the database, managed through the
  admin UI (or SQL/the Supabase table editor directly, if preferred).
- **Installable PWA** — `manifest.json` + `sw.js`.

## What this is not (yet)

This is the small, validated first step of a much larger vision (delivery
receiving, invoice AI extraction, discrepancy detection, integrations with
existing ERP/POS/accounting systems, analytics, forecasting, payments).
Those are deliberately out of scope until this workflow proves itself with
real employees — see the phased roadmap in the product vision doc.

## Testing

Run `npm install && npm test` to run everything (calculation logic +
navigation state machines — see Phase 9). `npm install` is only needed
for `jsdom`, a dev-only test dependency; the app itself has none.

- `node tests/calculations.test.js` — pure calculation logic (19 cases:
  worked spec examples, fractions, missing/empty input, unknown modes,
  large numbers, and the negative-input boundary between UI clamping and
  calculation logic).
- `node tests/navigation-employee.test.js` / `navigation-manager.test.js`
  — load the real `app.js`/`manager.js` into a real DOM (jsdom) and drive
  actual navigation + `history.back()`, verifying Android Back walks
  screens instead of exiting and that redundant data fetches were
  eliminated without breaking legitimate ones (21 assertions).

The RLS/multi-tenancy/atomicity claims above were verified against a real
local PostgreSQL 16 instance with a shim for Supabase's `auth.uid()` — see
"How the backend was verified without a live Supabase project". The
browser-facing flow (login → submit inventory → manager sees it) still
needs a real Supabase project — set one up per "Setup" above to verify
end-to-end.

## Security notes

- Multi-tenant isolation is enforced by Postgres RLS, not by application
  code — verified directly, including raw-SQL cross-org attack attempts
  (see "Testing"); even a compromised or buggy frontend cannot read or
  write another organization's data through the anon key.
- Quantities are recomputed server-side inside `submit_daily_inventory()`
  from the employee's raw entered values and the product's *current*
  package size read from the database — a compromised or buggy client
  cannot forge a `normalized_quantity` by sending one directly.
- No secrets are stored client-side beyond the anon key (safe by design —
  it grants no access on its own; RLS is the actual boundary).
- Duplicate same-day submissions for a location are rejected by a unique
  database constraint, not just UI logic, and the submission is atomic:
  a failure partway through can never leave an orphaned row that blocks
  a legitimate retry (verified — see "Testing").
- Only `admin`-role profiles can edit or delete a historical inventory
  submission; `employee`/`manager` roles can insert and read but not alter
  the audit trail (verified).

## Known limitations (not yet fixed — flagging honestly rather than silently)

- **No profile self-service.** New users must be linked to an organization
  via a manual SQL `insert into profiles ...` (see Setup) — there is no
  admin UI or invite flow yet.
- **Product/location configuration is via the Supabase table editor or SQL**,
  not an in-app admin screen.
- **Offline support is not implemented.** The service worker caches the
  static app shell so it loads instantly on repeat visits, but every data
  operation (login, load products, submit inventory) requires a live
  network connection to Supabase; a submission attempted while offline
  will fail with an error, not queue for later.
- **PWA icon is a plain flat SVG**, not a proper maskable icon with safe-zone
  padding — will look slightly clipped on Android's adaptive icon shapes.

## Next steps (see priority order in the product vision)

1. Verify the Supabase setup end-to-end with a real project (see "Setup")
2. Admin UI for managing products/locations/users instead of raw SQL
3. Delivery receiving with photo capture
4. AI-assisted invoice extraction (human-confirmed, never auto-applied)
5. Discrepancy detection (expected vs. actual)
6. Integrations with the customer's existing systems (only after their
   exact platform and API capabilities are verified)

## Phase 10: loading architecture — root causes, not cosmetics

Investigated by grepping every literal "Loading…" render (9 occurrences
across app.js, manager.js, admin.js, delivery.js) and reading each one's
surrounding code, rather than guessing where loading felt excessive.

**Root causes found:**
1. **Real "stuck on Loading forever" bugs** in `manager.js`'s
   `renderDashboard()` and `showBranch()` — both replaced `#app` with
   "Loading…" then awaited a `Promise.all([...])` with **zero try/catch**.
   Any rejection (a dropped connection, an RLS error) left that screen
   showing the literal word "Loading…" with no way out except reloading
   the page. Same bug, partially present, in `admin.js`: its catch handler
   wrote the error into a separate banner but never touched `#adminBody`,
   so the tab content itself stayed stuck on "Loading…" beneath the error
   line.
2. **No delay threshold anywhere.** Every async view painted "Loading…"
   the instant a fetch started, even for requests that resolve in a few
   tens of milliseconds on a normal connection — this is the concrete
   cause of loading feeling like it showed up on "almost every screen":
   it did, regardless of how fast the request actually was.
3. `app.js`'s Home screen already had targeted caching (Phase 9) so this
   was less severe there, but its cache-miss path still had no delay
   threshold and no error handling — a failed fetch would leave Home
   stuck too.
4. `delivery.js`'s `boot()` already wrapped everything in try/catch and
   rendered a real error screen on failure — checked directly, not
   assumed; no fix needed there.

**What changed:**
- Added three small shared helpers to `ui.js`: `loadingScreen()` (a
  centered spinner, not a bare text string), `errorScreen()` (message +
  Retry button), and `runAsyncView(container, { load, render, delayMs })`
  — starts a `delayMs` (default 150ms) timer before painting the loading
  screen at all, cancels it if `load()` resolves first, and on rejection
  renders Retry wired to re-run the exact same `load`+`render` pair
  instead of leaving whatever was on screen (usually "Loading…") stuck.
- Rewired `app.js`'s `history()` and `home()` views, and `manager.js`'s
  `renderDashboard()`/`showBranch()`, to go through `runAsyncView()`.
  This is the actual fix for both the flash-of-loading complaint (fast
  requests now render directly, no threshold crossed) and the stuck-
  loading bug (every one of these paths now has real error+retry).
- Fixed `admin.js`'s `showError()` to also replace `#adminBody`'s content
  with `errorScreen()` + a working Retry button, and gave tab-switching
  the same delay-threshold treatment.
- Added a real, non-fabricated online/offline banner (`initConnectivityBadge()`
  in `ui.js`) driven only by `navigator.onLine` and the browser's
  `online`/`offline` events — no polling, no fake "server status," and it
  stays hidden while online so it's not a permanent distraction. This is
  intentionally the internet-connectivity signal only; distinguishing
  "backend down but internet fine" would need a real health-check
  endpoint that doesn't exist yet, so that distinction was not
  fabricated.
- `sw.js`'s `CACHE` bumped to `rios-v10` so the service worker actually
  serves these changes instead of a stale cached bundle.

**What was NOT changed, on purpose:** the existing offline/cache fallback
in `sw.js` (network-first with a cache fallback) is untouched — this
phase's brief was online-first with a loading fix, not building offline
sync. The Android Back / history-based navigation from Phase 9 is
untouched; it already worked and this phase didn't need to touch it.
Nothing about auth, orgs, products, team, inventory math, suppliers,
delivery receiving, or the manager dashboard's data/business logic was
rebuilt — only the loading/error rendering around existing fetches.

**Verification:** added `tests/loading.test.js`, which loads the real
`ui.js` into a real jsdom DOM and drives `runAsyncView()` directly —
proving (not asserting from reading code) that a fast call never shows
the loading screen, a slow call shows it only after the threshold, and a
rejected call never leaves the container stuck on "Loading…" and Retry
actually re-invokes the same load. Re-ran the existing Phase 9 navigation
tests (`navigation-employee.test.js`, `navigation-manager.test.js`) after
wiring their mocked `window` to load the real `ui.js` too, since `app.js`/
`manager.js` now depend on it — all pass unmodified in behavior (21/21).
Total: 41/41 assertions pass (`npm test`) — VERIFIED as real executed
test coverage of the loading/error/retry state machine, not hand-tracing.

**NOT VERIFIED (needs manual phone testing):** how the spinner and Retry
button actually look and feel on a real device; whether 150ms is the
right threshold on the user's actual network conditions (Wi-Fi vs.
mobile data); whether the offline banner appears/disappears correctly
when physically toggling airplane mode; visual polish of `loadingScreen()`
/`errorScreen()` alongside each page's existing styling.

## Phase 10b: online-vs-server status, and auth-page button feedback

Follow-up on the same loading-architecture request, closing two gaps found
by re-checking the spec against what Phase 10 actually shipped:

1. **The connectivity badge only distinguished "internet"**, and only
   showed up when offline. The spec explicitly asks for internet vs.
   server to be distinguishable, and for the indicator to be visible
   (not just appear on failure). Fixed: `ui.js` now tracks two real
   signals separately — `navigator.onLine`/online/offline events for
   internet, and a `serverReachable` flag updated by `reportApiOutcome()`,
   which `runAsyncView()` and `withBusyButton()` now call after every real
   request. A small "✓ Online" / "⚠ Connection problem" / "⚠ Offline" pill
   sits in the corner at all times. No polling was added — the signal
   rides on requests the app was already making. A normal app-level error
   (duplicate submission, RLS denial) does NOT flip the server flag; only
   a genuine fetch-level failure (`Failed to fetch` / `NetworkError`)
   does, so the badge can't be tripped by ordinary business errors —
   verified in `tests/loading.test.js` with both cases.
2. **login.html/signup.html/join.html had no button feedback at all** —
   their Sign In / Create Account / Finish buttons never disabled or
   showed progress, so double-tapping them could fire the request twice.
   These pages didn't even load `ui.js`. Fixed: all three now load
   `ui.js` and wrap their submit logic in `withBusyButton()` (Signing in…,
   Creating account…, Finishing…), which also serves as the double-submit
   guard. `delivery.js`'s `boot()` also picked up the same delay-threshold
   treatment as the other pages (was previously an unconditional loading
   render), plus a Retry button on failure instead of a dead-end error
   message.

**Verified:** `npm test` — 44/44 assertions pass, including 3 new ones in
`tests/loading.test.js` that drive the real `reportApiOutcome()`/badge
logic (not hand-traced) to prove the business-error-vs-network-error
distinction actually holds. `sw.js` bumped to `rios-v11`.

**NOT VERIFIED:** how the badge looks/positions on an actual small phone
screen (it's a fixed top-right pill and could overlap a page's own
topbar content on some screen widths — worth a manual check); real-device
airplane-mode toggling.

## Phase 10c: removed the loading screens and the online badge entirely

Direct user feedback after Phase 10/10b: the loading screens and the
online/offline badge were themselves the annoyance — not a delay
threshold tuning problem. Removed both, per explicit instruction, rather
than trying to make them less noticeable.

**What changed:**
- `ui.js`: deleted `loadingScreen()`, the connectivity badge (`initConnectivityBadge()`/
  `updateConnBadge()`/`reportApiOutcome()`/`serverReachable`) entirely.
  `runAsyncView()` no longer has a delay-threshold timer or any loading
  UI at all — it just awaits `load()` and calls `render()`. The only
  thing left on failure is `errorScreen()` (message + Retry), which stays
  because the earlier, real bug (`manager.js`/`admin.js` screens stuck
  forever on a literal "Loading…" after a failed request) still needs a
  way out — removing loading text must not bring back that bug.
- `app.js` boot(), `admin.js` render(), `delivery.js` boot(): removed the
  unconditional `"Loading…"` render and the delay-threshold timers added
  in Phase 10/10b. These screens now render directly once data arrives,
  nothing shown in between.
- No badge/pill in any corner anymore on any page.

**What did NOT change:** error+retry handling (still real — a failed
request shows "Couldn't load this" + Retry, never a stuck screen), the
Android Back navigation from Phase 9, button-level Saving…/Signing in…
feedback (that's inline button text, not a page loader, and still guards
against double-submits), and all business logic.

**Verified:** `tests/loading.test.js` rewritten to assert directly that
`runAsyncView()` never paints anything but the final result or an error
— no loading string appears in the DOM at any point, for a fast call, a
slow (200ms) call, or a failing one. 40/40 total assertions pass via
`npm test`. `sw.js` bumped to `rios-v12`.

**NOT VERIFIED:** how this actually feels on the user's phone over a real
mobile connection — with no loading UI at all, a genuinely slow request
(e.g. a bad connection) will now show nothing until it either completes
or fails, which is what was asked for, but is worth confirming feels
right in practice rather than jarring.

## Phase 10d: fixed the real cause of the multi-second white screen

The user reported the actual remaining problem clearly: tapping between
pages showed a blank white screen for a few seconds before anything
appeared — not a "Loading…" text issue (that was already removed), a
real network-wait issue.

**Root cause, found by reading `sw.js`, not guessed:** the service
worker's fetch handler used `fetch(e.request, { cache: "reload" })` for
every same-origin request — every HTML page, every JS file, the CSS —
on every single navigation. `{ cache: "reload" }` deliberately forces a
real network round-trip and explicitly refuses to answer from any cache,
even the browser's own HTTP cache. That was intentional in Phase 5 to
stop users getting stuck on stale code, but it means the app could never
feel instant: every tap between pages paid for a full network fetch of
the page shell before the browser could even start rendering it,
regardless of how fast the in-app data loading was.

**Fix:** switched `sw.js` to stale-while-revalidate. A cached file now
answers immediately (so navigation is instant once the app has been
opened once), while a background fetch silently refreshes the cache for
next time — so a real code update still reaches users within a
navigation or two, without every navigation paying network latency for
files that haven't changed. `CACHE` bumped to `rios-v13` so this
actually takes effect (a previously-installed service worker needs this
version bump to replace itself).

**Verified:** read the diff against the literal caching behavior
(`cache.match` served directly when present, `fetch` only used to
refresh in the background) — this is a standard, well-understood
service-worker pattern, verified by inspection of the exact code path,
not by claiming a measured speed improvement I can't measure from here.

**NOT VERIFIED — needs your phone:** the actual feel of tapping between
Home → Delivery → Admin now, and confirming a fresh code push (like this
one) still reaches your phone within one or two app opens rather than
being stuck — reopen the app fully (not just resume it) once after this
update so the new service worker takes over.

## Phase 10e: fixed the white screen specifically on Delivery Receiving (and other pages)

User reported the white screen was still there, specifically on
Delivery Receiving, even after the service-worker fix. Investigated and
found a second, distinct root cause — not a caching problem this time.

**Root cause:** every page's `<body>` is just `<div id="app"></div>` —
completely empty until JS finishes running. `delivery.js`'s `boot()` had
to: check the session, call `Store.init()`, then run three parallel
Supabase queries (locations, suppliers, products) — and only after ALL
of that resolved did anything get written into `#app`. On a real mobile
connection those queries take real time, and for that entire time the
body was blank (background color #f4f5f7, close enough to white to read
as "white screen"). This is why Delivery specifically stood out — it
fires more queries up front than the other pages.

**Fix:** added a `renderShell()` to each page's boot() (`app.js`,
`manager.js`, `admin.js`, `delivery.js`) that paints the topbar/header
synchronously, before any `await` — so the screen never sits blank while
the data queries are in flight. The full page (with real data) replaces
this once it's actually loaded, same as before. This is not a
loading indicator — it's the app's own header, shown immediately instead
of after a delay, which is what makes the tap feel instant rather than
"blank, then everything at once."

**Verified:** all 47 assertions across `npm test` still pass (navigation,
calculations, and loading/error-state behavior — none of which depended
on the body being empty during boot). `sw.js` bumped to `rios-v14`.

**NOT VERIFIED:** the actual visual result on your phone — this is
exactly the kind of fix that needs to be felt, not just read from code.
Reopen the app fully once so the new service worker + this change take
effect, then check Delivery Receiving specifically.

## Phase 10f: found and fixed the actual render-blocking cause of the white screen

User reported the white screen was STILL there after both prior fixes
(service-worker caching, and painting a shell before data loads). Kept
investigating instead of tuning the same two fixes again, and found the
real cause this time — not a JS/data problem at all.

**Root cause:** every single page (`index.html`, `delivery.html`,
`admin.html`, `manager.html`, `login.html`, `signup.html`, `join.html`)
had `<script src=".../supabase-js@2/.../supabase.min.js"></script>` —
the Supabase SDK, loaded from a third-party CDN — placed in `<head>`,
with no `async`/`defer`. A plain `<script>` tag like that is
render-blocking: the browser cannot parse or paint anything in `<body>`
— not even the empty `#app` div, not even its background color — until
that external file has been fetched from the CDN, parsed, and executed.
Every one of the fixes in Phases 10c–10e (removing loading text, the
service-worker cache strategy, painting a shell early) only run AFTER
this blocking script finishes, so none of them could touch this delay.
This is exactly the kind of root cause that "just tune the loading
indicator" can never fix — the page genuinely could not paint anything
yet.

**Fix:** moved that `<script>` tag out of `<head>` and into `<body>`,
right before `config.js` (which is the first script that depends on
`window.supabase` existing). Execution order is unchanged — scripts
still run top-to-bottom in the same sequence — but the browser can now
parse and paint the page's HTML/CSS (including the shell from Phase 10e)
immediately, without waiting on a cross-origin network fetch first.

**Verified:** confirmed by direct inspection of every HTML file that the
tag now sits after `<div id="app">`/the page's static markup and before
`config.js`, in all 7 pages. All 47 `npm test` assertions still pass
(this change is markup-only, so it doesn't touch any tested JS
behavior). `sw.js` bumped to `rios-v15`.

**NOT VERIFIED:** the actual improvement on your phone, especially on a
real mobile data connection where the CDN fetch is slowest and this fix
matters most. Reopen the app fully once for the new service worker to
take over, then try Delivery Receiving again.

## Phase 10g: merged Delivery Receiving into the SPA — removed the page navigation itself

Three fixes in (caching, render-blocking script, shell painting) and the
user reported the same white screen again on Delivery Receiving
specifically. Every prior fix targeted things that happen DURING a page
load — but the actual remaining cause was the page load itself:
Delivery Receiving was still `delivery.html`, a separate HTML document,
reached from Home via `window.location.href = 'delivery.html'`. That is
a real full browser navigation — unload the current document, load a
new one — and browsers/PWAs can show a blank frame during that
transition no matter how fast the new page's own code runs. No amount
of caching or render-order fixing on the destination page can remove a
delay that happens before that page even starts loading.

**Fix:** merged Delivery Receiving into `app.js` as a normal `go()`/`views`
entry — the same mechanism Categories, Product Entry, and History already
use. Opening Delivery from Home is now `go('delivery')`: an in-memory
screen swap with a real history entry (so Back still works correctly),
not a document reload. `delivery.html` and `delivery.js` were deleted —
their logic (camera capture, photo upload, item entry, `submit_delivery()`
call) moved in as-is, reusing `app.js`'s already-loaded `PRODUCTS`/
`LOCATIONS` instead of re-fetching them, and fetching suppliers once,
lazily, on first visit (cached for the rest of the session — leaving and
returning to Delivery does not refetch). This also removes a real
duplicate request that existed before: the old `delivery.js` called
`Store.getAllProducts()` and filtered client-side, when `app.js` had
already fetched the same active products via `Store.getProducts()`
moments earlier during boot.

**Verified:** extended `tests/navigation-employee.test.js` with 5 new
assertions proving (not asserting from reading) that Delivery now opens
as a real in-app view with an actual history entry, that Back from it
returns to Home without leaving the app, and that suppliers are fetched
exactly once even after leaving and returning. 52/52 total assertions
pass via `npm test`. `sw.js`'s asset list updated (delivery.html/
delivery.js removed) and bumped to `rios-v16`.

**NOT VERIFIED:** the actual feel on your phone. This is the fix that
should finally remove the white screen on Delivery specifically, since
it's the first one that removes the page navigation itself rather than
speeding up what happens during it. Reopen the app fully once, then try
Home → Delivery Receiving again.

## Phase 11: generic package/unit conversion engine + design system foundation

Scope note: the request this phase covered 79 numbered sections spanning
a full commercial-product visual redesign, a generic packaging/conversion
engine with an exact 17-product catalog, product imagery, and a testing/
verification framework. That is realistically weeks of work. This pass
delivered the highest-value, most concrete, fully-verifiable slice first
— "employee counts, system calculates" — rather than spreading thin
across everything superficially. What's done is done for real (tested
against actual Postgres, not just read); what's not done is listed
honestly at the end, not silently skipped.

**Core principle implemented: employee counts, system calculates.**
Built a generic, deterministic package/unit conversion engine — no AI,
no per-product special-casing in code, just a reusable data model any
product can use:

- `supabase/schema.sql`: new `product_packages` table (ordered package
  tiers: name, contains, unit — where `unit` is either another tier's
  name or the product's `base_unit`, so arbitrary-depth hierarchies like
  Pommes' carton→bag→kg fall out of the same structure as Stora kött's
  single carton→piece tier). New `products` columns (`base_unit`,
  `base_unit_label`, `unit_weight_g`, `unit_volume_ml`, `net_weight_kg`,
  `open_piece_notes`) — all nullable/defaulted, so every existing product
  and every existing inventory record is completely unaffected. New
  `resolve_generic_inventory_quantity()` function: walks a product's
  package chain server-side and is the ONLY thing ever trusted to compute
  a normalized quantity for these entries — mirrors the same
  "client sends raw values, server recomputes" rule every other entry
  mode in this schema already followed. `submit_daily_inventory()`
  extended with a new `entry_mode = 'generic'` branch; the original
  `boxes_pieces`/`fraction`/`pieces` modes are untouched.
- `packaging.js`: the same conversion logic client-side, for instant
  preview only — `normalizeBreakdown()` (entry → total) and
  `decompose()`/`formatBreakdown()` (total → human breakdown, e.g. 17
  bags of Pommes → "3 carton + 2 bag", the exact worked example in the
  spec). A product with an unconfigured unit (Nuggets: "piece" was never
  defined) throws instead of guessing — this is what makes "no invented
  bag→piece conversion" a property of the data, not a special case.
- `app.js`: Morning Inventory's product entry screen now renders one
  input per configured unit (e.g. Pommes gets carton/bag/kg fields) with
  a live total and live decomposed-equivalent line, for any product with
  package config. A product with NONE keeps the original boxes+pieces/
  fraction/pieces UI exactly as before — this is the backward-compat
  path required by the spec (section 63).
- `admin.js` / `storage.js`: a package-tier editor added to the Products
  tab (base unit, display label, open-notes flag, an ordered add/remove
  list of tiers) — generic, works for any product including multi-tier
  ones, not built per-product.
- `supabase/seed_package_config.sql`: configures the exact 17 products
  specified (Monster x3, Bacon, Stora/Small kött, chicken/vego burgers,
  4 bread types, Pommes' 2-level hierarchy, Nuggets/Chili cheese with NO
  invented piece conversion, Ost cheddar's 2-level hierarchy, Grillost).
  Package sizes and weights ONLY — no current stock counts inserted, per
  the explicit instruction. Idempotent (re-running updates in place,
  never duplicates) and scoped automatically to your own organization —
  run it once in the Supabase SQL editor after the schema.sql additions.

**Design system foundation** (`style.css`): CSS custom properties for
color/spacing/radius/shadow/transition, a real button system (primary/
secondary/ghost/destructive, all sharing one visual language instead of
one-off styles), subtle 150-200ms screen-entrance and tap-feedback
transitions (respecting `prefers-reduced-motion`), visible focus states
for keyboard/screen-reader use, and a consistent empty-state component.
Category tiles in Morning Inventory now show a small flat SVG icon
(meat/bread/drinks/frozen/cheese/vegetable/sauce, with a sensible
fallback) instead of no icon at all — real product photography wasn't
practical here (no image hosting/licensing pipeline in this
environment), so this is the "visually consistent illustration"
fallback the spec itself allows for that case.

**Testing — what was actually run, not claimed:**
- `tests/packaging.test.js`: 44 assertions against the real engine,
  covering every product and every worked example in the spec's own
  section 60 (Pommes' cartons/bags/kg in all directions including the
  exact "17 bags → 3 carton + 2 bag" example; Nuggets and Chili cheese
  both proven to THROW on an unconfigured unit rather than invent a
  conversion; Ost cheddar's package→block→slice chain; every bread/meat/
  burger size). LOCALLY VERIFIED.
- The SQL layer was verified against a REAL local Postgres instance (not
  read by eye): applied the full updated `schema.sql` fresh twice
  (clean, no errors both times), exercised
  `resolve_generic_inventory_quantity()` and the full
  `submit_daily_inventory()` RPC end-to-end as an actual `employee` role
  under RLS (Pommes 17 bags → 42.5 kg, mixed carton+bag entries, Stora
  kött 2.5 cartons → 60 pieces — all matching packaging.js exactly),
  confirmed a non-admin is correctly blocked by RLS from writing package
  tiers, confirmed the OLD boxes_pieces mode still computes correctly
  (regression check), and ran `seed_package_config.sql` against a
  simulated real org (matched by email) twice to confirm it's genuinely
  idempotent (17 products, 17 tier rows both times, no duplicates).
  LOCALLY VERIFIED.
- `tests/navigation-employee.test.js` extended with 9 new assertions
  driving the REAL app.js UI: a package-configured product renders the
  new per-unit fields (not the legacy tabs), typing "17" into the bag
  field live-updates the total to "42.5 kg" and the equivalent line to
  "3 carton + 2 bag", and — most importantly — submitting sends the RAW
  entered breakdown (`{bag: "17"}`), never a client-computed total,
  proving the "client sends raw values, server decides" rule actually
  holds through the real UI, not just in the engine in isolation.
  LOCALLY VERIFIED.
- Total: 104/104 automated assertions pass (`npm test`).
- Admin's new package-tier editor UI: code-reviewed and manually reasoned
  through, but has no automated test and has NOT been exercised in a
  real browser. NOT VERIFIED.
- Visual/UX result on an actual phone: NOT VERIFIED — needs your review.

**Explicitly NOT done this pass (honest, not silently skipped):**
Photographic/realistic product imagery (FUTURE — needs a real image
source and licensing decision this environment can't make); full
desktop-specific grid layouts distinct from mobile (only responsive
scaling exists); PWA splash/startup screen polish; a full accessibility
audit beyond focus-visible states; skeleton loaders for lists (the
loading-architecture work in Phases 9-10 already made "no loading flash"
the default, which covers most of what skeletons would have addressed);
Manager Dashboard / Suppliers / Delivery Receiving visual overhaul beyond
inheriting the same design tokens automatically through `style.css`; any
Oracle/external-system integration (the `product_external_mappings`
table exists as pure scaffolding, zero rows, matching the explicit
instruction not to invent one); AI camera counting (explicitly excluded
by the spec itself). Recommended next step: get the seed script run and
the new Inventory entry screen reviewed on a real phone before investing
further in visual polish — that feedback should drive what's actually
worth doing next.

## Phase 12: desktop layout foundation + Delivery Receiving invoice-matching workflow (mock)

Scope note: the request this phase covered 96 numbered sections describing
a complete commercial-SaaS UI/UX overhaul. Realistically weeks of work.
This pass delivered the two highest-value, fully-real, fully-tested
pieces — the desktop layout foundation (the single biggest "not a
serious SaaS" signal found in the audit) and the complete Delivery
Receiving invoice-matching workflow — rather than touching every section
shallowly. What's done is genuinely done (tested against real Postgres
and real jsdom-driven UI flows); what's deferred is listed honestly
below, not silently skipped.

**Critical decision point, resolved by the user before implementation:**
sections 22-34 required real OCR/AI invoice reading. The user explicitly
chose to defer any real OCR provider (no API key requested, none added)
and build the complete workflow behind a swappable mock adapter instead.
This is reflected honestly everywhere: `extraction_source` is stored as
`'mock_ocr'` in the database, never `'synced'` or anything implying a
real integration exists.

**Desktop layout** (`style.css`, `ui.js`, `app.js`/`manager.js`/`admin.js`):
a persistent sidebar (`renderSidebar()` in `ui.js`, shared across all
three pages) living outside the JS router's render target so it survives
every screen change untouched. Hidden below 1024px (mobile keeps its
existing topbar-only navigation, nothing duplicated). `.screen`'s
previously-fixed 480px max-width now scales to 720px/860px at 1024px/
1440px — real breathing room, not a stretched phone column. Manager
Dashboard's branch cards go to a 2-3 column grid on desktop.

**Delivery Receiving — complete invoice-matching workflow**, replacing
the flat manual-only form as the default path (manual entry is still
one tap away, never removed — see `renderDelivery()`, unchanged):
- `ocrProvider.js`: the extraction adapter. **Mocked** — returns the
  exact example invoice from the spec (Ost cheddar/Stora bröd/Bacon/
  Pommes) in order, regardless of the photo's actual content. Swapping
  in a real OCR/vision API later means replacing this one file; nothing
  else references how extraction actually happens.
- `productMatcher.js`: deterministic (non-AI) matching of extracted text
  against the existing 17-product catalog only. Exact match → high
  confidence; substring → medium; word-overlap → low; no overlap →
  `null`. **Never creates a product** — there is no code path in this
  file capable of it. A near-miss like "Cheddar 1kg" suggests the real
  "Ost cheddar" product at low confidence rather than either auto-
  accepting it or inventing "Cheddar slices".
- One-line-at-a-time review (`renderOcrReview()`): current product,
  invoice quantity, an editable received-quantity stepper (defaults to
  the invoice quantity), a live discrepancy banner when they differ, and
  — for any non-high-confidence line — a picker restricted to the real
  catalog with an explicit "leave unresolved" option. A progress
  panel (desktop: persistent right-hand sidebar; mobile: compact list
  above the current card, per the spec's own mobile guidance) shows
  done/current/remaining/needs-review state for every line, in the
  invoice's original order — never re-sorted.
- "View original invoice" opens the photo full-screen with tap-to-zoom,
  available throughout the review.
- Completion screen summarizes matched vs. unresolved lines and any
  discrepancies before submitting.
- Submission reuses the SAME generic conversion engine as Morning
  Inventory (`packaging.js`/`resolve_generic_inventory_quantity()`) —
  no per-product formulas, no duplicate conversion logic.

**Schema** (`supabase/schema.sql`, additive only): `delivery_items` got
the same `generic` entry-mode parity `inventory_items` already had
(Pommes/Bacon/etc. can now actually be received, which they silently
couldn't before this phase — a real gap fixed as a side effect), plus an
honest audit trail: `invoice_line_order`, `extracted_text`,
`extracted_quantity`, `match_confidence`, `needs_review` — the
originally-extracted value is preserved forever, distinct from what the
employee actually confirmed, even after a correction. `deliveries` got
`extraction_source` (`'manual'` | `'mock_ocr'`) so a real future
integration's "actually synced" state can never be confused with "an
employee confirmed this in the app," which is all that exists today.

**Product visual identity**: 17 products each get a distinct color-coded
icon (`PRODUCT_VISUAL` in `app.js`) — the three Monster variants are
visually distinguishable (green/slate/orange). This is an honest
simplification, not real product photography (no image hosting/
licensing pipeline available in this environment) or bespoke per-product
illustration — disclosed as such below, not presented as more than it is.

**Icon system**: a small hand-rolled SVG set (`UI_ICONS` in `ui.js`,
Lucide-style stroke icons) replaces text-only actions with icon+label
pairs (save/edit/plus/minus/chevron/alert/check/camera/document/etc.).
Deliberately NOT an external icon library — this project ships zero
runtime dependencies by design (the Supabase SDK is the one accepted
exception), and adding a second, larger dependency purely for icons
wasn't judged worth breaking that principle mid-project; assessed per
the spec's own instruction to evaluate before replacing.

**Verified, not claimed:**
- SQL layer: applied the full updated schema fresh (clean, zero errors)
  and the incremental upgrade path on top of a simulated copy of the
  previously-live schema (also clean), BOTH re-run a second time to
  confirm idempotency (zero errors on repeat, no data loss). Exercised
  `submit_delivery()` end-to-end under real RLS as an employee role with
  a generic-mode product (Ost cheddar's package→block→slice hierarchy
  correctly computing 3 packages → 264 slices) and the original
  boxes_pieces mode side by side in the same delivery — both correct.
  LOCALLY VERIFIED.
- `tests/matching.test.js` (8 assertions): the exact "Cheddar 1kg"/
  "Cheese slices"/"Hummus" scenarios from the spec, against the real
  matcher. LOCALLY VERIFIED.
- `tests/delivery-ocr.test.js` (21 assertions): the complete workflow
  driven through real app.js code and real DOM — photo-gates extraction,
  invoice order preservation, discrepancy banner appearing/disappearing
  correctly, the generic engine firing correctly for both a multi-tier
  product (Ost cheddar) and a bare-kg product (Bacon), and the final
  submitted payload proving the RAW breakdown and original extracted
  values are what's sent, not a pre-computed total. LOCALLY VERIFIED.
- Total: 134/134 automated assertions pass (`npm test`). `sw.js` bumped
  to `rios-v18`.
- Actual visual result on a real phone/desktop browser: **NOT VERIFIED**
  — no browser available in this environment. See the chat report for
  the full breakdown by section.

**Explicitly NOT done this pass:** real OCR/AI (deferred by explicit
user decision — mock only, clearly labeled); photographic product
imagery; Suppliers/Team/Settings visual redesign beyond inherited design
tokens (they get the sidebar and color/spacing tokens automatically, but
weren't individually rebuilt); a full accessibility audit beyond
focus-visible states and icon-label pairing; animation performance
testing on real hardware; a real desktop table view for Inventory
History (still a card list, just wider); Oracle/external integration
(correctly out of scope — `product_external_mappings` stays empty
scaffolding).
