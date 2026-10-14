-- A new catalogue object is checked again while holding the organisation lock.
-- Catalogue writes take the same lock, closing the validation/commit race.
-- Existing scene snapshots and undo/redo retain their measured geometry.
create or replace function public.commit_scene(p_scene_id uuid, p_actor_id uuid, p_expected_version integer,
  p_scene jsonb, p_history jsonb, p_future jsonb, p_operation jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_scene public.scenes; v_data jsonb; v_object jsonb; v_catalogue record; v_currency text;
begin
  select * into v_scene from public.scenes where id = p_scene_id;
  if not found then raise exception 'Scene not found' using errcode = 'P0002'; end if;
  perform 1 from public.organisations where id = v_scene.organisation_id for update;
  select * into v_scene from public.scenes where id = p_scene_id for update;
  if not found then raise exception 'Scene not found' using errcode = 'P0002'; end if;
  if not public.actor_can_edit_project(v_scene.project_id, p_actor_id) then raise exception 'Project edit access required' using errcode = '42501'; end if;
  if v_scene.version <> p_expected_version then raise exception 'Scene version conflict' using errcode = '40001'; end if;
  if p_scene ->> 'id' is distinct from v_scene.id::text or p_scene ->> 'organisationId' is distinct from v_scene.organisation_id::text or p_scene ->> 'schemaVersion' is distinct from '2' then
    raise exception 'Scene identity and schema cannot change' using errcode = '23514';
  end if;

  if p_operation ->> 'type' = 'add-object' then
    select value into v_object from jsonb_array_elements(p_scene -> 'objects')
      where value ->> 'id' = p_operation #>> '{object,id}';
    if v_object is null or v_object ->> 'variantId' is distinct from p_operation #>> '{object,variantId}' then
      raise exception 'New catalogue object is missing or has changed identity' using errcode = '23514';
    end if;
    select v.*, p.name as product_name, p.category as product_category, p.currency as product_currency,
      p.active as product_active, p.availability as product_availability
      into v_catalogue from public.product_variants v join public.products p
        on p.id = v.product_id and p.organisation_id = v.organisation_id
      where v.id::text = v_object ->> 'variantId' and v.organisation_id = v_scene.organisation_id;
    select currency into v_currency from public.projects where id = v_scene.project_id;
    if not found or v_catalogue.id is null or not v_catalogue.active or not v_catalogue.product_active
      or v_catalogue.availability = 'out_of_stock' or v_catalogue.product_availability = 'out_of_stock'
      or (v_catalogue.availability = 'in_stock' and v_catalogue.stock_quantity <= 0)
      or v_catalogue.product_currency is distinct from v_currency
      or v_object ->> 'sku' is distinct from v_catalogue.sku
      or v_object ->> 'name' is distinct from v_catalogue.product_name
      or v_object ->> 'category' is distinct from v_catalogue.product_category
      or v_object ->> 'color' is distinct from v_catalogue.color
      or (v_object ->> 'solid')::boolean is distinct from (v_catalogue.product_category <> 'rug')
      or (v_object #>> '{dimensions,width}')::numeric is distinct from v_catalogue.width_m
      or (v_object #>> '{dimensions,depth}')::numeric is distinct from v_catalogue.depth_m
      or (v_object #>> '{dimensions,height}')::numeric is distinct from v_catalogue.height_m then
      raise exception 'Catalogue details or availability changed; reload the catalogue and preview again' using errcode = '40001';
    end if;
  end if;

  v_data := p_scene || jsonb_build_object('version', p_expected_version + 1);
  update public.scenes set version = p_expected_version + 1, data = v_data, history = p_history, future = p_future where id = p_scene_id returning * into v_scene;
  update public.rooms set name = v_data #>> '{room,name}', width_m = (v_data #>> '{room,width}')::numeric,
    depth_m = (v_data #>> '{room,depth}')::numeric, height_m = (v_data #>> '{room,height}')::numeric,
    measurements_confirmed = (v_data #>> '{room,measurementsConfirmed}')::boolean where id = v_scene.room_id;
  insert into public.scene_versions(scene_id, organisation_id, version, data, created_by) values(v_scene.id, v_scene.organisation_id, v_scene.version, v_data, p_actor_id);
  insert into public.scene_operations(scene_id, organisation_id, version, actor_id, operation) values(v_scene.id, v_scene.organisation_id, v_scene.version, p_actor_id, p_operation);
  delete from public.scene_proposals where scene_id = p_scene_id and base_version < v_scene.version;
  return to_jsonb(v_scene);
end $$;

notify pgrst, 'reload schema';
