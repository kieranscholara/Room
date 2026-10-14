-- Catalogue changes are atomic and recheck administrator authority after locking
-- the organisation, in the same order as membership changes and scene commits.
revoke insert, update, delete on public.products, public.product_variants from authenticated;

alter table public.product_assets drop constraint product_assets_mime_type_check;
alter table public.product_assets drop constraint product_assets_check1;
alter table public.product_assets add constraint product_assets_mime_type_check
  check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary', 'model/gltf+json'));
alter table public.product_assets add constraint product_assets_kind_mime_check
  check ((kind = 'image' and mime_type in ('image/png', 'image/jpeg', 'image/webp'))
    or (kind = 'model' and mime_type in ('model/gltf-binary', 'model/gltf+json')
      and width_m is not null and depth_m is not null and height_m is not null));
update storage.buckets set public = false,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary', 'model/gltf+json']
where id = 'product-assets';

create function public.catalogue_product_write(p_org_id uuid, p_actor_id uuid, p_product_id uuid, p_product jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_product public.products; v_variant jsonb; v_variants jsonb; v_variant_id uuid; v_ids uuid[] := '{}';
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not exists (select 1 from public.organisation_members where organisation_id = p_org_id
    and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_product) <> 'object' then raise exception 'Product required' using errcode = '23514'; end if;
  v_variants := p_product -> 'variants';
  if jsonb_typeof(v_variants) is distinct from 'array' or jsonb_array_length(v_variants) not between 1 and 100 then
    raise exception 'One to one hundred variants required' using errcode = '23514';
  end if;
  if p_product_id is null then
    insert into public.products(organisation_id, sku, name, category, price_minor, currency, width_m, depth_m, height_m,
      color, material, active, availability, stock_quantity, lead_time_days)
    values(p_org_id, p_product ->> 'sku', p_product ->> 'name', p_product ->> 'category',
      (p_product ->> 'priceMinor')::bigint, p_product ->> 'currency',
      (p_product #>> '{dimensions,width}')::numeric, (p_product #>> '{dimensions,depth}')::numeric,
      (p_product #>> '{dimensions,height}')::numeric, p_product ->> 'color', p_product ->> 'material',
      (p_product ->> 'active')::boolean, p_product ->> 'availability', (p_product ->> 'stockQuantity')::integer,
      (p_product ->> 'leadTimeDays')::integer) returning * into v_product;
  else
    select * into v_product from public.products where id = p_product_id and organisation_id = p_org_id for update;
    if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
    update public.products set sku = p_product ->> 'sku', name = p_product ->> 'name', category = p_product ->> 'category',
      price_minor = (p_product ->> 'priceMinor')::bigint, currency = p_product ->> 'currency',
      width_m = (p_product #>> '{dimensions,width}')::numeric, depth_m = (p_product #>> '{dimensions,depth}')::numeric,
      height_m = (p_product #>> '{dimensions,height}')::numeric, color = p_product ->> 'color', material = p_product ->> 'material',
      active = (p_product ->> 'active')::boolean, availability = p_product ->> 'availability',
      stock_quantity = (p_product ->> 'stockQuantity')::integer, lead_time_days = (p_product ->> 'leadTimeDays')::integer,
      updated_at = clock_timestamp() where id = v_product.id returning * into v_product;
  end if;
  for v_variant in select value from jsonb_array_elements(v_variants) loop
    v_variant_id := (v_variant ->> 'id')::uuid;
    if v_variant_id is null then
      insert into public.product_variants(organisation_id, product_id, sku, name, color, material, price_minor,
        width_m, depth_m, height_m, active, availability, stock_quantity, lead_time_days)
      values(p_org_id, v_product.id, v_variant ->> 'sku', v_variant ->> 'name', v_variant ->> 'color', v_variant ->> 'material',
        (v_variant ->> 'priceMinor')::bigint, (v_variant #>> '{dimensions,width}')::numeric,
        (v_variant #>> '{dimensions,depth}')::numeric, (v_variant #>> '{dimensions,height}')::numeric,
        (v_variant ->> 'active')::boolean, v_variant ->> 'availability', (v_variant ->> 'stockQuantity')::integer,
        (v_variant ->> 'leadTimeDays')::integer) returning id into v_variant_id;
    else
      if v_variant_id = any(v_ids) then raise exception 'Duplicate variant identifier' using errcode = '23514'; end if;
      update public.product_variants set sku = v_variant ->> 'sku', name = v_variant ->> 'name', color = v_variant ->> 'color',
        material = v_variant ->> 'material', price_minor = (v_variant ->> 'priceMinor')::bigint,
        width_m = (v_variant #>> '{dimensions,width}')::numeric, depth_m = (v_variant #>> '{dimensions,depth}')::numeric,
        height_m = (v_variant #>> '{dimensions,height}')::numeric, active = (v_variant ->> 'active')::boolean,
        availability = v_variant ->> 'availability', stock_quantity = (v_variant ->> 'stockQuantity')::integer,
        lead_time_days = (v_variant ->> 'leadTimeDays')::integer, updated_at = clock_timestamp()
      where id = v_variant_id and organisation_id = p_org_id and product_id = v_product.id;
      if not found then raise exception 'Variant does not belong to this product' using errcode = '42501'; end if;
    end if;
    v_ids := array_append(v_ids, v_variant_id);
  end loop;
  -- Omitted variants remain referentially stable for scenes and become unavailable.
  update public.product_variants set active = false, updated_at = clock_timestamp()
    where organisation_id = p_org_id and product_id = v_product.id and not (id = any(v_ids));
  -- A dimension edit invalidates models previously checked against those dimensions.
  update public.product_assets a set status = 'rejected', validation = a.validation || '{"reason":"Catalogue dimensions changed; upload a newly validated model."}'::jsonb
    where a.organisation_id = p_org_id and a.product_id = v_product.id and a.kind = 'model' and a.status = 'validated'
      and ((a.variant_id is null and (a.width_m <> v_product.width_m or a.depth_m <> v_product.depth_m or a.height_m <> v_product.height_m))
        or (a.variant_id is not null and exists(select 1 from public.product_variants v where v.id = a.variant_id
          and (a.width_m <> v.width_m or a.depth_m <> v.depth_m or a.height_m <> v.height_m))));
  return v_product.id;
end $$;

create function public.catalogue_archive_product(p_org_id uuid, p_actor_id uuid, p_product_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not exists (select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  update public.products set active = false, updated_at = clock_timestamp() where id = p_product_id and organisation_id = p_org_id;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  update public.product_variants set active = false, updated_at = clock_timestamp() where product_id = p_product_id and organisation_id = p_org_id;
  return p_product_id;
end $$;

create function public.catalogue_import_products(p_org_id uuid, p_actor_id uuid, p_file_name text,
  p_products jsonb, p_row_count integer, p_errors jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_import public.catalogue_imports; v_product jsonb; v_status text := 'completed';
  v_errors jsonb := coalesce(p_errors, '[]'::jsonb); v_count integer := 0; v_variant_count integer := 0; v_summary jsonb;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not exists (select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  if p_row_count < 0 or p_row_count > 500 or jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) > 500
    or jsonb_typeof(v_errors) <> 'array' then raise exception 'Invalid bounded import' using errcode = '23514'; end if;
  if jsonb_array_length(v_errors) > 0 then v_status := 'failed';
  elsif jsonb_array_length(p_products) = 0 then
    v_status := 'failed'; v_errors := '[{"row":0,"message":"No products to import."}]'::jsonb;
  else
    begin
      for v_product in select value from jsonb_array_elements(p_products) loop
        if exists(select 1 from public.products where organisation_id = p_org_id and sku = v_product ->> 'sku') then
          raise exception 'An imported product SKU already exists' using errcode = '23505'; end if;
        perform public.catalogue_product_write(p_org_id, p_actor_id, null, v_product);
        v_count := v_count + 1;
        v_variant_count := v_variant_count + jsonb_array_length(v_product -> 'variants');
      end loop;
    exception when unique_violation then
      v_status := 'failed'; v_count := 0; v_variant_count := 0;
      v_errors := '[{"row":0,"column":"sku","message":"A product or variant SKU already exists. Nothing was imported."}]'::jsonb;
    when check_violation or foreign_key_violation or invalid_text_representation or not_null_violation then
      v_status := 'failed'; v_count := 0; v_variant_count := 0;
      v_errors := '[{"row":0,"message":"The catalogue changed or an import constraint failed. Nothing was imported."}]'::jsonb;
    end;
  end if;
  v_summary := jsonb_build_object('rowCount', p_row_count, 'productCount', v_count, 'variantCount', v_variant_count, 'errors', v_errors);
  insert into public.catalogue_imports(organisation_id, actor_id, file_name, status, summary)
    values(p_org_id, p_actor_id, p_file_name, v_status, v_summary) returning * into v_import;
  return jsonb_build_object('id', v_import.id, 'status', v_import.status, 'summary', v_summary, 'createdAt', v_import.created_at);
end $$;

create function public.catalogue_register_asset(p_org_id uuid, p_actor_id uuid, p_product_id uuid, p_variant_id uuid, p_asset jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_product public.products; v_variant public.product_variants; v_asset public.product_assets;
  v_width numeric; v_depth numeric; v_height numeric;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not exists(select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  select * into v_product from public.products where id = p_product_id and organisation_id = p_org_id;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  v_width := v_product.width_m; v_depth := v_product.depth_m; v_height := v_product.height_m;
  if p_variant_id is not null then
    select * into v_variant from public.product_variants where id = p_variant_id and product_id = p_product_id and organisation_id = p_org_id;
    if not found then raise exception 'Variant does not belong to this product' using errcode = '42501'; end if;
    v_width := v_variant.width_m; v_depth := v_variant.depth_m; v_height := v_variant.height_m;
  end if;
  if p_asset ->> 'kind' = 'model' and ((p_asset #>> '{dimensions,width}')::numeric is distinct from v_width
    or (p_asset #>> '{dimensions,depth}')::numeric is distinct from v_depth or (p_asset #>> '{dimensions,height}')::numeric is distinct from v_height) then
    raise exception 'Catalogue dimensions changed during validation; upload again' using errcode = '40001'; end if;
  if not exists(select 1 from storage.objects where bucket_id = 'product-assets' and name = p_asset ->> 'path') then
    raise exception 'Validated upload is missing' using errcode = '23514'; end if;
  insert into public.product_assets(organisation_id, product_id, variant_id, path, kind, mime_type, size_bytes, width_m, depth_m, height_m, validation)
    values(p_org_id, p_product_id, p_variant_id, p_asset ->> 'path', p_asset ->> 'kind', p_asset ->> 'mimeType',
      (p_asset ->> 'sizeBytes')::bigint, case when p_asset ->> 'kind' = 'model' then v_width end,
      case when p_asset ->> 'kind' = 'model' then v_depth end, case when p_asset ->> 'kind' = 'model' then v_height end,
      p_asset -> 'validation') returning * into v_asset;
  return to_jsonb(v_asset);
end $$;

create function public.catalogue_remove_asset(p_org_id uuid, p_actor_id uuid, p_product_id uuid, p_asset_id uuid)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_path text;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not exists(select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  delete from public.product_assets where id = p_asset_id and product_id = p_product_id and organisation_id = p_org_id returning path into v_path;
  if not found then raise exception 'Asset not found' using errcode = 'P0002'; end if;
  return v_path;
end $$;

-- Staged, failed and invalidated assets cannot be read through the Storage API.
create or replace function public.can_read_product_asset(p_path text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.product_assets where path = p_path and status = 'validated' and public.is_staff(organisation_id));
$$;

revoke all on function public.catalogue_product_write(uuid, uuid, uuid, jsonb),
  public.catalogue_archive_product(uuid, uuid, uuid), public.catalogue_import_products(uuid, uuid, text, jsonb, integer, jsonb),
  public.catalogue_register_asset(uuid, uuid, uuid, uuid, jsonb), public.catalogue_remove_asset(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.catalogue_product_write(uuid, uuid, uuid, jsonb),
  public.catalogue_archive_product(uuid, uuid, uuid), public.catalogue_import_products(uuid, uuid, text, jsonb, integer, jsonb),
  public.catalogue_register_asset(uuid, uuid, uuid, uuid, jsonb), public.catalogue_remove_asset(uuid, uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
