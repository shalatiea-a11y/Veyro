-- Restaurant Ops Platform — core schema
-- Run this once in your Supabase project's SQL editor.
-- Multi-tenant isolation is enforced with Postgres Row Level Security (RLS):
-- every table that holds business data carries organization_id, and every
-- policy checks it against the signed-in user's own organization via the
-- profiles table. No app code can bypass this — it's enforced by Postgres.

create extension if not exists "pgcrypto";

-- One row per restaurant company / customer of the platform.
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Extends auth.users (Supabase-managed) with org membership + role.
-- Role model: employee | manager | admin. Kept simple; regional/HQ tiers
-- can be added later without changing the shape.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name text not null,
  role text not null default 'employee' check (role in ('employee', 'manager', 'admin')),
  created_at timestamptz not null default now()
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  category text not null,
  package_unit text not null default 'box',
  units_per_package integer not null check (units_per_package > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per submitted morning inventory (one location, one day, one employee).
create table inventory_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  submitted_by uuid not null references profiles(id),
  submitted_at timestamptz not null default now(),
  inventory_date date not null default current_date
);

-- Line items. entered_* columns preserve exactly what the employee typed;
-- normalized_quantity is the deterministic calculation, computed by the
-- application (never by AI) at submission time and stored, not recomputed
-- silently later — this keeps historical records auditable even if a
-- product's package size changes afterwards.
create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references inventory_submissions(id) on delete cascade,
  product_id uuid not null references products(id),
  entry_mode text not null check (entry_mode in ('boxes_pieces', 'fraction', 'pieces')),
  entered_full_boxes numeric check (entered_full_boxes is null or entered_full_boxes >= 0),
  entered_pieces numeric check (entered_pieces is null or entered_pieces >= 0),
  entered_fraction text check (entered_fraction is null or entered_fraction in ('full','3/4','1/2','1/3','1/4')),
  units_per_package_at_entry integer not null check (units_per_package_at_entry > 0),
  normalized_quantity numeric not null check (normalized_quantity >= 0)
);

create unique index inventory_submissions_one_per_day
  on inventory_submissions (location_id, inventory_date);

create index inventory_submissions_org_idx on inventory_submissions (organization_id);
create index inventory_items_submission_idx on inventory_items (submission_id);
create index locations_org_idx on locations (organization_id);
create index products_org_idx on products (organization_id);

-- Helper: the calling user's organization_id, looked up once per query.
create or replace function current_org_id() returns uuid
language sql stable security definer as $$
  select organization_id from profiles where id = auth.uid();
$$;

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table locations enable row level security;
alter table products enable row level security;
alter table inventory_submissions enable row level security;
alter table inventory_items enable row level security;

create policy "own org only" on organizations
  for select using (id = current_org_id());

create policy "profiles in own org" on profiles
  for select using (organization_id = current_org_id());

-- Which locations a given employee is allowed to work with. Admins and
-- managers are not listed here — they see every location in their
-- organization regardless (checked via current_role() below). Only meant
-- to scope plain employees to the branch(es) they actually work at.
create table employee_locations (
  profile_id uuid not null references profiles(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  primary key (profile_id, location_id)
);
alter table employee_locations enable row level security;

create or replace function current_role_name() returns text
language sql stable security definer as $$
  select role from profiles where id = auth.uid();
$$;

-- Deliberately does NOT reference the locations table: locations' own
-- policy (below) queries employee_locations to decide what an employee can
-- see, so if this policy queried locations right back, Postgres would
-- detect infinite recursion between the two (confirmed by testing this
-- exact scenario against a real instance — see README). A profile can
-- always see its own assignment rows; admins/managers can see everyone's
-- IN THEIR OWN ORGANIZATION — querying profiles (not locations) to scope
-- this is safe, since profiles' own policy never queries employee_locations
-- back. The unscoped "admin/manager sees everyone's" version of this
-- policy shipped in the previous commit was a real cross-tenant leak (an
-- admin in one org could read which employees are assigned to which
-- locations in every other org on the platform) — caught in this pass
-- because a two-organization test scenario was used, unlike the
-- single-org scenario that verified the original recursion fix.
create policy "own assignments or admin/manager in own org" on employee_locations
  for select using (
    profile_id = auth.uid()
    or (
      current_role_name() in ('admin', 'manager')
      and profile_id in (select id from profiles where organization_id = current_org_id())
    )
  );

create policy "admin manages location assignments" on employee_locations
  for insert with check (current_role_name() = 'admin');
create policy "admin updates location assignments" on employee_locations
  for update using (current_role_name() = 'admin');
create policy "admin removes location assignments" on employee_locations
  for delete using (current_role_name() = 'admin');

-- Configuration data (locations, products): every org member can read it
-- (an employee needs to see the product catalog to count inventory), but
-- only admins can create/edit/delete it — this was previously "for all",
-- which let a plain employee write directly to these tables.
-- An employee is further restricted to their assigned location(s);
-- admins/managers see and can be assigned to every location in the org.
create policy "locations readable in own org, scoped for employees" on locations
  for select using (
    organization_id = current_org_id()
    and (
      current_role_name() in ('admin', 'manager')
      or id in (select location_id from employee_locations where profile_id = auth.uid())
    )
  );
create policy "locations admin insert" on locations
  for insert with check (organization_id = current_org_id() and current_role_name() = 'admin');
create policy "locations admin update" on locations
  for update using (organization_id = current_org_id() and current_role_name() = 'admin');
create policy "locations admin delete" on locations
  for delete using (organization_id = current_org_id() and current_role_name() = 'admin');

create policy "products readable in own org" on products
  for select using (organization_id = current_org_id());
create policy "products admin insert" on products
  for insert with check (organization_id = current_org_id() and current_role_name() = 'admin');
create policy "products admin update" on products
  for update using (organization_id = current_org_id() and current_role_name() = 'admin');
create policy "products admin delete" on products
  for delete using (organization_id = current_org_id() and current_role_name() = 'admin');

-- Inventory records are an audit trail: admins/managers read everything in
-- the org; employees only read submissions for their assigned location(s)
-- (same rule as the locations policy above). Only admins may edit or
-- delete a historical submission. Normal writes go through
-- submit_daily_inventory() below (SECURITY INVOKER, still subject to
-- these same policies) rather than direct inserts from the client.
create policy "inventory submissions read scoped to role" on inventory_submissions
  for select using (
    organization_id = current_org_id()
    and (
      current_role_name() in ('admin', 'manager')
      or location_id in (select location_id from employee_locations where profile_id = auth.uid())
    )
  );

create policy "inventory submissions insert in own org" on inventory_submissions
  for insert with check (organization_id = current_org_id());

create policy "inventory submissions admin update" on inventory_submissions
  for update using (
    organization_id = current_org_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "inventory submissions admin delete" on inventory_submissions
  for delete using (
    organization_id = current_org_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "inventory items read via own org submission" on inventory_items
  for select using (
    submission_id in (select id from inventory_submissions where organization_id = current_org_id())
  );

create policy "inventory items insert via own org submission" on inventory_items
  for insert with check (
    submission_id in (select id from inventory_submissions where organization_id = current_org_id())
  );

create policy "inventory items admin update" on inventory_items
  for update using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    and submission_id in (select id from inventory_submissions where organization_id = current_org_id())
  );

create policy "inventory items admin delete" on inventory_items
  for delete using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    and submission_id in (select id from inventory_submissions where organization_id = current_org_id())
  );

-- Atomic, server-validated inventory submission. The client sends only what
-- the employee entered; this function — not the browser — is the source of
-- truth for the box/piece conversion math and for both rows being written
-- together. If any item fails validation, the whole submission is rolled
-- back (Postgres functions run inside the calling transaction), so there is
-- no half-written state for a retry to collide with.
create or replace function submit_daily_inventory(p_location_id uuid, p_items jsonb, p_inventory_date date default current_date)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_org_id uuid := current_org_id();
  v_submission_id uuid;
  v_item jsonb;
  v_product products%rowtype;
  v_mode text;
  v_full_boxes numeric;
  v_pieces numeric;
  v_fraction text;
  v_normalized numeric;
  v_fraction_value numeric;
  v_breakdown jsonb;
  v_generic_result jsonb;
  v_packages_at_entry jsonb;
begin
  if v_org_id is null then
    raise exception 'No organization linked to this account';
  end if;

  if not exists (select 1 from locations where id = p_location_id and organization_id = v_org_id) then
    raise exception 'Location does not belong to your organization';
  end if;

  if current_role_name() = 'employee'
     and not exists (select 1 from employee_locations where profile_id = auth.uid() and location_id = p_location_id) then
    raise exception 'You are not assigned to this location';
  end if;

  insert into inventory_submissions (organization_id, location_id, submitted_by, inventory_date)
  values (v_org_id, p_location_id, auth.uid(), p_inventory_date)
  returning id into v_submission_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from products
      where id = (v_item->>'product_id')::uuid and organization_id = v_org_id;
    if not found then
      raise exception 'Product % does not belong to your organization', v_item->>'product_id';
    end if;

    v_mode := v_item->>'entry_mode';
    v_full_boxes := nullif(v_item->>'entered_full_boxes', '')::numeric;
    v_pieces := nullif(v_item->>'entered_pieces', '')::numeric;
    v_fraction := nullif(v_item->>'entered_fraction', '');
    v_breakdown := null;
    v_packages_at_entry := null;

    if v_mode = 'boxes_pieces' then
      v_normalized := coalesce(v_full_boxes, 0) * v_product.units_per_package + coalesce(v_pieces, 0);
    elsif v_mode = 'fraction' then
      v_fraction_value := case v_fraction
        when 'full' then 1 when '3/4' then 0.75 when '1/2' then 0.5
        when '1/3' then 1.0/3 when '1/4' then 0.25 else 0 end;
      v_normalized := round(v_product.units_per_package * v_fraction_value);
    elsif v_mode = 'pieces' then
      v_normalized := coalesce(v_pieces, 0);
    elsif v_mode = 'generic' then
      -- Multi-tier package entries (Pommes' carton/bag/kg, Stora kött's
      -- carton/piece, ...). The client's own packaging.js computes the
      -- same thing for instant preview, but ONLY this server-side
      -- resolve_generic_inventory_quantity() call is trusted — the
      -- client-sent breakdown is raw entered values, never a client-
      -- computed total, same principle as every other entry mode here.
      v_breakdown := v_item->'entered_breakdown';
      if v_breakdown is null then
        raise exception 'Missing entered_breakdown for a generic entry';
      end if;
      v_generic_result := resolve_generic_inventory_quantity(v_product.id, v_breakdown);
      v_normalized := (v_generic_result->>'normalized_quantity')::numeric;
      v_packages_at_entry := v_generic_result->'packages_at_entry';
    else
      raise exception 'Unknown entry mode %', v_mode;
    end if;

    insert into inventory_items (
      submission_id, product_id, entry_mode, entered_full_boxes, entered_pieces,
      entered_fraction, units_per_package_at_entry, normalized_quantity,
      entered_breakdown, packages_at_entry
    ) values (
      v_submission_id, v_product.id, v_mode, v_full_boxes, v_pieces,
      v_fraction, case when v_mode = 'generic' then null else v_product.units_per_package end,
      v_normalized, v_breakdown, v_packages_at_entry
    );
  end loop;

  return v_submission_id;
end;
$$;

-- Employee onboarding without direct SQL/database access. An admin
-- creates an invite (code + intended role) for their org; a new user signs
-- up with Supabase Auth (which creates their auth.users row, outside this
-- schema) and then redeems the code to get a profiles row created for
-- them. The tricky part: at redemption time the new user has NO profile
-- yet, so current_org_id() is null and none of the org-scoped RLS
-- policies would let them read anything — including the invites row
-- itself. redeem_invite() is SECURITY DEFINER specifically so it can look
-- up the invite by code (bypassing RLS) while still only ever creating a
-- profile for auth.uid() itself, never an arbitrary user — the function
-- body is the entire trust boundary here, not a table grant.
create table invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null unique,
  role text not null default 'employee' check (role in ('employee', 'manager', 'admin')),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid references profiles(id)
);
alter table invites enable row level security;

-- Only admins manage invites, and only for their own org. Deliberately no
-- policy lets a plain "select by code" happen for an unauthenticated or
-- profile-less caller — redeem_invite() below is the only path in.
create policy "admin manages invites in own org" on invites
  for all using (organization_id = current_org_id() and current_role_name() = 'admin')
  with check (organization_id = current_org_id() and current_role_name() = 'admin');

create or replace function redeem_invite(p_code text, p_full_name text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_invite invites%rowtype;
  v_org_id uuid;
begin
  if exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'This account already has a profile';
  end if;

  select * into v_invite from invites where code = p_code for update;
  if not found then
    raise exception 'Invalid invite code';
  end if;
  if v_invite.used_at is not null then
    raise exception 'This invite code has already been used';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invite code has expired';
  end if;

  insert into profiles (id, organization_id, full_name, role)
  values (auth.uid(), v_invite.organization_id, p_full_name, v_invite.role);

  update invites set used_at = now(), used_by = auth.uid() where id = v_invite.id;

  return v_invite.organization_id;
end;
$$;
-- Callable by any authenticated Supabase user, including one with no
-- profile row yet (that's the whole point) — Postgres's default grants
-- already cover this for a SECURITY DEFINER function owned by a superuser/
-- table owner, but this makes the intent explicit rather than implicit.
grant execute on function redeem_invite(text, text) to authenticated;

-- =======================================================================
-- Inventory 2.0: controlled corrections
-- =======================================================================
-- A submitted inventory count is an audit record — the earlier design
-- correctly made it admin-only to UPDATE, but gave no way to actually fix
-- a mistake ("entered 24 instead of 14") without either a raw UPDATE that
-- destroys what was originally recorded, or leaving wrong data in place
-- forever. This table + function let an admin correct a line while
-- preserving exactly what was there before, who changed it, when, and why.
create table inventory_item_corrections (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inventory_items(id) on delete cascade,
  previous_entry_mode text not null,
  previous_full_boxes numeric,
  previous_pieces numeric,
  previous_fraction text,
  previous_normalized_quantity numeric not null,
  new_entry_mode text not null,
  new_full_boxes numeric,
  new_pieces numeric,
  new_fraction text,
  new_normalized_quantity numeric not null,
  reason text,
  corrected_by uuid not null references profiles(id),
  corrected_at timestamptz not null default now()
);
alter table inventory_item_corrections enable row level security;

create policy "corrections readable via own org submission" on inventory_item_corrections
  for select using (
    item_id in (
      select ii.id from inventory_items ii
      join inventory_submissions s on s.id = ii.submission_id
      where s.organization_id = current_org_id()
    )
  );
-- Only an insert policy — no update/delete at all, so a correction log
-- entry, once written, is permanent (you correct forward with a new
-- correction row, you don't edit history). correct_inventory_item() is
-- SECURITY INVOKER (like submit_daily_inventory/submit_delivery), so this
-- policy is what actually authorizes its INSERT — the function's own role
-- check and this policy are deliberately redundant, matching this
-- schema's existing style of policies as the real boundary and function
-- bodies as a second layer, rather than reaching for SECURITY DEFINER.
create policy "admin inserts corrections in own org" on inventory_item_corrections
  for insert with check (
    current_role_name() = 'admin'
    and item_id in (
      select ii.id from inventory_items ii
      join inventory_submissions s on s.id = ii.submission_id
      where s.organization_id = current_org_id()
    )
  );

create or replace function correct_inventory_item(
  p_item_id uuid, p_entry_mode text, p_full_boxes numeric, p_pieces numeric,
  p_fraction text, p_reason text
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_item inventory_items%rowtype;
  v_org_id uuid;
  v_new_normalized numeric;
  v_fraction_value numeric;
begin
  if current_role_name() != 'admin' then
    raise exception 'Only an admin can correct a submitted inventory count';
  end if;

  select ii.* into v_item from inventory_items ii
    join inventory_submissions s on s.id = ii.submission_id
    where ii.id = p_item_id and s.organization_id = current_org_id();
  if not found then
    raise exception 'Inventory item not found in your organization';
  end if;

  -- Recompute using the package size that applied AT THE TIME of the
  -- original count (units_per_package_at_entry), never the product's
  -- current configuration — this is what keeps historical inventory
  -- interpretable even after a product's package size changes later.
  if p_entry_mode = 'boxes_pieces' then
    v_new_normalized := coalesce(p_full_boxes, 0) * v_item.units_per_package_at_entry + coalesce(p_pieces, 0);
  elsif p_entry_mode = 'fraction' then
    v_fraction_value := case p_fraction
      when 'full' then 1 when '3/4' then 0.75 when '1/2' then 0.5
      when '1/3' then 1.0/3 when '1/4' then 0.25 else 0 end;
    v_new_normalized := round(v_item.units_per_package_at_entry * v_fraction_value);
  elsif p_entry_mode = 'pieces' then
    v_new_normalized := coalesce(p_pieces, 0);
  else
    raise exception 'Unknown entry mode %', p_entry_mode;
  end if;

  insert into inventory_item_corrections (
    item_id, previous_entry_mode, previous_full_boxes, previous_pieces, previous_fraction,
    previous_normalized_quantity, new_entry_mode, new_full_boxes, new_pieces, new_fraction,
    new_normalized_quantity, reason, corrected_by
  ) values (
    v_item.id, v_item.entry_mode, v_item.entered_full_boxes, v_item.entered_pieces, v_item.entered_fraction,
    v_item.normalized_quantity, p_entry_mode, p_full_boxes, p_pieces, p_fraction,
    v_new_normalized, p_reason, auth.uid()
  );

  update inventory_items set
    entry_mode = p_entry_mode, entered_full_boxes = p_full_boxes, entered_pieces = p_pieces,
    entered_fraction = p_fraction, normalized_quantity = v_new_normalized
  where id = v_item.id;

  return v_item.id;
end;
$$;

-- =======================================================================
-- Delivery Receiving foundation (manual entry — see README "Known
-- limitations": camera capture, AI document extraction, product matching,
-- and expected-vs-received discrepancy detection are NOT implemented.
-- Building fake versions of those would mean either hard-coding a
-- pretend AI provider or fabricating "expected quantity" data that does
-- not exist yet (no purchase-order source is configured) — both
-- explicitly against this project's own rules. This lays the real,
-- usable foundation: an employee can record what a supplier actually
-- delivered, structured and atomic, ready for those capabilities to
-- attach to later without a schema rewrite.
-- =======================================================================
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table suppliers enable row level security;

create policy "suppliers readable in own org" on suppliers
  for select using (organization_id = current_org_id());
create policy "suppliers admin insert" on suppliers
  for insert with check (organization_id = current_org_id() and current_role_name() = 'admin');
create policy "suppliers admin update" on suppliers
  for update using (organization_id = current_org_id() and current_role_name() = 'admin');
create policy "suppliers admin delete" on suppliers
  for delete using (organization_id = current_org_id() and current_role_name() = 'admin');

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  received_by uuid not null references profiles(id),
  received_at timestamptz not null default now(),
  invoice_number text,
  invoice_date date,
  notes text,
  -- Path into the delivery-documents storage bucket for the photographed
  -- invoice, e.g. "<organization_id>/<random>.jpg". Null until a photo is
  -- attached — a delivery is still fully valid without one (manual entry
  -- must always work; see README "What's deliberately not built" on why
  -- there's no AI reading of this photo yet).
  document_path text
);
alter table deliveries enable row level security;

create table delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  product_id uuid not null references products(id),
  entry_mode text not null check (entry_mode in ('boxes_pieces', 'fraction', 'pieces')),
  entered_full_boxes numeric check (entered_full_boxes is null or entered_full_boxes >= 0),
  entered_pieces numeric check (entered_pieces is null or entered_pieces >= 0),
  entered_fraction text check (entered_fraction is null or entered_fraction in ('full','3/4','1/2','1/3','1/4')),
  units_per_package_at_entry integer not null check (units_per_package_at_entry > 0),
  received_quantity numeric not null check (received_quantity >= 0),
  unit_price numeric check (unit_price is null or unit_price >= 0)
);
alter table delivery_items enable row level security;

create index deliveries_org_idx on deliveries (organization_id);
create index delivery_items_delivery_idx on delivery_items (delivery_id);

-- Same read/write shape as inventory_submissions: admin/manager read
-- everything in the org, employees only their assigned location(s); any
-- org member can insert (via submit_delivery() below, not direct
-- inserts); only admin can edit/delete a recorded delivery.
create policy "deliveries read scoped to role" on deliveries
  for select using (
    organization_id = current_org_id()
    and (
      current_role_name() in ('admin', 'manager')
      or location_id in (select location_id from employee_locations where profile_id = auth.uid())
    )
  );
create policy "deliveries insert in own org" on deliveries
  for insert with check (organization_id = current_org_id());
create policy "deliveries admin update" on deliveries
  for update using (organization_id = current_org_id() and current_role_name() = 'admin');
-- Multiple UPDATE policies on the same table are OR'd together by
-- Postgres RLS: this lets the employee who recorded a delivery amend it
-- (attach/replace a photo, fix an invoice number) without needing admin
-- rights, same as they're trusted to submit it in the first place — while
-- an admin can still correct anyone's.
create policy "deliveries receiver can update own delivery" on deliveries
  for update using (organization_id = current_org_id() and received_by = auth.uid());
create policy "deliveries admin delete" on deliveries
  for delete using (organization_id = current_org_id() and current_role_name() = 'admin');

create policy "delivery items read via own org delivery" on delivery_items
  for select using (delivery_id in (select id from deliveries where organization_id = current_org_id()));
create policy "delivery items insert via own org delivery" on delivery_items
  for insert with check (delivery_id in (select id from deliveries where organization_id = current_org_id()));
create policy "delivery items admin update" on delivery_items
  for update using (
    current_role_name() = 'admin'
    and delivery_id in (select id from deliveries where organization_id = current_org_id())
  );
create policy "delivery items admin delete" on delivery_items
  for delete using (
    current_role_name() = 'admin'
    and delivery_id in (select id from deliveries where organization_id = current_org_id())
  );

-- Atomic delivery submission, mirroring submit_daily_inventory(): server
-- recomputes received_quantity from the raw entered values (never trusts
-- a client-supplied total), validates the location/supplier/products
-- belong to the caller's own org, enforces the same employee-location
-- scoping, and writes the delivery + all items in one transaction.
create or replace function submit_delivery(
  p_location_id uuid, p_supplier_id uuid, p_invoice_number text,
  p_invoice_date date, p_notes text, p_items jsonb, p_document_path text default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_org_id uuid := current_org_id();
  v_delivery_id uuid;
  v_item jsonb;
  v_product products%rowtype;
  v_mode text;
  v_full_boxes numeric;
  v_pieces numeric;
  v_fraction text;
  v_unit_price numeric;
  v_received numeric;
  v_fraction_value numeric;
begin
  if v_org_id is null then
    raise exception 'No organization linked to this account';
  end if;

  if not exists (select 1 from locations where id = p_location_id and organization_id = v_org_id) then
    raise exception 'Location does not belong to your organization';
  end if;

  if current_role_name() = 'employee'
     and not exists (select 1 from employee_locations where profile_id = auth.uid() and location_id = p_location_id) then
    raise exception 'You are not assigned to this location';
  end if;

  if not exists (select 1 from suppliers where id = p_supplier_id and organization_id = v_org_id) then
    raise exception 'Supplier does not belong to your organization';
  end if;

  -- The document, if any, was already uploaded to storage before this
  -- call (the upload itself needs no delivery id — see delivery.js) so it
  -- can be linked in the same insert as everything else, atomically.
  insert into deliveries (organization_id, location_id, supplier_id, received_by, invoice_number, invoice_date, notes, document_path)
  values (v_org_id, p_location_id, p_supplier_id, auth.uid(), p_invoice_number, p_invoice_date, p_notes, p_document_path)
  returning id into v_delivery_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from products
      where id = (v_item->>'product_id')::uuid and organization_id = v_org_id;
    if not found then
      raise exception 'Product % does not belong to your organization', v_item->>'product_id';
    end if;

    v_mode := v_item->>'entry_mode';
    v_full_boxes := nullif(v_item->>'entered_full_boxes', '')::numeric;
    v_pieces := nullif(v_item->>'entered_pieces', '')::numeric;
    v_fraction := nullif(v_item->>'entered_fraction', '');
    v_unit_price := nullif(v_item->>'unit_price', '')::numeric;

    if v_mode = 'boxes_pieces' then
      v_received := coalesce(v_full_boxes, 0) * v_product.units_per_package + coalesce(v_pieces, 0);
    elsif v_mode = 'fraction' then
      v_fraction_value := case v_fraction
        when 'full' then 1 when '3/4' then 0.75 when '1/2' then 0.5
        when '1/3' then 1.0/3 when '1/4' then 0.25 else 0 end;
      v_received := round(v_product.units_per_package * v_fraction_value);
    elsif v_mode = 'pieces' then
      v_received := coalesce(v_pieces, 0);
    else
      raise exception 'Unknown entry mode %', v_mode;
    end if;

    insert into delivery_items (
      delivery_id, product_id, entry_mode, entered_full_boxes, entered_pieces,
      entered_fraction, units_per_package_at_entry, received_quantity, unit_price
    ) values (
      v_delivery_id, v_product.id, v_mode, v_full_boxes, v_pieces,
      v_fraction, v_product.units_per_package, v_received, v_unit_price
    );
  end loop;

  return v_delivery_id;
end;
$$;

-- Attach or replace the photographed invoice on an EXISTING delivery
-- (e.g. the employee forgot to add it at submit time, or a retake is
-- needed). Goes through the same organization check as everything else,
-- plus the "receiver or admin" rule the deliveries UPDATE policies above
-- already enforce — this function re-checks it explicitly so the error
-- message is specific rather than a generic RLS denial.
create or replace function attach_delivery_document(p_delivery_id uuid, p_path text)
returns void
language plpgsql
security invoker
as $$
declare
  v_delivery deliveries%rowtype;
begin
  select * into v_delivery from deliveries where id = p_delivery_id and organization_id = current_org_id();
  if not found then
    raise exception 'Delivery not found in your organization';
  end if;
  if v_delivery.received_by != auth.uid() and current_role_name() != 'admin' then
    raise exception 'Only the employee who recorded this delivery, or an admin, can attach a document to it';
  end if;
  update deliveries set document_path = p_path where id = p_delivery_id;
end;
$$;

-- =======================================================================
-- Delivery document storage (Supabase Storage bucket + access policies).
-- Private bucket — not public — so a document is only reachable through
-- an authenticated, authorized request; access is controlled the same
-- way as every other table here, via RLS on storage.objects. Files are
-- uploaded to "<organization_id>/<random-name>.<ext>", and the policies
-- below check that the first path segment matches the caller's own
-- organization — a user cannot read or write into another org's folder
-- even if they somehow learn or guess a path.
-- =======================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-documents', 'delivery-documents', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "org members read own org delivery documents"
on storage.objects for select
using (
  bucket_id = 'delivery-documents'
  and (storage.foldername(name))[1] = current_org_id()::text
);

create policy "org members upload to own org delivery documents"
on storage.objects for insert
with check (
  bucket_id = 'delivery-documents'
  and (storage.foldername(name))[1] = current_org_id()::text
);

create policy "org members delete own org delivery documents"
on storage.objects for delete
using (
  bucket_id = 'delivery-documents'
  and (storage.foldername(name))[1] = current_org_id()::text
);

-- =======================================================================
-- Package/unit configuration — generic conversion engine.
--
-- Products previously supported exactly ONE flat package size
-- (package_unit/units_per_package on the products row itself). Real
-- products need more: multiple nested package tiers (Pommes: carton -> 5
-- bags -> 2.5 kg each), base units other than "piece" (kg, and cans
-- tracked with an informational ml size), and products where the piece
-- count inside a package is genuinely NOT known (Nuggets: bag = 1 kg is
-- confirmed, pieces-per-bag is not) — the system must not invent that
-- number.
--
-- This is purely additive: every new column is nullable or has a safe
-- default, package_unit/units_per_package are untouched, and any product
-- with zero rows in product_packages behaves exactly as it did before —
-- the client (app.js) falls back to the original single-tier entry UI
-- for those, so existing products and existing inventory history are
-- completely unaffected.
-- =======================================================================
alter table products add column if not exists base_unit text not null default 'piece' check (base_unit in ('piece', 'kg', 'ml'));
-- Purely a display string (e.g. "slice", "can", "patty") for a product
-- whose base_unit is semantically 'piece' but has a more specific name
-- in the UI. Never used by the conversion engine — base_unit alone
-- decides count-vs-weight-vs-volume math. Falls back to base_unit itself
-- when not set.
alter table products add column if not exists base_unit_label text;
alter table products add column if not exists unit_weight_g numeric check (unit_weight_g is null or unit_weight_g > 0);
alter table products add column if not exists unit_volume_ml numeric check (unit_volume_ml is null or unit_volume_ml > 0);
-- Informational only (e.g. Ost cheddar: "1 kg" per outermost package) —
-- never participates in the conversion engine's math, which always works
-- in whatever base_unit + package tiers are actually configured.
alter table products add column if not exists net_weight_kg numeric check (net_weight_kg is null or net_weight_kg > 0);
-- True only for products where an employee may jot down an approximate,
-- informational piece count that must NEVER be treated as a real
-- conversion (Nuggets, Chili cheese) — see resolve_generic_inventory_quantity()
-- below, which explicitly ignores the reserved "_note_pieces" key.
alter table products add column if not exists open_piece_notes boolean not null default false;

-- Ordered package tiers for one product. sort_order 1 is the OUTERMOST
-- package (what an employee would say first, e.g. "carton"). Each tier's
-- `contains` is how many of `unit` are inside ONE of this tier, and
-- `unit` is either another tier's `name` (nesting one level in) or the
-- product's base_unit (bottoming out). Example, Pommes (base_unit 'kg'):
--   (sort_order 1, name 'carton', contains 5,   unit 'bag')
--   (sort_order 2, name 'bag',    contains 2.5, unit 'kg')
create table if not exists product_packages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sort_order integer not null check (sort_order > 0),
  name text not null,
  contains numeric not null check (contains > 0),
  unit text not null,
  unique (product_id, sort_order),
  unique (product_id, name)
);
create index if not exists product_packages_product_idx on product_packages (product_id);
alter table product_packages enable row level security;

-- drop-then-create makes this block safe to paste and run more than
-- once (e.g. by accident) — "create policy" alone has no "if not
-- exists" in Postgres, and erroring on a duplicate policy name would
-- abort the whole pasted script as one transaction, rolling back
-- everything else in it too. This changes nothing about who can do
-- what; it only makes re-running a no-op instead of an error.
drop policy if exists "product packages readable in own org" on product_packages;
create policy "product packages readable in own org" on product_packages
  for select using (product_id in (select id from products where organization_id = current_org_id()));
drop policy if exists "product packages admin insert" on product_packages;
create policy "product packages admin insert" on product_packages
  for insert with check (
    current_role_name() = 'admin'
    and product_id in (select id from products where organization_id = current_org_id())
  );
drop policy if exists "product packages admin update" on product_packages;
create policy "product packages admin update" on product_packages
  for update using (
    current_role_name() = 'admin'
    and product_id in (select id from products where organization_id = current_org_id())
  );
drop policy if exists "product packages admin delete" on product_packages;
create policy "product packages admin delete" on product_packages
  for delete using (
    current_role_name() = 'admin'
    and product_id in (select id from products where organization_id = current_org_id())
  );

-- FUTURE — scaffolding only, no rows inserted, no application code reads
-- from this yet. The exact external system (Oracle or otherwise) is NOT
-- confirmed, so nothing here assumes a specific product/API. When a real
-- mapping is confirmed, it is recorded here (e.g. Bacon: internal 'kg' ->
-- external 'Oracle', unit '500 g', factor 2) WITHOUT touching the
-- internal product_packages configuration above — the internal model and
-- any external integration stay fully separate.
create table if not exists product_external_mappings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  external_system text not null,
  external_unit text not null,
  conversion_factor numeric not null check (conversion_factor > 0),
  notes text,
  created_at timestamptz not null default now()
);
alter table product_external_mappings enable row level security;
drop policy if exists "external mappings admin only" on product_external_mappings;
create policy "external mappings admin only" on product_external_mappings
  for all using (
    current_role_name() = 'admin'
    and product_id in (select id from products where organization_id = current_org_id())
  ) with check (
    current_role_name() = 'admin'
    and product_id in (select id from products where organization_id = current_org_id())
  );

-- Extend inventory_items for the new generic entry path alongside the
-- original boxes_pieces/fraction/pieces modes (untouched, still used by
-- any product without package tiers configured).
alter table inventory_items drop constraint if exists inventory_items_entry_mode_check;
alter table inventory_items add constraint inventory_items_entry_mode_check
  check (entry_mode in ('boxes_pieces', 'fraction', 'pieces', 'generic'));
-- Only meaningful for the original single-tier modes; a generic entry's
-- audit trail lives in packages_at_entry instead (below).
alter table inventory_items alter column units_per_package_at_entry drop not null;
-- Exactly what the employee typed, e.g. {"carton": 2, "bag": 3} or
-- {"kg": 12.5}, optionally plus a "_note_pieces" informational count.
alter table inventory_items add column if not exists entered_breakdown jsonb;
-- Snapshot of the package tiers actually used to compute normalized_quantity
-- at submission time — same auditability principle as
-- units_per_package_at_entry: a later change to a product's package
-- configuration must never silently reinterpret historical records.
alter table inventory_items add column if not exists packages_at_entry jsonb;

-- Deterministic, server-side, generic conversion. Walks a product's
-- package chain from whatever unit the employee entered down to the
-- product's base_unit, exactly mirroring packaging.js's client-side
-- preview — except this is the one that is actually trusted; the client
-- never gets to assert its own total for a generic entry. Products with
-- no matching package tier for an entered unit raise an exception rather
-- than guessing a conversion (this is what makes "Nuggets bag->piece has
-- no invented conversion" a property of the data, not a special case in
-- code).
create or replace function resolve_generic_inventory_quantity(p_product_id uuid, p_breakdown jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_product products%rowtype;
  v_key text;
  v_qty numeric;
  v_unit text;
  v_multiplier numeric;
  v_total numeric := 0;
  v_pkg product_packages%rowtype;
  v_hops integer;
  v_snapshot jsonb := '[]'::jsonb;
begin
  select * into v_product from products where id = p_product_id;
  if not found then
    raise exception 'Unknown product %', p_product_id;
  end if;

  for v_key in select jsonb_object_keys(p_breakdown) loop
    if v_key = '_note_pieces' then
      continue; -- informational only, never converted or added to the total
    end if;
    v_qty := nullif(p_breakdown->>v_key, '')::numeric;
    if v_qty is null or v_qty <= 0 then
      continue;
    end if;

    v_unit := v_key;
    v_multiplier := 1;
    v_hops := 0;
    while v_unit <> v_product.base_unit loop
      v_hops := v_hops + 1;
      if v_hops > 6 then
        raise exception 'Product % package configuration is too deep or malformed', v_product.name;
      end if;
      select * into v_pkg from product_packages where product_id = p_product_id and name = v_unit;
      if not found then
        raise exception 'Product % has no package tier named "%" (and it is not the base unit "%")',
          v_product.name, v_unit, v_product.base_unit;
      end if;
      v_multiplier := v_multiplier * v_pkg.contains;
      v_snapshot := v_snapshot || jsonb_build_object('name', v_pkg.name, 'contains', v_pkg.contains, 'unit', v_pkg.unit);
      v_unit := v_pkg.unit;
    end loop;
    v_total := v_total + v_qty * v_multiplier;
  end loop;

  return jsonb_build_object('normalized_quantity', v_total, 'packages_at_entry', v_snapshot);
end;
$$;

-- =======================================================================
-- Delivery Receiving: generic conversion parity + invoice-matching audit
-- trail (mock OCR provider for now — see app.js's ocrProvider). Additive
-- only: every new column is nullable or defaulted, existing delivery
-- records and the manual entry_mode path are completely unaffected.
-- =======================================================================
alter table delivery_items drop constraint if exists delivery_items_entry_mode_check;
alter table delivery_items add constraint delivery_items_entry_mode_check
  check (entry_mode in ('boxes_pieces', 'fraction', 'pieces', 'generic'));
alter table delivery_items alter column units_per_package_at_entry drop not null;
alter table delivery_items add column if not exists entered_breakdown jsonb;
alter table delivery_items add column if not exists packages_at_entry jsonb;

-- Preserves the invoice's own line order — the receiving workflow steps
-- through lines in this order, never alphabetically or by category.
alter table delivery_items add column if not exists invoice_line_order integer;
-- What the (currently mocked) extraction stage read for this line, kept
-- distinct from received_quantity (what the employee actually confirmed)
-- forever — correcting a misread invoice line must never erase what the
-- extraction stage originally produced.
alter table delivery_items add column if not exists extracted_text text;
alter table delivery_items add column if not exists extracted_quantity numeric check (extracted_quantity is null or extracted_quantity >= 0);
alter table delivery_items add column if not exists match_confidence text check (match_confidence is null or match_confidence in ('high', 'medium', 'low', 'none'));
-- true when extraction/matching could not confidently resolve this line
-- to one of the existing catalog products — the employee must pick the
-- correct product themselves; nothing here ever creates a new product.
alter table delivery_items add column if not exists needs_review boolean not null default false;

-- Distinguishes a delivery entered fully manually (the only path that
-- existed before this phase) from one that went through the (currently
-- mocked) extraction workflow — never conflate "confirmed internally"
-- with "synchronized to an external system", since no such integration
-- exists yet (see README/report: this is explicitly NOT connected to any
-- real OCR or Oracle integration).
alter table deliveries add column if not exists extraction_source text not null default 'manual' check (extraction_source in ('manual', 'mock_ocr'));

create or replace function submit_delivery(
  p_location_id uuid, p_supplier_id uuid, p_invoice_number text,
  p_invoice_date date, p_notes text, p_items jsonb, p_document_path text default null,
  p_extraction_source text default 'manual'
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_org_id uuid := current_org_id();
  v_delivery_id uuid;
  v_item jsonb;
  v_product products%rowtype;
  v_mode text;
  v_full_boxes numeric;
  v_pieces numeric;
  v_fraction text;
  v_unit_price numeric;
  v_received numeric;
  v_fraction_value numeric;
  v_breakdown jsonb;
  v_generic_result jsonb;
  v_packages_at_entry jsonb;
begin
  if v_org_id is null then
    raise exception 'No organization linked to this account';
  end if;

  if not exists (select 1 from locations where id = p_location_id and organization_id = v_org_id) then
    raise exception 'Location does not belong to your organization';
  end if;

  if current_role_name() = 'employee'
     and not exists (select 1 from employee_locations where profile_id = auth.uid() and location_id = p_location_id) then
    raise exception 'You are not assigned to this location';
  end if;

  if not exists (select 1 from suppliers where id = p_supplier_id and organization_id = v_org_id) then
    raise exception 'Supplier does not belong to your organization';
  end if;

  insert into deliveries (organization_id, location_id, supplier_id, received_by, invoice_number, invoice_date, notes, document_path, extraction_source)
  values (v_org_id, p_location_id, p_supplier_id, auth.uid(), p_invoice_number, p_invoice_date, p_notes, p_document_path, p_extraction_source)
  returning id into v_delivery_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from products
      where id = (v_item->>'product_id')::uuid and organization_id = v_org_id;
    if not found then
      raise exception 'Product % does not belong to your organization', v_item->>'product_id';
    end if;

    v_mode := v_item->>'entry_mode';
    v_full_boxes := nullif(v_item->>'entered_full_boxes', '')::numeric;
    v_pieces := nullif(v_item->>'entered_pieces', '')::numeric;
    v_fraction := nullif(v_item->>'entered_fraction', '');
    v_unit_price := nullif(v_item->>'unit_price', '')::numeric;
    v_breakdown := null;
    v_packages_at_entry := null;

    if v_mode = 'boxes_pieces' then
      v_received := coalesce(v_full_boxes, 0) * v_product.units_per_package + coalesce(v_pieces, 0);
    elsif v_mode = 'fraction' then
      v_fraction_value := case v_fraction
        when 'full' then 1 when '3/4' then 0.75 when '1/2' then 0.5
        when '1/3' then 1.0/3 when '1/4' then 0.25 else 0 end;
      v_received := round(v_product.units_per_package * v_fraction_value);
    elsif v_mode = 'pieces' then
      v_received := coalesce(v_pieces, 0);
    elsif v_mode = 'generic' then
      v_breakdown := v_item->'entered_breakdown';
      if v_breakdown is null then
        raise exception 'Missing entered_breakdown for a generic entry';
      end if;
      v_generic_result := resolve_generic_inventory_quantity(v_product.id, v_breakdown);
      v_received := (v_generic_result->>'normalized_quantity')::numeric;
      v_packages_at_entry := v_generic_result->'packages_at_entry';
    else
      raise exception 'Unknown entry mode %', v_mode;
    end if;

    insert into delivery_items (
      delivery_id, product_id, entry_mode, entered_full_boxes, entered_pieces,
      entered_fraction, units_per_package_at_entry, received_quantity, unit_price,
      entered_breakdown, packages_at_entry, invoice_line_order, extracted_text,
      extracted_quantity, match_confidence, needs_review
    ) values (
      v_delivery_id, v_product.id, v_mode, v_full_boxes, v_pieces,
      v_fraction, case when v_mode = 'generic' then null else v_product.units_per_package end,
      v_received, v_unit_price,
      v_breakdown, v_packages_at_entry, nullif(v_item->>'invoice_line_order', '')::integer,
      v_item->>'extracted_text', nullif(v_item->>'extracted_quantity', '')::numeric,
      v_item->>'match_confidence', coalesce((v_item->>'needs_review')::boolean, false)
    );
  end loop;

  return v_delivery_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Demo seed data. Safe to run once. Create the two demo logins afterwards
-- in Supabase Auth (see README), then insert their profiles below.
-- ---------------------------------------------------------------------
insert into organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Demo Restaurant Group');

insert into locations (organization_id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Downtown'),
  ('00000000-0000-0000-0000-000000000001', 'Airport Road'),
  ('00000000-0000-0000-0000-000000000001', 'Mall Branch');

insert into products (organization_id, name, category, package_unit, units_per_package) values
  ('00000000-0000-0000-0000-000000000001', 'Big Meat', 'Meat', 'box', 24),
  ('00000000-0000-0000-0000-000000000001', 'Small Meat', 'Meat', 'box', 60),
  ('00000000-0000-0000-0000-000000000001', 'Cheese Slices', 'Cheese', 'box', 100),
  ('00000000-0000-0000-0000-000000000001', 'Burger Buns', 'Bread', 'box', 48),
  ('00000000-0000-0000-0000-000000000001', 'Lettuce', 'Vegetables', 'box', 12),
  ('00000000-0000-0000-0000-000000000001', 'Tomatoes', 'Vegetables', 'box', 20),
  ('00000000-0000-0000-0000-000000000001', 'Ketchup Sachets', 'Sauces', 'box', 200),
  ('00000000-0000-0000-0000-000000000001', 'Cola Cans', 'Drinks', 'box', 24),
  ('00000000-0000-0000-0000-000000000001', 'Fry Boxes', 'Packaging', 'box', 250),
  ('00000000-0000-0000-0000-000000000001', 'Frozen Fries', 'Frozen', 'box', 10);

-- After creating a user in Supabase Auth (email/password), link them to
-- the demo org by running, with their real auth.users.id:
-- insert into profiles (id, organization_id, full_name, role)
-- values ('<auth-user-uuid>', '00000000-0000-0000-0000-000000000001', 'Demo Employee', 'employee');
