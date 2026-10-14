-- Credentials remain in a separate service-only table; manager-visible connector
-- metadata, mappings and sync audit never contain a bearer token or provider body.
create table public.inventory_connections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  provider text not null check (provider = 'custom_rest'),
  endpoint text not null check (length(endpoint) <= 2048 and endpoint ~ '^https://[^/?#@]+(/[^?#]*)?$'),
  enabled boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  last_synced_at timestamptz,
  last_source_generated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id, organisation_id)
);
create table public.inventory_credentials (
  connection_id uuid primary key,
  organisation_id uuid not null,
  token_envelope text not null check (length(token_envelope) between 20 and 6000 and token_envelope ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  foreign key (connection_id, organisation_id) references public.inventory_connections(id, organisation_id) on delete cascade
);
create table public.inventory_mappings (
  organisation_id uuid not null,
  connection_id uuid not null,
  external_product_id text not null check (length(btrim(external_product_id)) between 1 and 200),
  external_variant_id text not null check (length(btrim(external_variant_id)) between 1 and 200),
  product_id uuid not null,
  variant_id uuid not null,
  primary key (connection_id, external_product_id, external_variant_id),
  unique (organisation_id, variant_id),
  foreign key (connection_id, organisation_id) references public.inventory_connections(id, organisation_id) on delete cascade,
  foreign key (variant_id, organisation_id, product_id) references public.product_variants(id, organisation_id, product_id) on delete cascade
);
create table public.inventory_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  connection_id uuid not null,
  actor_id uuid not null references auth.users(id),
  status text not null check (status in ('completed', 'failed')),
  item_count integer not null check (item_count between 0 and 1000),
  error_code text check (error_code in ('invalid_snapshot', 'stale_snapshot', 'mapping_mismatch', 'catalogue_conflict', 'endpoint_rejected', 'provider_unavailable', 'credentials_unavailable')),
  source_generated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check ((status = 'completed' and error_code is null) or (status = 'failed' and error_code is not null and item_count = 0)),
  foreign key (connection_id, organisation_id) references public.inventory_connections(id, organisation_id) on delete cascade
);
create index inventory_connections_org on public.inventory_connections(organisation_id);
create index inventory_sync_runs_recent on public.inventory_sync_runs(organisation_id, created_at desc);
alter table public.inventory_connections enable row level security;
alter table public.inventory_credentials enable row level security;
alter table public.inventory_mappings enable row level security;
alter table public.inventory_sync_runs enable row level security;
create policy inventory_connections_admin_read on public.inventory_connections for select to authenticated using (public.is_org_admin(organisation_id));
create policy inventory_mappings_admin_read on public.inventory_mappings for select to authenticated using (public.is_org_admin(organisation_id));
create policy inventory_sync_runs_admin_read on public.inventory_sync_runs for select to authenticated using (public.is_org_admin(organisation_id));
revoke all on public.inventory_connections, public.inventory_credentials, public.inventory_mappings, public.inventory_sync_runs from anon, authenticated;
grant select on public.inventory_connections, public.inventory_mappings, public.inventory_sync_runs to authenticated;
grant all on public.inventory_connections, public.inventory_credentials, public.inventory_mappings, public.inventory_sync_runs to service_role;

create function public.inventory_connection_write(p_org_id uuid, p_actor_id uuid, p_connection_id uuid,
  p_expected_revision integer, p_config jsonb, p_token_envelope text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_connection public.inventory_connections;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not exists(select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  if p_connection_id is null then
    if p_token_envelope is null then raise exception 'A connector credential is required' using errcode = '23514'; end if;
    if (select count(*) from public.inventory_connections where organisation_id = p_org_id) >= 20 then
      raise exception 'An organisation supports at most twenty inventory connections' using errcode = '23514'; end if;
    insert into public.inventory_connections(organisation_id, name, provider, endpoint, enabled)
      values(p_org_id, p_config ->> 'name', 'custom_rest', p_config ->> 'endpoint', (p_config ->> 'enabled')::boolean)
      returning * into v_connection;
  else
    select * into v_connection from public.inventory_connections where id = p_connection_id and organisation_id = p_org_id for update;
    if not found then raise exception 'Inventory connection not found' using errcode = 'P0002'; end if;
    if v_connection.revision is distinct from p_expected_revision then raise exception 'Inventory configuration changed; reload and retry' using errcode = '40001'; end if;
    update public.inventory_connections set name = p_config ->> 'name', endpoint = p_config ->> 'endpoint', enabled = (p_config ->> 'enabled')::boolean,
      revision = revision + 1, updated_at = clock_timestamp() where id = v_connection.id returning * into v_connection;
  end if;
  if p_token_envelope is not null then
    insert into public.inventory_credentials(connection_id, organisation_id, token_envelope)
      values(v_connection.id, p_org_id, p_token_envelope)
      on conflict (connection_id) do update set token_envelope = excluded.token_envelope;
  end if;
  return to_jsonb(v_connection);
end $$;

create function public.inventory_replace_mappings(p_org_id uuid, p_actor_id uuid, p_connection_id uuid,
  p_expected_revision integer, p_mappings jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_connection public.inventory_connections; v_item jsonb;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not exists(select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  select * into v_connection from public.inventory_connections where id = p_connection_id and organisation_id = p_org_id for update;
  if not found then raise exception 'Inventory connection not found' using errcode = 'P0002'; end if;
  if v_connection.revision is distinct from p_expected_revision then raise exception 'Inventory configuration changed; reload and retry' using errcode = '40001'; end if;
  if jsonb_typeof(p_mappings) is distinct from 'array' or jsonb_array_length(p_mappings) > 1000 then
    raise exception 'Invalid bounded inventory mappings' using errcode = '23514'; end if;
  delete from public.inventory_mappings where connection_id = p_connection_id and organisation_id = p_org_id;
  for v_item in select value from jsonb_array_elements(p_mappings) loop
    insert into public.inventory_mappings(organisation_id, connection_id, external_product_id, external_variant_id, product_id, variant_id)
      values(p_org_id, p_connection_id, v_item ->> 'externalProductId', v_item ->> 'externalVariantId',
        (v_item ->> 'productId')::uuid, (v_item ->> 'variantId')::uuid);
  end loop;
  update public.inventory_connections set revision = revision + 1, updated_at = clock_timestamp()
    where id = p_connection_id returning * into v_connection;
  return to_jsonb(v_connection);
end $$;

create function public.inventory_record_failure(p_org_id uuid, p_actor_id uuid, p_connection_id uuid, p_error_code text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_run public.inventory_sync_runs;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not exists(select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  if not exists(select 1 from public.inventory_connections where id = p_connection_id and organisation_id = p_org_id) then
    raise exception 'Inventory connection not found' using errcode = 'P0002'; end if;
  insert into public.inventory_sync_runs(organisation_id, connection_id, actor_id, status, item_count, error_code)
    values(p_org_id, p_connection_id, p_actor_id, 'failed', 0, p_error_code) returning * into v_run;
  return to_jsonb(v_run);
end $$;

create function public.inventory_apply_snapshot(p_org_id uuid, p_actor_id uuid, p_connection_id uuid,
  p_expected_revision integer, p_generated_at timestamptz, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_connection public.inventory_connections; v_run public.inventory_sync_runs; v_item jsonb;
  v_variant public.product_variants; v_product public.products; v_count integer := 0; v_error text;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not exists(select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  select * into v_connection from public.inventory_connections where id = p_connection_id and organisation_id = p_org_id for update;
  if not found then raise exception 'Inventory connection not found' using errcode = 'P0002'; end if;
  if v_connection.revision is distinct from p_expected_revision or not v_connection.enabled then
    raise exception 'Inventory configuration changed or is disabled; reload and retry' using errcode = '40001'; end if;
  -- Inner transaction rolls back every catalogue update on any bad item while
  -- retaining a sanitized failed audit record outside that subtransaction.
  begin
    if p_generated_at is null or p_generated_at < clock_timestamp() - interval '15 minutes'
      or p_generated_at > clock_timestamp() + interval '1 minute'
      or p_generated_at <= v_connection.last_source_generated_at then
      raise exception 'stale_snapshot' using errcode = '23514'; end if;
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 1000
      or jsonb_array_length(p_items) <> (select count(*) from public.inventory_mappings where connection_id = p_connection_id and organisation_id = p_org_id)
      or (select count(distinct (value ->> 'externalProductId', value ->> 'externalVariantId')) from jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) then
      raise exception 'mapping_mismatch' using errcode = '23514'; end if;
    for v_item in select value from jsonb_array_elements(p_items) loop
      select v.* into v_variant from public.inventory_mappings m join public.product_variants v
        on v.id = m.variant_id and v.organisation_id = m.organisation_id and v.product_id = m.product_id
        where m.organisation_id = p_org_id and m.connection_id = p_connection_id
          and m.external_product_id = v_item ->> 'externalProductId' and m.external_variant_id = v_item ->> 'externalVariantId'
          and m.product_id = (v_item ->> 'productId')::uuid and m.variant_id = (v_item ->> 'variantId')::uuid;
      if not found then raise exception 'mapping_mismatch' using errcode = '23514'; end if;
      select * into v_product from public.products where id = v_variant.product_id and organisation_id = p_org_id;
      if not v_product.active or not v_variant.active or v_variant.sku is distinct from v_item ->> 'sku'
        or v_product.currency is distinct from v_item ->> 'currency' then
        raise exception 'catalogue_conflict' using errcode = '23514'; end if;
      if jsonb_typeof(v_item -> 'priceMinor') is distinct from 'number' or jsonb_typeof(v_item -> 'stockQuantity') is distinct from 'number'
        or (v_item ->> 'priceMinor')::numeric <> trunc((v_item ->> 'priceMinor')::numeric)
        or (v_item ->> 'stockQuantity')::numeric <> trunc((v_item ->> 'stockQuantity')::numeric)
        or ((v_item ->> 'availability' = 'in_stock') and (v_item ->> 'stockQuantity')::integer <= 0)
        or ((v_item ->> 'availability' = 'out_of_stock') and (v_item ->> 'stockQuantity')::integer <> 0) then
        raise exception 'invalid_snapshot' using errcode = '23514'; end if;
      update public.product_variants set price_minor = (v_item ->> 'priceMinor')::bigint,
        stock_quantity = (v_item ->> 'stockQuantity')::integer, availability = v_item ->> 'availability', updated_at = clock_timestamp()
        where id = v_variant.id and organisation_id = p_org_id;
      v_count := v_count + 1;
    end loop;
    -- Parent availability is derived from all active variants. Dimensions, SKU,
    -- identity, locks and saved scenes are never changed by a connector.
    update public.products p set
      price_minor = s.price_minor, stock_quantity = s.stock_quantity,
      availability = case when s.in_stock then 'in_stock' when s.made_to_order then 'made_to_order' else 'out_of_stock' end,
      updated_at = clock_timestamp()
    from (select v.product_id, min(v.price_minor) as price_minor, sum(v.stock_quantity)::integer as stock_quantity,
      bool_or(v.availability = 'in_stock' and v.stock_quantity > 0) as in_stock,
      bool_or(v.availability = 'made_to_order') as made_to_order
      from public.product_variants v where v.organisation_id = p_org_id and v.active
        and v.product_id in (select product_id from public.inventory_mappings where connection_id = p_connection_id and organisation_id = p_org_id)
      group by v.product_id) s
      where p.id = s.product_id and p.organisation_id = p_org_id;
    update public.inventory_connections set revision = revision + 1, last_synced_at = clock_timestamp(),
      last_source_generated_at = p_generated_at, updated_at = clock_timestamp() where id = p_connection_id returning * into v_connection;
  exception when others then
    v_count := 0;
    v_error := case when sqlerrm in ('stale_snapshot', 'mapping_mismatch', 'catalogue_conflict', 'invalid_snapshot') then sqlerrm else 'catalogue_conflict' end;
  end;
  insert into public.inventory_sync_runs(organisation_id, connection_id, actor_id, status, item_count, error_code, source_generated_at)
    values(p_org_id, p_connection_id, p_actor_id, case when v_error is null then 'completed' else 'failed' end,
      v_count, v_error, p_generated_at) returning * into v_run;
  return jsonb_build_object('connection', to_jsonb(v_connection), 'run', to_jsonb(v_run));
end $$;

revoke all on function public.inventory_connection_write(uuid, uuid, uuid, integer, jsonb, text),
  public.inventory_replace_mappings(uuid, uuid, uuid, integer, jsonb),
  public.inventory_record_failure(uuid, uuid, uuid, text),
  public.inventory_apply_snapshot(uuid, uuid, uuid, integer, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.inventory_connection_write(uuid, uuid, uuid, integer, jsonb, text),
  public.inventory_replace_mappings(uuid, uuid, uuid, integer, jsonb),
  public.inventory_record_failure(uuid, uuid, uuid, text),
  public.inventory_apply_snapshot(uuid, uuid, uuid, integer, timestamptz, jsonb) to service_role;
notify pgrst, 'reload schema';
