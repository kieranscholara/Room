-- Editable catalogue-image layers and immutable photo evidence for quotations.
create table public.photo_compositions (
 reference_id uuid primary key, project_id uuid not null, organisation_id uuid not null,
 revision integer not null check(revision>0),scene_version integer not null,photo_revision integer not null,
 layers jsonb not null check(jsonb_typeof(layers)='array' and jsonb_array_length(layers)<=30 and octet_length(layers::text)<=60000),
 render_job_id uuid references public.tenant_jobs(id),rendered_reference_id uuid,
 image_sha256 text check(image_sha256 is null or image_sha256 ~ '^[0-9a-f]{64}$'),
 confirmed_by uuid references auth.users(id),confirmed_at timestamptz,updated_at timestamptz not null default now(),
 foreign key(reference_id,project_id,organisation_id) references public.room_references(id,project_id,organisation_id) on delete cascade,
 foreign key(rendered_reference_id,project_id,organisation_id) references public.room_references(id,project_id,organisation_id)
);
alter table public.photo_compositions enable row level security;
create policy composition_read on public.photo_compositions for select to authenticated using(public.can_access_project(project_id));
revoke all on public.photo_compositions from public,anon,authenticated,service_role;
grant select on public.photo_compositions to authenticated,service_role;

create function public.check_photo_layers(p_project_id uuid,p_layers jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_scene jsonb;v_org uuid;v_layer jsonb;v_object jsonb;
begin
 select s.data,p.organisation_id into v_scene,v_org from public.scenes s join public.projects p on p.id=s.project_id where s.project_id=p_project_id;
 if jsonb_typeof(p_layers) is distinct from 'array' or jsonb_array_length(p_layers)>30 or octet_length(p_layers::text)>60000
 or jsonb_array_length(p_layers) is distinct from jsonb_array_length(v_scene->'objects')
 or (select count(distinct l->>'objectId') from jsonb_array_elements(p_layers) l) <> jsonb_array_length(p_layers) then raise exception 'Every saved product needs one unique image layer' using errcode='23514';end if;
 for v_layer in select value from jsonb_array_elements(p_layers) loop
  select value into v_object from jsonb_array_elements(v_scene->'objects') where value->>'id'=v_layer->>'objectId';
  if v_object is null or not exists(select 1 from public.product_assets a join public.product_variants v on v.product_id=a.product_id and v.organisation_id=a.organisation_id
   where a.id=(v_layer->>'assetId')::uuid and a.organisation_id=v_org and a.kind='image' and a.status='validated'
   and v.id=(v_object->>'variantId')::uuid and (a.variant_id is null or a.variant_id=v.id)) then
   raise exception 'Image does not belong to the saved product variant' using errcode='23514';end if;
 end loop;
end $$;

create function public.write_photo_composition(p_project_id uuid,p_reference_id uuid,p_actor_id uuid,p_action text,p_body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org uuid;v_row public.photo_compositions;v_photo public.photo_workspaces;v_scene public.scenes;v_job public.tenant_jobs;
begin
 select organisation_id into v_org from public.projects where id=p_project_id;
 perform 1 from public.organisations where id=v_org for update;
 if not public.actor_can_edit_project(p_project_id,p_actor_id) then raise exception 'Project edit access required' using errcode='42501';end if;
 select * into v_photo from public.photo_workspaces where reference_id=p_reference_id and project_id=p_project_id;
 select * into v_scene from public.scenes where project_id=p_project_id;
 if v_photo.calibration is null or v_photo.revision is distinct from (p_body->>'expectedPhotoRevision')::integer
 or v_scene.version is distinct from (p_body->>'expectedSceneVersion')::integer
 or v_scene.data#>>'{room,measurementsConfirmed}' is distinct from 'true'
 or (v_photo.calibration->>'roomWidth')::numeric is distinct from (v_scene.data#>>'{room,width}')::numeric
 or (v_photo.calibration->>'roomDepth')::numeric is distinct from (v_scene.data#>>'{room,depth}')::numeric then
 raise exception 'Room or photograph changed; review the current photograph' using errcode='40001';end if;
 select * into v_row from public.photo_compositions where reference_id=p_reference_id for update;
 if coalesce(v_row.revision,0) is distinct from (p_body->>'expectedRevision')::integer then raise exception 'Photograph composition changed' using errcode='40001';end if;
 if p_action='save' then
  perform public.check_photo_layers(p_project_id,p_body->'layers');
  insert into public.photo_compositions(reference_id,project_id,organisation_id,revision,scene_version,photo_revision,layers)
  values(p_reference_id,p_project_id,v_org,1,v_scene.version,v_photo.revision,p_body->'layers')
  on conflict(reference_id) do update set revision=photo_compositions.revision+1,scene_version=excluded.scene_version,photo_revision=excluded.photo_revision,layers=excluded.layers,
   render_job_id=null,rendered_reference_id=null,image_sha256=null,confirmed_by=null,confirmed_at=null,updated_at=now() returning * into v_row;
 elsif p_action in ('apply','confirm') then
  if v_row.reference_id is null or v_row.scene_version<>v_scene.version or v_row.photo_revision<>v_photo.revision then raise exception 'Save the current image layers first' using errcode='40001';end if;
  perform public.check_photo_layers(p_project_id,v_row.layers);
  if p_action='apply' then
   select * into v_job from public.tenant_jobs where id=(p_body->>'jobId')::uuid and project_id=p_project_id and organisation_id=v_org and kind='photo_render' and status='completed';
   if v_job.id is null or v_job.result->>'referenceId' is distinct from p_reference_id::text
    or v_job.result->>'compositionRevision' is distinct from v_row.revision::text
    or v_job.result->>'sceneVersion' is distinct from v_scene.version::text
    or v_job.result->>'photoRevision' is distinct from v_photo.revision::text then raise exception 'Review a current completed image render' using errcode='40001';end if;
   update public.photo_compositions set render_job_id=v_job.id,rendered_reference_id=(v_job.result->>'renderedReferenceId')::uuid,image_sha256=v_job.result->>'imageSha256',confirmed_by=null,confirmed_at=null where reference_id=p_reference_id returning * into v_row;
  else
   if v_row.rendered_reference_id is null then raise exception 'Review and use the final photograph first' using errcode='40001';end if;
   if not exists(select 1 from public.organisation_members where organisation_id=v_org and user_id=p_actor_id and role in ('owner','admin','salesperson','designer')) then raise exception 'Salesperson confirmation required' using errcode='42501';end if;
   update public.photo_compositions set confirmed_by=p_actor_id,confirmed_at=now() where reference_id=p_reference_id returning * into v_row;
  end if;
 else raise exception 'Unsupported photograph action' using errcode='23514';end if;
 return to_jsonb(v_row);
end $$;
revoke all on function public.check_photo_layers(uuid,jsonb),public.write_photo_composition(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.check_photo_layers(uuid,jsonb),public.write_photo_composition(uuid,uuid,uuid,text,jsonb) to service_role;

-- Protect originals and final images referenced by immutable quotations.
create table public.quotation_photo_evidence (
 quotation_id uuid primary key references public.quotations(id),project_id uuid not null,organisation_id uuid not null,
 reference_id uuid not null,rendered_reference_id uuid not null,
 foreign key(reference_id,project_id,organisation_id) references public.room_references(id,project_id,organisation_id),
 foreign key(rendered_reference_id,project_id,organisation_id) references public.room_references(id,project_id,organisation_id)
);
alter table public.quotation_photo_evidence enable row level security;
create policy photo_evidence_read on public.quotation_photo_evidence for select to authenticated using(public.can_access_project(project_id));
revoke all on public.quotation_photo_evidence from public,anon,authenticated,service_role;
grant select on public.quotation_photo_evidence to authenticated,service_role;
create function public.bind_quotation_photo() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.photo_compositions;v_ref text;v_photo public.photo_workspaces;
begin
 v_ref:=nullif(current_setting('roomsell.quotation_photo_reference',true),'');
 if v_ref is null then
  if exists(select 1 from public.photo_compositions where project_id=new.project_id) then raise exception 'Confirm and quote the saved photograph' using errcode='40001';end if;
  return new;
 end if;
 select * into v_row from public.photo_compositions where reference_id=v_ref::uuid and project_id=new.project_id;
 select * into v_photo from public.photo_workspaces where reference_id=v_ref::uuid and project_id=new.project_id;
 if v_row.confirmed_at is null or v_row.rendered_reference_id is null or v_row.scene_version is distinct from new.scene_version or v_row.photo_revision is distinct from v_photo.revision
 or v_row.revision::text is distinct from current_setting('roomsell.quotation_photo_revision',true)
 or v_row.image_sha256 is distinct from current_setting('roomsell.quotation_photo_digest',true) then raise exception 'Confirmed photograph changed; render and confirm again' using errcode='40001';end if;
 perform public.check_photo_layers(new.project_id,v_row.layers);
 new.snapshot:=new.snapshot||jsonb_build_object('photo',jsonb_build_object('referenceId',v_row.reference_id,'compositionRevision',v_row.revision,'imageSha256',v_row.image_sha256,
 'photoRevision',v_row.photo_revision,'sceneVersion',v_row.scene_version,'renderedReferenceId',v_row.rendered_reference_id,'confirmedBy',v_row.confirmed_by,'confirmedAt',v_row.confirmed_at,'layers',v_row.layers));
 return new;
end $$;
create trigger quotations_bind_photo before insert on public.quotations for each row execute function public.bind_quotation_photo();
create function public.protect_quotation_photo() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.snapshot ? 'photo' then insert into public.quotation_photo_evidence values(new.id,new.project_id,new.organisation_id,(new.snapshot#>>'{photo,referenceId}')::uuid,(new.snapshot#>>'{photo,renderedReferenceId}')::uuid);end if;
 return new;
end $$;
create trigger quotations_protect_photo after insert on public.quotations for each row execute function public.protect_quotation_photo();
create function public.issue_photo_quotation(p_project_id uuid,p_actor_id uuid,p_expected_scene_version integer,p_expected_policy_revision integer,p_idempotency_key uuid,p_request_hash text,p_source jsonb,p_calculation jsonb,p_photo jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform set_config('roomsell.quotation_photo_reference',p_photo->>'referenceId',true);
 perform set_config('roomsell.quotation_photo_revision',p_photo->>'compositionRevision',true);
 perform set_config('roomsell.quotation_photo_digest',p_photo->>'imageSha256',true);
 return public.issue_quotation(p_project_id,p_actor_id,p_expected_scene_version,p_expected_policy_revision,p_idempotency_key,p_request_hash,p_source,p_calculation);
end $$;
revoke all on function public.bind_quotation_photo(),public.protect_quotation_photo(),public.issue_photo_quotation(uuid,uuid,integer,integer,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.issue_photo_quotation(uuid,uuid,integer,integer,uuid,text,jsonb,jsonb,jsonb) to service_role;

alter table public.tenant_jobs drop constraint tenant_jobs_kind_check;
alter table public.tenant_jobs add constraint tenant_jobs_kind_check check(kind in ('ai_design','inventory_sync','cleanup_storage','cleanup_orphans','photo_analysis','photo_cleanup','photo_render'));
create or replace function public.job_actor_authorised(p_kind text,p_org_id uuid,p_project_id uuid,p_actor_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select case when p_kind in ('ai_design','photo_analysis','photo_cleanup','photo_render') or (p_kind='cleanup_storage' and p_project_id is not null) then p_project_id is not null and exists(select 1 from public.projects where id=p_project_id and organisation_id=p_org_id) and public.actor_can_edit_project(p_project_id,p_actor_id)
 else exists(select 1 from public.organisation_members where organisation_id=p_org_id and user_id=p_actor_id and role in ('owner','admin')) end
$$;
create or replace function public.job_ai_quota() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.kind in ('ai_design','photo_analysis','photo_cleanup','photo_render') and ((select count(*) from public.tenant_jobs where actor_id=new.actor_id and kind in ('ai_design','photo_analysis','photo_cleanup','photo_render') and created_at>now()-interval '1 hour')>=20
 or (select count(*) from public.tenant_jobs where organisation_id=new.organisation_id and kind in ('ai_design','photo_analysis','photo_cleanup','photo_render') and created_at>now()-interval '1 hour')>=100) then raise exception 'Image request capacity reached' using errcode='23514';end if;return new;end $$;
notify pgrst,'reload schema';
