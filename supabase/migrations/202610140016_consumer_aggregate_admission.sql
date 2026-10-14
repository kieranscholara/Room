-- Repeat aggregate published-stock admission inside the authoritative consumer transaction.
revoke execute on function public.is_staff_actor(uuid,uuid) from authenticated;
create or replace function public.commit_consumer_scene(p_project_id uuid,p_actor_id uuid,p_expected_version integer,p_scene jsonb,p_history jsonb,p_future jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_project public.consumer_projects;v_org record;v_object jsonb;v_variant record;
begin
 -- Lock referenced retailer organisations in stable order, then the owned scene.
 for v_org in select distinct organisation_id from public.published_offers where variant_id::text in(select value->>'variantId' from jsonb_array_elements(p_scene->'objects')) order by organisation_id loop
  perform 1 from public.organisations where id=v_org.organisation_id for update;
 end loop;
 select * into v_project from public.consumer_projects where id=p_project_id and owner_id=p_actor_id for update;
 if not found then raise exception 'Personal design not found' using errcode='P0002'; end if;
 if v_project.version is distinct from p_expected_version then raise exception 'Personal design changed; reload' using errcode='40001'; end if;
 if p_scene->>'schemaVersion' is distinct from '2' or p_scene->>'id' is distinct from p_project_id::text or p_scene->>'organisationId' is distinct from 'consumer:'||p_actor_id::text then raise exception 'Personal scene identity cannot change' using errcode='23514'; end if;
 for v_object in select value from jsonb_array_elements(p_scene->'objects') loop
  if exists(select 1 from jsonb_array_elements(v_project.data->'objects') prior where prior->>'id'=v_object->>'id' and prior->>'variantId'=v_object->>'variantId') then continue; end if;
  select v.*,p.name product_name,p.category product_category,p.currency product_currency,p.active product_active,p.availability product_availability into v_variant
   from public.published_offers o join public.product_variants v on v.id=o.variant_id join public.products p on p.id=v.product_id
   where o.enabled and v.id::text=v_object->>'variantId';
  if not found or not v_variant.active or not v_variant.product_active or v_variant.availability='out_of_stock' or v_variant.product_availability='out_of_stock'
   or v_variant.product_currency is distinct from v_project.currency or (v_variant.availability='in_stock' and public.available_variant_stock(v_variant.id)<(select count(*) from jsonb_array_elements(p_scene->'objects') item where item->>'variantId'=v_variant.id::text))
   or v_object->>'sku' is distinct from v_variant.sku or v_object->>'name' is distinct from v_variant.product_name or v_object->>'category' is distinct from v_variant.product_category
   or v_object->>'color' is distinct from v_variant.color or (v_object->>'solid')::boolean is distinct from (v_variant.product_category<>'rug')
   or (v_object#>>'{dimensions,width}')::numeric is distinct from v_variant.width_m or (v_object#>>'{dimensions,depth}')::numeric is distinct from v_variant.depth_m or (v_object#>>'{dimensions,height}')::numeric is distinct from v_variant.height_m then raise exception 'Choose a current available explicitly published variant' using errcode='40001'; end if;
 end loop;
 update public.consumer_projects set version=version+1,data=p_scene||jsonb_build_object('version',version+1),history=p_history,future=p_future,updated_at=now() where id=p_project_id returning * into v_project;
 insert into public.consumer_scene_versions(project_id,version,data) values(p_project_id,v_project.version,v_project.data);
 delete from public.consumer_proposals where project_id=p_project_id and base_version<v_project.version;return to_jsonb(v_project);
end $$;

notify pgrst,'reload schema';
