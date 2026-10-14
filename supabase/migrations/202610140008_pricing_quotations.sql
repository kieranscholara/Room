-- Explicit retailer pricing and immutable, tenant-scoped issued quotations.
-- Monetary calculations come only from the trusted server pricing engine. SQL
-- repeats permissions, source freshness, line identities and conservation checks.
-- Availability is observed at issue time; this is not an inventory reservation.
create table public.retailer_pricing_policies (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  revision integer not null check (revision > 0),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.retailer_pricing_revisions (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  revision integer not null check (revision > 0),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (organisation_id, revision)
);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null,
  scene_id uuid not null,
  scene_version integer not null check (scene_version >= 0),
  policy_revision integer not null check (policy_revision > 0),
  number text not null,
  issued_by uuid not null references auth.users(id),
  issued_at timestamptz not null default now(),
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  unique (project_id, idempotency_key),
  unique (organisation_id, number),
  foreign key (project_id, organisation_id) references public.projects(id, organisation_id) on delete cascade,
  foreign key (scene_id, organisation_id) references public.scenes(id, organisation_id) on delete cascade,
  foreign key (scene_id, scene_version) references public.scene_versions(scene_id, version),
  foreign key (organisation_id, policy_revision) references public.retailer_pricing_revisions(organisation_id, revision)
);
create index quotations_project_issued on public.quotations(project_id, issued_at desc, id);

create function public.reject_quotation_mutation() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Issued quotations and pricing revisions are immutable' using errcode = '23514';
end $$;
create trigger quotations_immutable before update on public.quotations for each row execute function public.reject_quotation_mutation();
create trigger pricing_revisions_immutable before update on public.retailer_pricing_revisions for each row execute function public.reject_quotation_mutation();

alter table public.retailer_pricing_policies enable row level security;
alter table public.retailer_pricing_revisions enable row level security;
alter table public.quotations enable row level security;
create policy pricing_policies_read on public.retailer_pricing_policies for select to authenticated using (public.is_staff(organisation_id));
create policy pricing_revisions_read on public.retailer_pricing_revisions for select to authenticated using (public.is_staff(organisation_id));
create policy quotations_read on public.quotations for select to authenticated using (public.can_access_project(project_id));

create function public.set_retailer_pricing_policy(p_org_id uuid, p_actor_id uuid, p_expected_revision integer, p_policy jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org public.organisations; v_current public.retailer_pricing_policies; v_revision integer;
begin
  select * into v_org from public.organisations where id = p_org_id for update;
  if not found then raise exception 'Organisation not found' using errcode = 'P0002'; end if;
  if p_actor_id is null or not exists (select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501';
  end if;
  select * into v_current from public.retailer_pricing_policies where organisation_id = p_org_id;
  if p_expected_revision is null or p_expected_revision < 0 or coalesce(v_current.revision, 0) <> p_expected_revision then
    raise exception 'Pricing policy revision changed; reload the policy' using errcode = '40001';
  end if;
  if jsonb_typeof(p_policy) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_policy)) <> 9
    or p_policy ->> 'version' is distinct from '1' or p_policy ->> 'currency' is distinct from v_org.currency
    or coalesce(p_policy ->> 'taxMode', '') not in ('inclusive', 'exclusive') or coalesce(p_policy ->> 'rounding', '') not in ('per_line', 'invoice')
    or jsonb_typeof(p_policy -> 'feesTaxable') is distinct from 'boolean'
    or coalesce(p_policy ->> 'taxRateBps', '') !~ '^\d+$' or (p_policy ->> 'taxRateBps')::numeric not between 0 and 10000
    or coalesce(p_policy ->> 'discountBps', '') !~ '^\d+$' or (p_policy ->> 'discountBps')::numeric not between 0 and 10000
    or coalesce(p_policy ->> 'deliveryMinor', '') !~ '^\d+$' or (p_policy ->> 'deliveryMinor')::numeric not between 0 and 9007199254740991
    or coalesce(p_policy ->> 'installationMinor', '') !~ '^\d+$' or (p_policy ->> 'installationMinor')::numeric not between 0 and 9007199254740991 then
    raise exception 'Explicit supported retailer pricing policy required' using errcode = '23514';
  end if;
  v_revision := coalesce(v_current.revision, 0) + 1;
  insert into public.retailer_pricing_revisions(organisation_id, revision, policy, created_by) values(p_org_id, v_revision, p_policy, p_actor_id);
  insert into public.retailer_pricing_policies(organisation_id, revision, policy, updated_by) values(p_org_id, v_revision, p_policy, p_actor_id)
    on conflict(organisation_id) do update set revision = excluded.revision, policy = excluded.policy, updated_by = excluded.updated_by, updated_at = now()
    returning * into v_current;
  return jsonb_build_object('revision', v_current.revision, 'policy', v_current.policy, 'updatedAt', v_current.updated_at);
end $$;

-- The source includes all commercially relevant catalogue values and revisions.
-- It is returned only to a server acting for current staff. Customer reads use
-- immutable issued snapshots, never the private catalogue or customer directory.
create function public.quotation_source(p_project_id uuid, p_actor_id uuid, p_expected_scene_version integer, p_expected_policy_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_project public.projects; v_org public.organisations; v_scene public.scenes; v_policy public.retailer_pricing_policies;
  v_customer public.customers; v_object jsonb; v_variant record; v_items jsonb;
begin
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  select * into v_org from public.organisations where id = v_project.organisation_id for update;
  if p_actor_id is null or not exists(select 1 from public.organisation_members where organisation_id = v_project.organisation_id and user_id = p_actor_id and role in ('owner', 'admin', 'salesperson', 'designer')) then
    raise exception 'Staff membership required to price or issue quotations' using errcode = '42501';
  end if;
  select * into v_project from public.projects where id = p_project_id for update;
  select * into v_scene from public.scenes where project_id = p_project_id for update;
  if not found then raise exception 'Project scene not found' using errcode = 'P0002'; end if;
  if v_scene.version is distinct from p_expected_scene_version then raise exception 'Scene version changed; review the current scene' using errcode = '40001'; end if;
  select * into v_policy from public.retailer_pricing_policies where organisation_id = v_project.organisation_id;
  if not found then raise exception 'Configure the retailer pricing policy before quoting' using errcode = '23514'; end if;
  if v_policy.revision is distinct from p_expected_policy_revision then raise exception 'Pricing policy changed; preview the quotation again' using errcode = '40001'; end if;
  if v_policy.policy ->> 'currency' is distinct from v_project.currency then raise exception 'Project and retailer pricing currencies must match' using errcode = '23514'; end if;
  if v_scene.data #>> '{room,measurementsConfirmed}' is distinct from 'true' or jsonb_array_length(v_scene.data -> 'objects') = 0 then
    raise exception 'A measured scene containing real catalogue items is required' using errcode = '23514';
  end if;
  if v_project.customer_id is not null then select * into v_customer from public.customers where id = v_project.customer_id and organisation_id = v_project.organisation_id for share; end if;
  for v_object in select value from jsonb_array_elements(v_scene.data -> 'objects') loop
    select v.*, p.name as product_name, p.category as product_category, p.currency as product_currency,
      p.active as product_active, p.availability as product_availability into v_variant
      from public.product_variants v join public.products p on p.id = v.product_id and p.organisation_id = v.organisation_id
      where v.id::text = v_object ->> 'variantId' and v.organisation_id = v_project.organisation_id;
    if not found or not v_variant.active or not v_variant.product_active
      or v_variant.availability = 'out_of_stock' or v_variant.product_availability = 'out_of_stock'
      or v_variant.product_currency is distinct from v_project.currency
      or v_object ->> 'sku' is distinct from v_variant.sku or v_object ->> 'name' is distinct from v_variant.product_name
      or v_object ->> 'category' is distinct from v_variant.product_category or v_object ->> 'color' is distinct from v_variant.color
      or (v_object ->> 'solid')::boolean is distinct from (v_variant.product_category <> 'rug')
      or (v_object #>> '{dimensions,width}')::numeric is distinct from v_variant.width_m
      or (v_object #>> '{dimensions,depth}')::numeric is distinct from v_variant.depth_m
      or (v_object #>> '{dimensions,height}')::numeric is distinct from v_variant.height_m then
      raise exception 'A scene item is missing, unavailable or differs from its current catalogue variant' using errcode = '40001';
    end if;
  end loop;
  with counts as (
    select value ->> 'variantId' as variant_id, count(*)::integer as quantity,
      jsonb_agg(value ->> 'id' order by value ->> 'id') as object_ids
      from jsonb_array_elements(v_scene.data -> 'objects') group by value ->> 'variantId'
  )
  select jsonb_agg(jsonb_build_object('variantId', v.id, 'productId', p.id, 'objectIds', c.object_ids,
    'sku', v.sku, 'name', p.name, 'variantName', v.name, 'category', p.category, 'quantity', c.quantity,
    'unitPriceMinor', v.price_minor, 'currency', p.currency,
    'dimensions', jsonb_build_object('width', v.width_m, 'depth', v.depth_m, 'height', v.height_m),
    'color', v.color, 'material', v.material, 'availability', v.availability, 'stockQuantity', v.stock_quantity,
    'leadTimeDays', v.lead_time_days, 'variantUpdatedAt', v.updated_at, 'productUpdatedAt', p.updated_at) order by v.id)
    into v_items from counts c join public.product_variants v on v.id::text = c.variant_id and v.organisation_id = v_project.organisation_id
      join public.products p on p.id = v.product_id and p.organisation_id = v.organisation_id;
  if exists(select 1 from jsonb_array_elements(v_items) item where item ->> 'availability' = 'in_stock' and (item ->> 'quantity')::integer > (item ->> 'stockQuantity')::integer) then
    raise exception 'Requested quantities exceed current variant stock; stock is not reserved by a quotation' using errcode = '40001';
  end if;
  return jsonb_build_object('version', 1, 'retailer', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'currency', v_org.currency),
    'project', jsonb_build_object('id', v_project.id, 'name', v_project.name, 'currency', v_project.currency, 'budgetMinor', v_project.budget_minor, 'customerId', v_project.customer_id),
    'customer', case when v_customer.id is null then null else jsonb_build_object('id', v_customer.id, 'name', v_customer.name, 'email', v_customer.email, 'phone', v_customer.phone) end,
    'sceneId', v_scene.id, 'sceneVersion', v_scene.version, 'policyRevision', v_policy.revision, 'policy', v_policy.policy, 'items', v_items);
end $$;

create function public.issue_quotation(p_project_id uuid, p_actor_id uuid, p_expected_scene_version integer, p_expected_policy_revision integer,
  p_idempotency_key uuid, p_request_hash text, p_source jsonb, p_calculation jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_project public.projects; v_quote public.quotations; v_source jsonb; v_line jsonb; v_item jsonb; v_totals jsonb;
  v_fee jsonb; v_subtotal numeric := 0; v_discount numeric := 0; v_net numeric := 0; v_tax numeric := 0; v_total numeric := 0; v_id uuid := gen_random_uuid(); v_key text;
begin
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  perform 1 from public.organisations where id = v_project.organisation_id for update;
  if p_actor_id is null or not exists(select 1 from public.organisation_members where organisation_id = v_project.organisation_id and user_id = p_actor_id and role in ('owner', 'admin', 'salesperson', 'designer')) then
    raise exception 'Staff membership required to issue quotations' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'Valid issuance identity required' using errcode = '23514'; end if;
  select * into v_quote from public.quotations where project_id = p_project_id and idempotency_key = p_idempotency_key;
  if found then
    if v_quote.issued_by is distinct from p_actor_id or v_quote.request_hash is distinct from p_request_hash then raise exception 'This issuance key was used for a different request' using errcode = '40001'; end if;
    return to_jsonb(v_quote);
  end if;
  v_source := public.quotation_source(p_project_id, p_actor_id, p_expected_scene_version, p_expected_policy_revision);
  if p_source is distinct from v_source then raise exception 'Quotation source changed; review prices and availability again' using errcode = '40001'; end if;
  if jsonb_typeof(p_calculation) is distinct from 'object' or p_calculation ->> 'version' is distinct from '1'
    or p_calculation -> 'policy' is distinct from v_source -> 'policy'
    or jsonb_typeof(p_calculation -> 'lines') is distinct from 'array'
    or jsonb_array_length(p_calculation -> 'lines') <> jsonb_array_length(v_source -> 'items') then
    raise exception 'Invalid quotation calculation contract' using errcode = '23514';
  end if;
  if (select count(distinct line ->> 'variantId') from jsonb_array_elements(p_calculation -> 'lines') line) <> jsonb_array_length(v_source -> 'items') then raise exception 'Quotation lines must reference each variant exactly once' using errcode = '23514'; end if;
  for v_line in select value from jsonb_array_elements(p_calculation -> 'lines') loop
    select value into v_item from jsonb_array_elements(v_source -> 'items') where value ->> 'variantId' = v_line ->> 'variantId';
    if not found or v_line ->> 'sku' is distinct from v_item ->> 'sku' or v_line ->> 'name' is distinct from v_item ->> 'name'
      or v_line ->> 'currency' is distinct from v_item ->> 'currency' or v_line -> 'quantity' is distinct from v_item -> 'quantity'
      or v_line -> 'unitPriceMinor' is distinct from v_item -> 'unitPriceMinor' then raise exception 'Quotation line identity or price differs from its catalogue source' using errcode = '23514'; end if;
    foreach v_key in array array['subtotalMinor','discountMinor','netMinor','taxMinor','totalMinor'] loop
      if coalesce(v_line ->> v_key, '') !~ '^\d+$' or (v_line ->> v_key)::numeric not between 0 and 9007199254740991 then raise exception 'Quotation amounts must be safe nonnegative minor-unit integers' using errcode = '23514'; end if;
    end loop;
    if (v_line ->> 'subtotalMinor')::numeric <> (v_item ->> 'unitPriceMinor')::numeric * (v_item ->> 'quantity')::numeric
      or (v_line ->> 'discountMinor')::numeric > (v_line ->> 'subtotalMinor')::numeric
      or (v_line ->> 'netMinor')::numeric + (v_line ->> 'taxMinor')::numeric <> (v_line ->> 'totalMinor')::numeric
      or (v_source #>> '{policy,taxMode}' = 'inclusive' and (v_line ->> 'totalMinor')::numeric <> (v_line ->> 'subtotalMinor')::numeric - (v_line ->> 'discountMinor')::numeric)
      or (v_source #>> '{policy,taxMode}' = 'exclusive' and (v_line ->> 'netMinor')::numeric <> (v_line ->> 'subtotalMinor')::numeric - (v_line ->> 'discountMinor')::numeric) then
      raise exception 'Quotation line totals do not conserve their source amounts' using errcode = '23514';
    end if;
    v_subtotal := v_subtotal + (v_line ->> 'subtotalMinor')::numeric; v_discount := v_discount + (v_line ->> 'discountMinor')::numeric;
    v_net := v_net + (v_line ->> 'netMinor')::numeric; v_tax := v_tax + (v_line ->> 'taxMinor')::numeric; v_total := v_total + (v_line ->> 'totalMinor')::numeric;
  end loop;
  v_totals := p_calculation -> 'totals';
  if v_totals ->> 'subtotalMinor' is distinct from v_subtotal::text or v_totals ->> 'discountMinor' is distinct from v_discount::text
    or v_totals ->> 'merchandiseNetMinor' is distinct from v_net::text or v_totals ->> 'merchandiseTaxMinor' is distinct from v_tax::text
    or v_totals ->> 'merchandiseTotalMinor' is distinct from v_total::text then raise exception 'Quotation merchandise totals do not match lines' using errcode = '23514'; end if;
  foreach v_key in array array['delivery','installation'] loop
    v_fee := p_calculation #> array['fees',v_key];
    if v_fee -> 'inputMinor' is distinct from v_source #> array['policy',v_key || 'Minor'] or v_fee -> 'taxable' is distinct from v_source #> '{policy,feesTaxable}' then raise exception 'Quotation fee differs from retailer policy' using errcode = '23514'; end if;
    if coalesce(v_fee ->> 'netMinor', '') !~ '^\d+$' or coalesce(v_fee ->> 'taxMinor', '') !~ '^\d+$' or coalesce(v_fee ->> 'totalMinor', '') !~ '^\d+$'
      or (v_fee ->> 'netMinor')::numeric + (v_fee ->> 'taxMinor')::numeric <> (v_fee ->> 'totalMinor')::numeric
      or ((v_source #>> '{policy,taxMode}' = 'inclusive' or v_fee ->> 'taxable' = 'false') and v_fee -> 'totalMinor' is distinct from v_fee -> 'inputMinor')
      or (v_source #>> '{policy,taxMode}' = 'exclusive' and v_fee -> 'netMinor' is distinct from v_fee -> 'inputMinor')
      or (v_fee ->> 'taxable' = 'false' and v_fee ->> 'taxMinor' is distinct from '0')
      or v_totals ->> (v_key || 'Minor') is distinct from v_fee ->> 'totalMinor' then raise exception 'Quotation fee arithmetic is inconsistent' using errcode = '23514'; end if;
    v_net := v_net + (v_fee ->> 'netMinor')::numeric; v_tax := v_tax + (v_fee ->> 'taxMinor')::numeric; v_total := v_total + (v_fee ->> 'totalMinor')::numeric;
  end loop;
  if v_totals ->> 'netMinor' is distinct from v_net::text or v_totals ->> 'taxMinor' is distinct from v_tax::text
    or v_totals ->> 'grandTotalMinor' is distinct from v_total::text or v_total > 9007199254740991 then raise exception 'Quotation invoice totals do not match lines and fees' using errcode = '23514'; end if;
  insert into public.quotations(id, organisation_id, project_id, scene_id, scene_version, policy_revision, number, issued_by, idempotency_key, request_hash, snapshot)
    values(v_id, v_project.organisation_id, p_project_id, (v_source ->> 'sceneId')::uuid, p_expected_scene_version, p_expected_policy_revision,
      'RS-' || upper(v_id::text), p_actor_id, p_idempotency_key, p_request_hash,
      jsonb_build_object('version',1,'source',v_source,'calculation',p_calculation,'inventoryReserved',false)) returning * into v_quote;
  return to_jsonb(v_quote);
end $$;

revoke all on public.retailer_pricing_policies, public.retailer_pricing_revisions, public.quotations from public, anon, authenticated, service_role;
grant select on public.retailer_pricing_policies, public.retailer_pricing_revisions, public.quotations to authenticated, service_role;
revoke all on function public.reject_quotation_mutation(), public.set_retailer_pricing_policy(uuid, uuid, integer, jsonb),
  public.quotation_source(uuid, uuid, integer, integer), public.issue_quotation(uuid, uuid, integer, integer, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.set_retailer_pricing_policy(uuid, uuid, integer, jsonb), public.quotation_source(uuid, uuid, integer, integer),
  public.issue_quotation(uuid, uuid, integer, integer, uuid, text, jsonb, jsonb) to service_role;
notify pgrst, 'reload schema';
