-- Customer project permissions are changed through one checked operation.
-- Removing direct writes prevents changing tenant/project/user identities piecemeal.
revoke insert, update, delete on public.project_access from authenticated;

create function public.grant_project_access(p_org_id uuid, p_project_id uuid, p_user_id uuid, p_can_edit boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_access public.project_access;
begin
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

create function public.revoke_project_access(p_org_id uuid, p_project_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'Organisation administrator required' using errcode = '42501';
  end if;
  delete from public.project_access where organisation_id = p_org_id and project_id = p_project_id and user_id = p_user_id;
end $$;

revoke all on function public.grant_project_access(uuid, uuid, uuid, boolean), public.revoke_project_access(uuid, uuid, uuid) from public, anon;
grant execute on function public.grant_project_access(uuid, uuid, uuid, boolean), public.revoke_project_access(uuid, uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
