-- Package/unit configuration for the product catalog specified in this
-- phase. CONFIGURATION ONLY — no current stock/inventory counts are
-- inserted here, only package sizes and conversion factors, per this
-- phase's explicit instruction.
--
-- Run this in your Supabase SQL editor AFTER schema.sql's new sections
-- (product_packages, product_external_mappings, the new products
-- columns, resolve_generic_inventory_quantity, and the updated
-- submit_daily_inventory) have been applied.
--
-- Targets YOUR organization automatically by looking it up from your own
-- profile (shalatiea@gmail.com) — never touches any other organization.
-- Safe to re-run: a product with the same name already in your org gets
-- its config updated and its package tiers replaced, not duplicated.
--
-- Unknown values were deliberately left unset rather than guessed:
--   - Nuggets: pieces-per-bag is NOT configured (only bag = 1 kg is
--     known) — open_piece_notes lets an employee jot an approximate
--     count without the system inventing a conversion.
--   - Chili cheese: same — kg only, no piece conversion.
--   - Ost cheddar's package/block/slice hierarchy IS fully specified
--     (4 blocks x 22 slices = 88 slices, 1 kg total), so it's configured.

do $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id
  from profiles p join auth.users u on u.id = p.id
  where u.email = 'shalatiea@gmail.com';

  if v_org_id is null then
    raise exception 'Could not find an organization for shalatiea@gmail.com — check the email matches your Supabase Auth account.';
  end if;

  create temporary table _pkg_products (
    name text, category text, base_unit text, base_unit_label text,
    unit_weight_g numeric, unit_volume_ml numeric, net_weight_kg numeric,
    open_piece_notes boolean
  ) on commit drop;
  create temporary table _pkg_tiers (
    product_name text, sort_order int, tier_name text, contains numeric, unit text
  ) on commit drop;

  insert into _pkg_products (name, category, base_unit, base_unit_label, unit_weight_g, unit_volume_ml, net_weight_kg, open_piece_notes) values
    ('Monster Energy',                'Drinks', 'piece', 'can',   null, 500,  null, false),
    ('Monster Ultra',                 'Drinks', 'piece', 'can',   null, 500,  null, false),
    ('Monster Mango',                 'Drinks', 'piece', 'can',   null, 500,  null, false),
    ('Bacon',                         'Meat',   'kg',    null,    null, null, null, false),
    ('Stora kött',                    'Meat',   'piece', 'patty', 114,  null, null, false),
    ('Small kött',                    'Meat',   'piece', 'patty', 45,   null, null, false),
    ('Kycklingburgare crispy',        'Meat',   'piece', null,    null, null, null, false),
    ('Vegoburgare crispy nochick O',  'Meat',   'piece', null,    null, null, null, false),
    ('Stora bröd',                    'Bread',  'piece', 'bun',   null, null, null, false),
    ('Small bröd',                    'Bread',  'piece', 'bun',   null, null, null, false),
    ('Potatis bröd',                  'Bread',  'piece', 'bun',   null, null, null, false),
    ('Glutenfri',                     'Bread',  'piece', 'bun',   null, null, null, false),
    ('Pommes',                        'Frozen', 'kg',    null,    null, null, null, false),
    ('Nuggets',                       'Frozen', 'kg',    null,    null, null, null, true),
    ('Chili cheese',                  'Frozen', 'kg',    null,    null, null, null, true),
    ('Ost cheddar',                   'Cheese', 'piece', 'slice', null, null, 1,    false),
    ('Grillost',                      'Cheese', 'piece', null,    null, null, null, false);

  insert into _pkg_tiers (product_name, sort_order, tier_name, contains, unit) values
    ('Monster Energy',               1, 'carton', 24,  'piece'),
    ('Monster Ultra',                1, 'carton', 24,  'piece'),
    ('Monster Mango',                1, 'carton', 24,  'piece'),
    ('Stora kött',                   1, 'carton', 24,  'piece'),
    ('Small kött',                   1, 'carton', 60,  'piece'),
    ('Kycklingburgare crispy',       1, 'bag',    25,  'piece'),
    ('Vegoburgare crispy nochick O', 1, 'bag',    24,  'piece'),
    ('Stora bröd',                   1, 'carton', 42,  'piece'),
    ('Small bröd',                   1, 'carton', 48,  'piece'),
    ('Potatis bröd',                 1, 'carton', 40,  'piece'),
    ('Glutenfri',                    1, 'bag',    4,   'piece'),
    ('Pommes',                       1, 'carton', 5,   'bag'),
    ('Pommes',                       2, 'bag',    2.5, 'kg'),
    ('Nuggets',                      1, 'bag',    1,   'kg'),
    ('Ost cheddar',                  1, 'package',4,   'block'),
    ('Ost cheddar',                  2, 'block',  22,  'piece'),
    ('Grillost',                     1, 'box',    16,  'piece');
    -- Bacon and Chili cheese intentionally have NO tiers: base_unit (kg)
    -- is entered directly, exactly as specified.

  -- Insert only the products that don't already exist by name in this org.
  insert into products (organization_id, name, category, package_unit, units_per_package, base_unit, base_unit_label, unit_weight_g, unit_volume_ml, net_weight_kg, open_piece_notes)
  select v_org_id, pp.name, pp.category, 'unit', 1, pp.base_unit, pp.base_unit_label, pp.unit_weight_g, pp.unit_volume_ml, pp.net_weight_kg, pp.open_piece_notes
  from _pkg_products pp
  where not exists (select 1 from products p where p.organization_id = v_org_id and p.name = pp.name);

  -- Update config on every matching product (covers ones that already existed).
  update products p set
    category = pp.category, base_unit = pp.base_unit, base_unit_label = pp.base_unit_label,
    unit_weight_g = pp.unit_weight_g, unit_volume_ml = pp.unit_volume_ml,
    net_weight_kg = pp.net_weight_kg, open_piece_notes = pp.open_piece_notes
  from _pkg_products pp
  where p.organization_id = v_org_id and p.name = pp.name;

  -- Replace package tiers for these products (safe to re-run).
  delete from product_packages
  where product_id in (select id from products where organization_id = v_org_id and name in (select name from _pkg_products));

  insert into product_packages (product_id, sort_order, name, contains, unit)
  select p.id, t.sort_order, t.tier_name, t.contains, t.unit
  from _pkg_tiers t
  join products p on p.organization_id = v_org_id and p.name = t.product_name;

end $$;
