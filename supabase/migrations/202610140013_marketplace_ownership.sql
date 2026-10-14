-- Public offers are an explicit retailer decision; consumer designs have independent ownership.
alter table public.organisations add column is_test boolean not null default false;
create table public.published_offers (
 id uuid primary key default gen_random_uuid(),organisation_id uuid not null,product_id uuid not null,variant_id uuid not null,
 revision integer not null default 1 check(revision>0),enabled boolean not null default false,
 image_ids uuid[] not null default '{}' check(cardinality(image_ids)<=4),published_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),unique(variant_id),
 foreign key(variant_id,organisation_id,product_id) references public.product_variants(id,organisation_id,product_id)
);
alter table public.published_offers enable row level security;
create policy offers_admin_read on public.published_offers for select to authenticated using(public.is_org_admin(organisation_id));
revoke all on public.published_offers from public,anon,authenticated,service_role;
grant select on public.published_offers to authenticated,service_role;
create function public.publish_offer(p_org_id uuid,p_actor_id uuid,p_variant_id uuid,p_expected_revision integer,p_enabled boolean,p_image_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_offer public.published_offers;v_variant public.product_variants;v_product public.products;
begin
 perform 1 from public.organisations where id=p_org_id for update;
 if not exists(select 1 from public.organisation_members where organisation_id=p_org_id and user_id=p_actor_id and role in ('owner','admin')) then raise exception 'Publication requires an organisation administrator' using errcode='42501'; end if;
 select * into v_variant from public.product_variants where id=p_variant_id and organisation_id=p_org_id;
 if not found then raise exception 'Variant not found' using errcode='P0002'; end if;
 select * into v_product from public.products where id=v_variant.product_id and organisation_id=p_org_id;
 select * into v_offer from public.published_offers where variant_id=p_variant_id;
 if coalesce(v_offer.revision,0) is distinct from p_expected_revision then raise exception 'Publication changed; reload' using errcode='40001'; end if;
 if p_enabled and (not v_variant.active or not v_product.active or not exists(select 1 from public.retailer_pricing_policies where organisation_id=p_org_id)) then raise exception 'Active products and explicit retailer tax configuration are required' using errcode='23514'; end if;
 if p_image_ids is null or cardinality(p_image_ids)>4 or (select count(distinct x) from unnest(p_image_ids) x)<>cardinality(p_image_ids)
  or exists(select 1 from unnest(p_image_ids) x where not exists(select 1 from public.product_assets a where a.id=x and a.organisation_id=p_org_id and a.product_id=v_product.id and (a.variant_id is null or a.variant_id=p_variant_id) and a.kind='image' and a.status='validated')) then raise exception 'Choose only validated images explicitly associated with this product variant' using errcode='23514'; end if;
 insert into public.published_offers(organisation_id,product_id,variant_id,enabled,image_ids,published_by)
 values(p_org_id,v_product.id,p_variant_id,p_enabled,p_image_ids,p_actor_id)
 on conflict(variant_id) do update set enabled=excluded.enabled,image_ids=excluded.image_ids,published_by=excluded.published_by,revision=public.published_offers.revision+1,updated_at=now() returning * into v_offer;
 return to_jsonb(v_offer);
end $$;
create table public.consumer_projects (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),name text not null check(length(name) between 1 and 100),
 currency text not null check(currency~'^[A-Z]{3}$'),budget_minor bigint not null check(budget_minor between 0 and 9007199254740991),
 version integer not null default 0 check(version>=0),data jsonb not null,history jsonb not null default '[]',future jsonb not null default '[]',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(data->>'schemaVersion'='2' and data->>'id'=id::text and data->>'organisationId'='consumer:'||owner_id::text and (data->>'version')::integer=version),
 check(jsonb_typeof(history)='array' and jsonb_array_length(history)<=100 and jsonb_typeof(future)='array' and jsonb_array_length(future)<=100)
);
create table public.consumer_scene_versions (
 project_id uuid not null references public.consumer_projects(id) on delete cascade,version integer not null,data jsonb not null,
 created_at timestamptz not null default now(),primary key(project_id,version)
);
create table public.consumer_proposals (
 id uuid primary key,project_id uuid not null references public.consumer_projects(id) on delete cascade,actor_id uuid not null references auth.users(id),
 base_version integer not null,payload jsonb not null,created_at timestamptz not null default now()
);
alter table public.consumer_projects enable row level security;alter table public.consumer_scene_versions enable row level security;alter table public.consumer_proposals enable row level security;
create policy consumer_projects_own on public.consumer_projects for select to authenticated using(owner_id=auth.uid());
create policy consumer_versions_own on public.consumer_scene_versions for select to authenticated using(exists(select 1 from public.consumer_projects p where p.id=project_id and p.owner_id=auth.uid()));
create policy consumer_proposals_own on public.consumer_proposals for select to authenticated using(actor_id=auth.uid() and exists(select 1 from public.consumer_projects p where p.id=project_id and p.owner_id=auth.uid()));
revoke all on public.consumer_projects,public.consumer_scene_versions,public.consumer_proposals from public,anon,authenticated,service_role;
grant select on public.consumer_projects,public.consumer_scene_versions,public.consumer_proposals to authenticated,service_role;
grant insert,delete on public.consumer_proposals to service_role;
create trigger consumer_versions_immutable before update on public.consumer_scene_versions for each row execute function public.reject_quotation_mutation();
create function public.create_consumer_project(p_actor_id uuid,p_name text,p_currency text,p_budget_minor bigint,p_scene jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid:=gen_random_uuid();v_project public.consumer_projects;
begin
 perform 1 from auth.users where id=p_actor_id for update;
 if not found then raise exception 'Verified consumer account required' using errcode='42501'; end if;
 if (select count(*) from public.consumer_projects where owner_id=p_actor_id)>=20 then raise exception 'At most twenty personal designs per account' using errcode='23514'; end if;
 if p_scene->>'schemaVersion' is distinct from '2' or jsonb_array_length(p_scene->'objects')<>0 or jsonb_array_length(p_scene->'groups')<>0 then raise exception 'Start a personal design with an empty canonical scene' using errcode='23514'; end if;
 insert into public.consumer_projects(id,owner_id,name,currency,budget_minor,data) values(v_id,p_actor_id,p_name,p_currency,p_budget_minor,p_scene||jsonb_build_object('id',v_id,'organisationId','consumer:'||p_actor_id::text,'version',0)) returning * into v_project;
 insert into public.consumer_scene_versions(project_id,version,data) values(v_id,0,v_project.data);return to_jsonb(v_project);
end $$;
create function public.commit_consumer_scene(p_project_id uuid,p_actor_id uuid,p_expected_version integer,p_scene jsonb,p_history jsonb,p_future jsonb) returns jsonb
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
   or v_variant.product_currency is distinct from v_project.currency or (v_variant.availability='in_stock' and public.available_variant_stock(v_variant.id)<1)
   or v_object->>'sku' is distinct from v_variant.sku or v_object->>'name' is distinct from v_variant.product_name or v_object->>'category' is distinct from v_variant.product_category
   or v_object->>'color' is distinct from v_variant.color or (v_object->>'solid')::boolean is distinct from (v_variant.product_category<>'rug')
   or (v_object#>>'{dimensions,width}')::numeric is distinct from v_variant.width_m or (v_object#>>'{dimensions,depth}')::numeric is distinct from v_variant.depth_m or (v_object#>>'{dimensions,height}')::numeric is distinct from v_variant.height_m then raise exception 'Choose a current available explicitly published variant' using errcode='40001'; end if;
 end loop;
 update public.consumer_projects set version=version+1,data=p_scene||jsonb_build_object('version',version+1),history=p_history,future=p_future,updated_at=now() where id=p_project_id returning * into v_project;
 insert into public.consumer_scene_versions(project_id,version,data) values(p_project_id,v_project.version,v_project.data);
 delete from public.consumer_proposals where project_id=p_project_id and base_version<v_project.version;return to_jsonb(v_project);
end $$;
create table public.marketplace_enquiries (
 id uuid primary key default gen_random_uuid(),consumer_project_id uuid not null references public.consumer_projects(id),consumer_version integer not null,
 owner_id uuid not null references auth.users(id),organisation_id uuid not null references public.organisations(id),retailer_project_id uuid not null references public.projects(id),
 created_at timestamptz not null default now(),unique(consumer_project_id,consumer_version,organisation_id)
);
alter table public.marketplace_enquiries enable row level security;
create policy enquiries_read on public.marketplace_enquiries for select to authenticated using(owner_id=auth.uid() or public.is_staff(organisation_id));
revoke all on public.marketplace_enquiries from public,anon,authenticated,service_role;grant select on public.marketplace_enquiries to authenticated,service_role;
create function public.marketplace_enquiry(p_consumer_project_id uuid,p_actor_id uuid,p_org_id uuid,p_expected_version integer,p_scene jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_consumer public.consumer_projects;v_customer public.customers;v_project public.projects;v_room public.rooms;v_scene public.scenes;v_existing public.marketplace_enquiries;v_email text;v_name text;v_id uuid:=gen_random_uuid();v_data jsonb;v_object jsonb;v_variant record;
begin
 perform 1 from public.organisations where id=p_org_id for update;
 select * into v_consumer from public.consumer_projects where id=p_consumer_project_id and owner_id=p_actor_id for update;
 if not found then raise exception 'Personal design not found' using errcode='P0002'; end if;
 if v_consumer.version is distinct from p_expected_version then raise exception 'Personal design changed; review before sharing' using errcode='40001'; end if;
 select * into v_existing from public.marketplace_enquiries where consumer_project_id=p_consumer_project_id and consumer_version=p_expected_version and organisation_id=p_org_id;
 if found then return to_jsonb(v_existing);end if;
 if jsonb_array_length(p_scene->'objects')<1 or p_scene->'room' is distinct from v_consumer.data->'room' then raise exception 'Share a measured room containing selected retailer offers' using errcode='23514';end if;
 for v_object in select value from jsonb_array_elements(p_scene->'objects') loop
  if not exists(select 1 from jsonb_array_elements(v_consumer.data->'objects') prior where prior->>'id'=v_object->>'id' and prior->>'variantId'=v_object->>'variantId' and prior->'transform'=v_object->'transform') then raise exception 'Shared furniture must come from the owned design' using errcode='23514';end if;
  select v.*,p.name product_name,p.category product_category,p.active product_active,p.availability product_availability,p.currency product_currency into v_variant from public.published_offers o join public.product_variants v on v.id=o.variant_id join public.products p on p.id=v.product_id where o.organisation_id=p_org_id and o.enabled and v.id::text=v_object->>'variantId';
  if not found or not v_variant.active or not v_variant.product_active or v_variant.product_currency<>v_consumer.currency or v_variant.availability='out_of_stock' or v_variant.product_availability='out_of_stock'
   or v_object->>'sku' is distinct from v_variant.sku or v_object->>'name' is distinct from v_variant.product_name or v_object->>'category' is distinct from v_variant.product_category or v_object->>'color' is distinct from v_variant.color
   or (v_object#>>'{dimensions,width}')::numeric is distinct from v_variant.width_m or (v_object#>>'{dimensions,depth}')::numeric is distinct from v_variant.depth_m or (v_object#>>'{dimensions,height}')::numeric is distinct from v_variant.height_m then raise exception 'A selected published product changed; review the design' using errcode='40001';end if;
 end loop;
 select email,coalesce(raw_user_meta_data->>'display_name',split_part(email,'@',1)) into v_email,v_name from auth.users where id=p_actor_id and email_confirmed_at is not null;
 if not found then raise exception 'Confirmed account required for a retailer enquiry' using errcode='42501';end if;
 select * into v_customer from public.customers where organisation_id=p_org_id and lower(email)=lower(v_email) order by created_at limit 1;
 if not found then insert into public.customers(organisation_id,name,email,notes) values(p_org_id,left(v_name,100),v_email,'Customer explicitly shared a personal marketplace design.') returning * into v_customer;end if;
 insert into public.organisation_members(organisation_id,user_id,role) values(p_org_id,p_actor_id,'customer') on conflict(organisation_id,user_id) do nothing;
 insert into public.projects(organisation_id,customer_id,name,budget_minor,currency,style,room_type,created_by) values(p_org_id,v_customer.id,left('Marketplace enquiry — '||v_consumer.name,100),v_consumer.budget_minor,v_consumer.currency,'','bedroom',p_actor_id) returning * into v_project;
 insert into public.rooms(organisation_id,project_id,name,width_m,depth_m,height_m,measurements_confirmed) values(p_org_id,v_project.id,p_scene#>>'{room,name}',(p_scene#>>'{room,width}')::numeric,(p_scene#>>'{room,depth}')::numeric,(p_scene#>>'{room,height}')::numeric,(p_scene#>>'{room,measurementsConfirmed}')::boolean) returning * into v_room;
 v_data:=p_scene||jsonb_build_object('id',v_id,'organisationId',p_org_id,'version',0);
 insert into public.scenes(id,organisation_id,project_id,room_id,data) values(v_id,p_org_id,v_project.id,v_room.id,v_data) returning * into v_scene;
 insert into public.scene_versions(scene_id,organisation_id,version,data,created_by) values(v_id,p_org_id,0,v_data,p_actor_id);
 insert into public.scene_operations(scene_id,organisation_id,version,actor_id,operation) values(v_id,p_org_id,0,p_actor_id,jsonb_build_object('type','marketplace-enquiry'));
 insert into public.project_access(project_id,organisation_id,user_id,can_edit,can_order) values(v_project.id,p_org_id,p_actor_id,false,true);
 insert into public.marketplace_enquiries(consumer_project_id,consumer_version,owner_id,organisation_id,retailer_project_id) values(p_consumer_project_id,p_expected_version,p_actor_id,p_org_id,v_project.id) returning * into v_existing;return to_jsonb(v_existing);
end $$;
revoke all on function public.publish_offer(uuid,uuid,uuid,integer,boolean,uuid[]),public.create_consumer_project(uuid,text,text,bigint,jsonb),public.commit_consumer_scene(uuid,uuid,integer,jsonb,jsonb,jsonb),public.marketplace_enquiry(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.publish_offer(uuid,uuid,uuid,integer,boolean,uuid[]),public.create_consumer_project(uuid,text,text,bigint,jsonb),public.commit_consumer_scene(uuid,uuid,integer,jsonb,jsonb,jsonb),public.marketplace_enquiry(uuid,uuid,uuid,integer,jsonb) to service_role;
notify pgrst,'reload schema';
