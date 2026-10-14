-- Private project references and a leased durable work queue. Never grants a worker a scene bypass.
create table public.room_references (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null,
 project_id uuid not null, uploaded_by uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 255), path text not null unique,
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
 size_bytes integer not null check(size_bytes between 1 and 10485760),
 created_at timestamptz not null default now(),
 foreign key(project_id,organisation_id) references public.projects(id,organisation_id) on delete cascade
);
alter table public.room_references enable row level security;
create policy references_read on public.room_references for select to authenticated using(public.can_access_project(project_id));
revoke all on public.room_references from public,anon,authenticated;
grant select on public.room_references to authenticated;
grant all on public.room_references to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('room-references','room-references',false,10485760,array['image/png','image/jpeg','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function public.can_read_room_reference(p_path text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.room_references r where r.path=p_path and public.can_access_project(r.project_id))
$$;
revoke all on function public.can_read_room_reference(text) from public,anon;
grant execute on function public.can_read_room_reference(text) to authenticated;
create policy room_references_private_read on storage.objects for select to authenticated
 using(bucket_id='room-references' and public.can_read_room_reference(name));
create function public.room_reference_write(p_project_id uuid,p_actor_id uuid,p_reference_id uuid,p_asset jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_project public.projects; v_row public.room_references;
begin
 select * into v_project from public.projects where id=p_project_id;
 if not found then raise exception 'Project not found' using errcode='P0002'; end if;
 perform 1 from public.organisations where id=v_project.organisation_id for update;
 if not public.actor_can_edit_project(p_project_id,p_actor_id) then raise exception 'Project edit access required' using errcode='42501'; end if;
 if p_asset is null then
  delete from public.room_references where id=p_reference_id and project_id=p_project_id returning * into v_row;
  if not found then raise exception 'Room reference not found' using errcode='P0002'; end if;
  return to_jsonb(v_row);
 end if;
 if (select count(*) from public.room_references where project_id=p_project_id)>=20 then raise exception 'At most twenty room photographs per project' using errcode='23514'; end if;
 if p_asset->>'path' is distinct from v_project.organisation_id::text||'/'||p_project_id::text||'/'||p_reference_id::text
  or not exists(select 1 from storage.objects where bucket_id='room-references' and name=p_asset->>'path') then
  raise exception 'Validated staged reference required' using errcode='23514'; end if;
 insert into public.room_references(id,organisation_id,project_id,uploaded_by,name,path,mime_type,size_bytes)
 values(p_reference_id,v_project.organisation_id,p_project_id,p_actor_id,p_asset->>'name',p_asset->>'path',p_asset->>'mimeType',(p_asset->>'sizeBytes')::integer) returning * into v_row;
 return to_jsonb(v_row);
end $$;

create table public.tenant_jobs (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
 project_id uuid, actor_id uuid not null references auth.users(id),
 kind text not null check(kind in ('ai_design','inventory_sync','cleanup_storage','cleanup_orphans')),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536),
 request_hash text not null check(request_hash~'^[0-9a-f]{64}$'), dedupe_key uuid not null,
 status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 available_at timestamptz not null default now(), lease_token uuid, lease_expires_at timestamptz,
 result jsonb, error_code text check(length(error_code)<=80),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organisation_id,actor_id,kind,dedupe_key),
 foreign key(project_id,organisation_id) references public.projects(id,organisation_id) on delete cascade
);
create index jobs_ready on public.tenant_jobs(status,available_at,created_at);
alter table public.tenant_jobs enable row level security;
create policy jobs_read on public.tenant_jobs for select to authenticated using(
 (actor_id=auth.uid() or public.is_org_admin(organisation_id))
 and (case when project_id is null then public.is_org_admin(organisation_id) else public.can_access_project(project_id) end));
revoke all on public.tenant_jobs from public,anon,authenticated;
grant select on public.tenant_jobs to authenticated,service_role;
create function public.job_actor_authorised(p_kind text,p_org_id uuid,p_project_id uuid,p_actor_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select case when p_kind='ai_design' then p_project_id is not null and public.actor_can_edit_project(p_project_id,p_actor_id)
 else exists(select 1 from public.organisation_members where organisation_id=p_org_id and user_id=p_actor_id and role in ('owner','admin')) end
$$;
create function public.enqueue_tenant_job(p_org_id uuid,p_project_id uuid,p_actor_id uuid,p_kind text,p_payload jsonb,p_dedupe_key uuid,p_request_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.tenant_jobs;
begin
 perform 1 from public.organisations where id=p_org_id for update;
 if not public.job_actor_authorised(p_kind,p_org_id,p_project_id,p_actor_id) then raise exception 'Current job permission required' using errcode='42501'; end if;
 select * into v_job from public.tenant_jobs where organisation_id=p_org_id and actor_id=p_actor_id and kind=p_kind and dedupe_key=p_dedupe_key;
 if found then
  if v_job.request_hash is distinct from p_request_hash or v_job.payload is distinct from p_payload or v_job.project_id is distinct from p_project_id then raise exception 'Job key already used for another request' using errcode='40001'; end if;
  return to_jsonb(v_job);
 end if;
 if (select count(*) from public.tenant_jobs where organisation_id=p_org_id and status in ('queued','running'))>=100 then raise exception 'Too many pending jobs' using errcode='23514'; end if;
 insert into public.tenant_jobs(organisation_id,project_id,actor_id,kind,payload,dedupe_key,request_hash)
 values(p_org_id,p_project_id,p_actor_id,p_kind,p_payload,p_dedupe_key,p_request_hash) returning * into v_job;
 return to_jsonb(v_job);
end $$;
create function public.claim_tenant_job() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_candidate record; v_job public.tenant_jobs;
begin
 for v_candidate in select id,organisation_id from public.tenant_jobs
  where (status='queued' and available_at<=now()) or (status='running' and lease_expires_at<now())
  order by created_at,id limit 100 loop
  perform 1 from public.organisations where id=v_candidate.organisation_id for update skip locked;
  if not found then continue; end if;
  select * into v_job from public.tenant_jobs where id=v_candidate.id and
   ((status='queued' and available_at<=now()) or (status='running' and lease_expires_at<now())) for update skip locked;
  if not found then continue; end if;
  if not public.job_actor_authorised(v_job.kind,v_job.organisation_id,v_job.project_id,v_job.actor_id) then
   update public.tenant_jobs set status='cancelled',result=null,error_code='permission_revoked',lease_token=null,lease_expires_at=null,updated_at=now() where id=v_job.id;
   continue;
  end if;
  if v_job.attempts>=3 then
   update public.tenant_jobs set status='failed',error_code='attempt_limit',lease_token=null,lease_expires_at=null,updated_at=now() where id=v_job.id; continue;
  end if;
  update public.tenant_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',updated_at=now()
   where id=v_job.id returning * into v_job;
  return to_jsonb(v_job);
 end loop;
 return null;
end $$;
create function public.finish_tenant_job(p_job_id uuid,p_lease_token uuid,p_result jsonb,p_error_code text,p_retryable boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.tenant_jobs; v_org_id uuid;
begin
 select organisation_id into v_org_id from public.tenant_jobs where id=p_job_id;
 perform 1 from public.organisations where id=v_org_id for update;
 select * into v_job from public.tenant_jobs where id=p_job_id for update;
 if not found or v_job.status<>'running' or v_job.lease_token is distinct from p_lease_token or v_job.lease_expires_at<=now() then raise exception 'Job lease is stale' using errcode='40001'; end if;
 if not public.job_actor_authorised(v_job.kind,v_job.organisation_id,v_job.project_id,v_job.actor_id) then
  update public.tenant_jobs set status='cancelled',result=null,error_code='permission_revoked',lease_token=null,lease_expires_at=null,updated_at=now() where id=p_job_id returning * into v_job;
 else
  update public.tenant_jobs set status=case when p_error_code is null then 'completed' when p_retryable and attempts<3 then 'queued' else 'failed' end,
   result=case when p_error_code is null then p_result else null end,error_code=p_error_code,
   available_at=now()+make_interval(secs=>attempts*5),lease_token=null,lease_expires_at=null,updated_at=now()
   where id=p_job_id returning * into v_job;
 end if;
 return to_jsonb(v_job);
end $$;
revoke all on function public.room_reference_write(uuid,uuid,uuid,jsonb),public.job_actor_authorised(text,uuid,uuid,uuid),
 public.enqueue_tenant_job(uuid,uuid,uuid,text,jsonb,uuid,text),public.claim_tenant_job(),public.finish_tenant_job(uuid,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.room_reference_write(uuid,uuid,uuid,jsonb),public.job_actor_authorised(text,uuid,uuid,uuid),
 public.enqueue_tenant_job(uuid,uuid,uuid,text,jsonb,uuid,text),public.claim_tenant_job(),public.finish_tenant_job(uuid,uuid,jsonb,text,boolean) to service_role;
notify pgrst,'reload schema';
