-- Calibrated photo presentation is separate from the authoritative metre scene.
alter table public.room_references add constraint room_reference_project_identity unique(id,project_id,organisation_id);
create table public.photo_workspaces (
 reference_id uuid primary key,project_id uuid not null,organisation_id uuid not null,
 revision integer not null default 1 check(revision>0),calibration jsonb,regions jsonb not null default '[]'::jsonb,
 background_reference_id uuid,updated_at timestamptz not null default now(),
 foreign key(reference_id,project_id,organisation_id) references public.room_references(id,project_id,organisation_id) on delete cascade,
 foreign key(background_reference_id,project_id,organisation_id) references public.room_references(id,project_id,organisation_id) on delete set null(background_reference_id),
 check(calibration is null or jsonb_typeof(calibration)='object'),
 check(jsonb_typeof(regions)='array' and jsonb_array_length(regions)<=30 and octet_length(regions::text)<=32768),
 check(background_reference_id is distinct from reference_id)
);
alter table public.photo_workspaces enable row level security;
create policy photo_workspace_read on public.photo_workspaces for select to authenticated using(public.can_access_project(project_id));
revoke all on public.photo_workspaces from public,anon,authenticated,service_role;
grant select on public.photo_workspaces to authenticated,service_role;
create function public.write_photo_workspace(p_project_id uuid,p_reference_id uuid,p_actor_id uuid,p_expected_revision integer,p_body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org uuid;v_row public.photo_workspaces;v_scene jsonb;v_cal jsonb;
begin
 select organisation_id into v_org from public.projects where id=p_project_id;
 perform 1 from public.organisations where id=v_org for update;
 if not public.actor_can_edit_project(p_project_id,p_actor_id) then raise exception 'Project edit access required' using errcode='42501';end if;
 if not exists(select 1 from public.room_references where id=p_reference_id and project_id=p_project_id and organisation_id=v_org) then raise exception 'Room photograph not found' using errcode='P0002';end if;
 select * into v_row from public.photo_workspaces where reference_id=p_reference_id for update;
 if coalesce(v_row.revision,0) is distinct from p_expected_revision then raise exception 'Photograph setup changed; reload before saving' using errcode='40001';end if;
 if nullif(p_body->>'backgroundReferenceId','') is not null and (p_body->>'backgroundReferenceId')::uuid is distinct from v_row.background_reference_id and not exists(
  select 1 from public.tenant_jobs where project_id=p_project_id and organisation_id=v_org and kind='photo_cleanup' and status='completed'
  and result->>'referenceId'=p_reference_id::text and result->>'workspaceRevision'=p_expected_revision::text and result->>'generatedReferenceId'=p_body->>'backgroundReferenceId'
 ) then raise exception 'Review a current completed photograph cleanup before applying it' using errcode='40001';end if;
 v_cal:=nullif(p_body->'calibration','null'::jsonb);
 if v_cal is not null then
  select data into v_scene from public.scenes where project_id=p_project_id;
  if v_cal->>'version' is distinct from '1' or v_scene#>>'{room,measurementsConfirmed}' is distinct from 'true'
   or (v_cal->>'roomWidth')::numeric is distinct from (v_scene#>>'{room,width}')::numeric or (v_cal->>'roomDepth')::numeric is distinct from (v_scene#>>'{room,depth}')::numeric then
   raise exception 'Confirm current room measurements before calibrating the photograph' using errcode='40001';end if;
 end if;
 insert into public.photo_workspaces(reference_id,project_id,organisation_id,calibration,regions,background_reference_id)
 values(p_reference_id,p_project_id,v_org,v_cal,p_body->'regions',(p_body->>'backgroundReferenceId')::uuid)
 on conflict(reference_id) do update set calibration=excluded.calibration,regions=excluded.regions,background_reference_id=excluded.background_reference_id,revision=photo_workspaces.revision+1,updated_at=now() returning * into v_row;
 return to_jsonb(v_row);
end $$;
revoke all on function public.write_photo_workspace(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.write_photo_workspace(uuid,uuid,uuid,integer,jsonb) to service_role;
alter table public.tenant_jobs drop constraint tenant_jobs_kind_check;
alter table public.tenant_jobs add constraint tenant_jobs_kind_check check(kind in ('ai_design','inventory_sync','cleanup_storage','cleanup_orphans','photo_analysis','photo_cleanup'));
create or replace function public.job_actor_authorised(p_kind text,p_org_id uuid,p_project_id uuid,p_actor_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select case when p_kind in ('ai_design','photo_analysis','photo_cleanup') or (p_kind='cleanup_storage' and p_project_id is not null) then p_project_id is not null and exists(select 1 from public.projects where id=p_project_id and organisation_id=p_org_id) and public.actor_can_edit_project(p_project_id,p_actor_id)
 else exists(select 1 from public.organisation_members where organisation_id=p_org_id and user_id=p_actor_id and role in ('owner','admin')) end
$$;
notify pgrst,'reload schema';

-- Share the existing hourly AI budget with image analysis and editing.
create or replace function public.job_ai_quota() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.kind in ('ai_design','photo_analysis','photo_cleanup') and ((select count(*) from public.tenant_jobs where actor_id=new.actor_id and kind in ('ai_design','photo_analysis','photo_cleanup') and created_at>now()-interval '1 hour')>=20
 or (select count(*) from public.tenant_jobs where organisation_id=new.organisation_id and kind in ('ai_design','photo_analysis','photo_cleanup') and created_at>now()-interval '1 hour')>=100) then
 raise exception 'AI hourly request capacity reached' using errcode='23514';end if;return new;end $$;
