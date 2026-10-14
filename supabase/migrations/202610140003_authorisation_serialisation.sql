-- Serialise role/access revocation with privileged invitations and scene commits.
-- Always lock the organisation first, then any invitation/scene row.
-- An existing bucket with the application name must also be private.
update storage.buckets set public = false, file_size_limit = 52428800,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary']
where id = 'product-assets';

create or replace function public.set_member_role(p_org_id uuid, p_user_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_member public.organisation_members; v_role text;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  v_role := public.organisation_role(p_org_id);
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  select * into v_member from public.organisation_members where organisation_id = p_org_id and user_id = p_user_id;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  if (v_member.role = 'owner' or p_role = 'owner') and v_role <> 'owner' then raise exception 'Only an owner may change ownership' using errcode = '42501'; end if;
  if v_member.role = 'owner' and p_role <> 'owner' and (select count(*) from public.organisation_members where organisation_id = p_org_id and role = 'owner') <= 1 then
    raise exception 'Cannot remove the last owner' using errcode = '23514';
  end if;
  update public.organisation_members set role = p_role where organisation_id = p_org_id and user_id = p_user_id returning * into v_member;
  update public.organisation_invitations set revoked_at = now()
    where organisation_id = p_org_id and invited_by = p_user_id and accepted_at is null and revoked_at is null
      and (p_role not in ('owner', 'admin') or (p_role <> 'owner' and role = 'owner'));
  return to_jsonb(v_member);
end $$;

create or replace function public.create_invitation(p_org_id uuid, p_email text, p_role text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_invitation public.organisation_invitations; v_role text := public.organisation_role(p_org_id);
begin
  perform 1 from public.organisations where id = p_org_id for update;
  v_role := public.organisation_role(p_org_id);
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  if p_role = 'owner' and v_role <> 'owner' then raise exception 'Only an owner may invite another owner' using errcode = '42501'; end if;
  insert into public.organisation_invitations(organisation_id, email, role, token_hash, invited_by)
    values(p_org_id, lower(btrim(p_email)), p_role, p_token_hash, auth.uid()) returning * into v_invitation;
  return to_jsonb(v_invitation) - 'token_hash';
end $$;

create or replace function public.revoke_invitation(p_org_id uuid, p_invitation_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not public.is_org_admin(p_org_id) then raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  update public.organisation_invitations set revoked_at = now() where id = p_invitation_id and organisation_id = p_org_id and accepted_at is null;
  if not found then raise exception 'Active invitation not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.grant_project_access(p_org_id uuid, p_project_id uuid, p_user_id uuid, p_can_edit boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_access public.project_access;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not public.is_org_admin(p_org_id) then
    raise exception 'Organisation administrator required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id and organisation_id = p_org_id) then
    raise exception 'Project not found in organisation' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_user_id and role = 'customer') then
    raise exception 'Customer membership required' using errcode = '42501';
  end if;
  insert into public.project_access(project_id, organisation_id, user_id, can_edit)
    values (p_project_id, p_org_id, p_user_id, p_can_edit)
    on conflict (project_id, user_id) do update set can_edit = excluded.can_edit
    returning * into v_access;
  return to_jsonb(v_access);
end $$;

create or replace function public.revoke_project_access(p_org_id uuid, p_project_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not public.is_org_admin(p_org_id) then
    raise exception 'Organisation administrator required' using errcode = '42501';
  end if;
  delete from public.project_access where organisation_id = p_org_id and project_id = p_project_id and user_id = p_user_id;
end $$;

create or replace function public.create_project(p_org_id uuid, p_actor_id uuid, p_customer_id uuid, p_name text,
  p_budget_minor bigint, p_currency text, p_style text, p_room_type text, p_scene jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_project public.projects; v_room public.rooms; v_scene public.scenes; v_scene_id uuid := gen_random_uuid(); v_data jsonb;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if p_actor_id is null or not exists (select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin', 'salesperson', 'designer')) then
    raise exception 'Staff membership required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_scene) <> 'object' or p_scene ->> 'schemaVersion' is distinct from '2' then raise exception 'Canonical scene v2 required' using errcode = '23514'; end if;
  insert into public.projects(organisation_id, customer_id, name, budget_minor, currency, style, room_type, created_by)
    values (p_org_id, p_customer_id, p_name, p_budget_minor, upper(p_currency), p_style, p_room_type, p_actor_id) returning * into v_project;
  insert into public.rooms(organisation_id, project_id, name, width_m, depth_m, height_m, measurements_confirmed)
    values(p_org_id, v_project.id, p_scene #>> '{room,name}', (p_scene #>> '{room,width}')::numeric,
      (p_scene #>> '{room,depth}')::numeric, (p_scene #>> '{room,height}')::numeric,
      (p_scene #>> '{room,measurementsConfirmed}')::boolean) returning * into v_room;
  v_data := p_scene || jsonb_build_object('id', v_scene_id, 'organisationId', p_org_id, 'version', 0);
  insert into public.scenes(id, organisation_id, project_id, room_id, data) values (v_scene_id, p_org_id, v_project.id, v_room.id, v_data) returning * into v_scene;
  insert into public.scene_versions(scene_id, organisation_id, version, data, created_by) values(v_scene.id, p_org_id, 0, v_data, p_actor_id);
  insert into public.scene_operations(scene_id, organisation_id, version, actor_id, operation) values(v_scene.id, p_org_id, 0, p_actor_id, jsonb_build_object('type', 'create'));
  return jsonb_build_object('project', to_jsonb(v_project), 'room', to_jsonb(v_room), 'scene', to_jsonb(v_scene));
end $$;

create or replace function public.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_invitation public.organisation_invitations; v_actor uuid := auth.uid(); v_email text;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = v_actor and email_confirmed_at is not null;
  select * into v_invitation from public.organisation_invitations where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then raise exception 'Invitation invalid' using errcode = '42501'; end if;
  perform 1 from public.organisations where id = v_invitation.organisation_id for update;
  select * into v_invitation from public.organisation_invitations where id = v_invitation.id for update;
  if not found or v_invitation.accepted_at is not null or v_invitation.revoked_at is not null or v_invitation.expires_at <= now() or v_email is distinct from v_invitation.email then
    raise exception 'Invitation invalid, expired, used or addressed to another account' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organisation_members where organisation_id = v_invitation.organisation_id
    and user_id = v_invitation.invited_by and role in ('owner', 'admin') and (v_invitation.role <> 'owner' or role = 'owner')) then
    raise exception 'Inviter is no longer authorised' using errcode = '42501';
  end if;
  if exists (select 1 from public.organisation_members where organisation_id = v_invitation.organisation_id and user_id = v_actor) then
    raise exception 'Already a member of this organisation' using errcode = '23505';
  end if;
  insert into public.organisation_members(organisation_id, user_id, role) values(v_invitation.organisation_id, v_actor, v_invitation.role);
  update public.organisation_invitations set accepted_at = now(), accepted_by = v_actor where id = v_invitation.id;
  return jsonb_build_object('organisationId', v_invitation.organisation_id, 'userId', v_actor, 'role', v_invitation.role);
end $$;

create or replace function public.commit_scene(p_scene_id uuid, p_actor_id uuid, p_expected_version integer,
  p_scene jsonb, p_history jsonb, p_future jsonb, p_operation jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_scene public.scenes; v_data jsonb;
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

create function public.remove_member(p_org_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_member public.organisation_members; v_role text;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  v_role := public.organisation_role(p_org_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Organisation administrator required' using errcode = '42501';
  end if;
  select * into v_member from public.organisation_members where organisation_id = p_org_id and user_id = p_user_id;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  if v_member.role = 'owner' and v_role <> 'owner' then
    raise exception 'Only an owner may remove another owner' using errcode = '42501';
  end if;
  if v_member.role = 'owner' and (select count(*) from public.organisation_members where organisation_id = p_org_id and role = 'owner') <= 1 then
    raise exception 'Cannot remove the last owner' using errcode = '23514';
  end if;
  update public.organisation_invitations set revoked_at = now()
    where organisation_id = p_org_id and invited_by = p_user_id and accepted_at is null and revoked_at is null;
  delete from public.organisation_members where organisation_id = p_org_id and user_id = p_user_id;
  -- Composite FK cascades remove explicit customer project permissions atomically.
end $$;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
