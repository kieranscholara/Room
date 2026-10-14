-- RoomSell foundation: tenant identities, authoritative scenes and real catalogues.
-- Authenticated clients never write scenes, membership, invitations or validated assets.
-- Server-only RPCs require a separately verified actor and repeat authorisation in SQL.
create extension if not exists pgcrypto with schema extensions;

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.organisation_members (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'salesperson', 'designer', 'customer')),
  joined_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create table public.organisation_invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  role text not null check (role in ('owner', 'admin', 'salesperson', 'designer', 'customer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  email text check (email is null or length(email) <= 254),
  phone text check (phone is null or length(phone) <= 50),
  notes text not null default '' check (length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  customer_id uuid,
  name text not null check (length(btrim(name)) between 1 and 100),
  budget_minor bigint not null default 0 check (budget_minor between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  style text not null default '' check (length(style) <= 100),
  room_type text not null default 'bedroom' check (length(room_type) between 1 and 100),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (customer_id, organisation_id) references public.customers(id, organisation_id)
);

create table public.project_access (
  project_id uuid not null,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (project_id, organisation_id) references public.projects(id, organisation_id) on delete cascade,
  foreign key (organisation_id, user_id) references public.organisation_members(organisation_id, user_id) on delete cascade
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null unique,
  name text not null check (length(btrim(name)) between 1 and 100),
  width_m numeric not null check (width_m between 2 and 30),
  depth_m numeric not null check (depth_m between 2 and 30),
  height_m numeric not null check (height_m between 2 and 6),
  measurements_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id, project_id),
  foreign key (project_id, organisation_id) references public.projects(id, organisation_id) on delete cascade
);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null unique,
  room_id uuid not null unique,
  version integer not null default 0 check (version >= 0),
  data jsonb not null,
  history jsonb not null default '[]' check (jsonb_typeof(history) = 'array' and jsonb_array_length(history) <= 100),
  future jsonb not null default '[]' check (jsonb_typeof(future) = 'array' and jsonb_array_length(future) <= 100),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (project_id, organisation_id) references public.projects(id, organisation_id) on delete cascade,
  foreign key (room_id, organisation_id, project_id) references public.rooms(id, organisation_id, project_id) on delete cascade,
  check (jsonb_typeof(data) = 'object' and data ->> 'schemaVersion' is not distinct from '2'
    and data ->> 'id' is not distinct from id::text and data ->> 'organisationId' is not distinct from organisation_id::text
    and data ->> 'version' is not distinct from version::text)
);

create table public.scene_versions (
  scene_id uuid not null,
  organisation_id uuid not null,
  version integer not null check (version >= 0),
  data jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (scene_id, version),
  foreign key (scene_id, organisation_id) references public.scenes(id, organisation_id) on delete cascade
);

create table public.scene_operations (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null,
  organisation_id uuid not null,
  version integer not null check (version >= 0),
  actor_id uuid not null references auth.users(id),
  operation jsonb not null check (jsonb_typeof(operation) = 'object'),
  created_at timestamptz not null default now(),
  unique (scene_id, version),
  foreign key (scene_id, organisation_id) references public.scenes(id, organisation_id) on delete cascade
);

create table public.scene_proposals (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null,
  organisation_id uuid not null,
  actor_id uuid not null references auth.users(id),
  base_version integer not null check (base_version >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (scene_id, organisation_id) references public.scenes(id, organisation_id) on delete cascade
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  sku text not null check (length(btrim(sku)) between 1 and 100),
  name text not null check (length(btrim(name)) between 1 and 100),
  category text not null check (category in ('bed', 'wardrobe', 'bedside', 'rug', 'desk')),
  price_minor bigint not null check (price_minor between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  width_m numeric not null check (width_m > 0 and width_m <= 20),
  depth_m numeric not null check (depth_m > 0 and depth_m <= 20),
  height_m numeric not null check (height_m > 0 and height_m <= 10),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  material text not null default '' check (length(material) <= 100),
  active boolean not null default true,
  availability text not null default 'in_stock' check (availability in ('in_stock', 'made_to_order', 'out_of_stock')),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  lead_time_days integer not null default 0 check (lead_time_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (organisation_id, sku)
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  product_id uuid not null,
  sku text not null check (length(btrim(sku)) between 1 and 100),
  name text not null check (length(btrim(name)) between 1 and 100),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  material text not null default '' check (length(material) <= 100),
  price_minor bigint not null check (price_minor between 0 and 9007199254740991),
  width_m numeric not null check (width_m > 0 and width_m <= 20),
  depth_m numeric not null check (depth_m > 0 and depth_m <= 20),
  height_m numeric not null check (height_m > 0 and height_m <= 10),
  availability text not null default 'in_stock' check (availability in ('in_stock', 'made_to_order', 'out_of_stock')),
  active boolean not null default true,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  lead_time_days integer not null default 0 check (lead_time_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id, product_id),
  unique (organisation_id, sku),
  foreign key (product_id, organisation_id) references public.products(id, organisation_id) on delete cascade
);

create table public.product_assets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  product_id uuid not null,
  variant_id uuid,
  bucket text not null default 'product-assets' check (bucket = 'product-assets'),
  path text not null unique check (split_part(path, '/', 1) = organisation_id::text),
  kind text not null check (kind in ('image', 'model')),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  width_m numeric check (width_m > 0),
  depth_m numeric check (depth_m > 0),
  height_m numeric check (height_m > 0),
  validation jsonb not null default '{}' check (jsonb_typeof(validation) = 'object'),
  status text not null default 'validated' check (status in ('validated', 'rejected')),
  created_at timestamptz not null default now(),
  foreign key (product_id, organisation_id) references public.products(id, organisation_id) on delete cascade,
  foreign key (variant_id, organisation_id, product_id) references public.product_variants(id, organisation_id, product_id) on delete cascade,
  check ((kind = 'image' and mime_type in ('image/png', 'image/jpeg', 'image/webp'))
    or (kind = 'model' and mime_type = 'model/gltf-binary' and width_m is not null and depth_m is not null and height_m is not null))
);

create table public.catalogue_imports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  file_name text not null check (length(file_name) between 1 and 255),
  status text not null check (status in ('completed', 'failed')),
  summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now()
);

create index organisation_members_user on public.organisation_members(user_id);
create index invitations_org on public.organisation_invitations(organisation_id);
create index customers_org on public.customers(organisation_id);
create index projects_org on public.projects(organisation_id);
create index project_access_user on public.project_access(user_id, project_id);
create index rooms_org on public.rooms(organisation_id);
create index scenes_org on public.scenes(organisation_id);
create index scene_proposals_actor on public.scene_proposals(actor_id, scene_id);
create index product_assets_product on public.product_assets(organisation_id, product_id);
create index catalogue_imports_org on public.catalogue_imports(organisation_id);

-- Helpers deliberately read membership with the definer to avoid recursive RLS.
-- A fixed search_path and fully qualified Auth/table names prevent object substitution.
create function public.organisation_role(p_org_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, public
as $$ select role from public.organisation_members where organisation_id = p_org_id and user_id = auth.uid() $$;

create function public.is_staff(p_org_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select coalesce(public.organisation_role(p_org_id) in ('owner', 'admin', 'salesperson', 'designer'), false) $$;

create function public.is_org_admin(p_org_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select coalesce(public.organisation_role(p_org_id) in ('owner', 'admin'), false) $$;

create function public.can_access_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select coalesce(exists (select 1 from public.projects p where p.id = p_project_id
  and (public.is_staff(p.organisation_id) or exists (select 1 from public.project_access a
    where a.project_id = p.id and a.organisation_id = p.organisation_id and a.user_id = auth.uid()))), false) $$;

create function public.can_edit_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select coalesce(exists (select 1 from public.projects p where p.id = p_project_id
  and (public.is_staff(p.organisation_id) or exists (select 1 from public.project_access a
    where a.project_id = p.id and a.organisation_id = p.organisation_id and a.user_id = auth.uid() and a.can_edit))), false) $$;

create function public.actor_can_edit_project(p_project_id uuid, p_actor_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select p_actor_id is not null and exists (select 1 from public.projects p
  join public.organisation_members m on m.organisation_id = p.organisation_id and m.user_id = p_actor_id
  where p.id = p_project_id and (m.role in ('owner', 'admin', 'salesperson', 'designer')
    or exists (select 1 from public.project_access a where a.project_id = p.id
      and a.organisation_id = p.organisation_id and a.user_id = p_actor_id and a.can_edit))) $$;

create function public.immutable_tenant() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.organisation_id is distinct from old.organisation_id or new.id is distinct from old.id then
    raise exception 'Tenant and row identity are immutable' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger customers_identity before update on public.customers for each row execute function public.immutable_tenant();
create trigger projects_identity before update on public.projects for each row execute function public.immutable_tenant();
create trigger rooms_identity before update on public.rooms for each row execute function public.immutable_tenant();
create trigger scenes_identity before update on public.scenes for each row execute function public.immutable_tenant();
create trigger products_identity before update on public.products for each row execute function public.immutable_tenant();
create trigger product_variants_identity before update on public.product_variants for each row execute function public.immutable_tenant();

alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.organisation_invitations enable row level security;
alter table public.customers enable row level security;
alter table public.projects enable row level security;
alter table public.project_access enable row level security;
alter table public.rooms enable row level security;
alter table public.scenes enable row level security;
alter table public.scene_versions enable row level security;
alter table public.scene_operations enable row level security;
alter table public.scene_proposals enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_assets enable row level security;
alter table public.catalogue_imports enable row level security;

create policy organisations_read on public.organisations for select to authenticated using (public.organisation_role(id) is not null);
create policy organisations_edit on public.organisations for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));
create policy memberships_read on public.organisation_members for select to authenticated using (user_id = auth.uid() or public.is_org_admin(organisation_id));
create policy invitations_read on public.organisation_invitations for select to authenticated using (public.is_org_admin(organisation_id));
create policy customers_read on public.customers for select to authenticated using (public.is_staff(organisation_id));
create policy customers_insert on public.customers for insert to authenticated with check (public.is_staff(organisation_id));
create policy customers_edit on public.customers for update to authenticated using (public.is_staff(organisation_id)) with check (public.is_staff(organisation_id));
create policy customers_delete on public.customers for delete to authenticated using (public.is_org_admin(organisation_id));
create policy projects_read on public.projects for select to authenticated using (public.can_access_project(id));
create policy projects_edit on public.projects for update to authenticated using (public.is_staff(organisation_id)) with check (public.is_staff(organisation_id));
create policy access_read on public.project_access for select to authenticated using (user_id = auth.uid() or public.is_org_admin(organisation_id));
create policy access_insert on public.project_access for insert to authenticated with check (public.is_org_admin(organisation_id));
create policy access_edit on public.project_access for update to authenticated using (public.is_org_admin(organisation_id)) with check (public.is_org_admin(organisation_id));
create policy access_delete on public.project_access for delete to authenticated using (public.is_org_admin(organisation_id));
create policy rooms_read on public.rooms for select to authenticated using (public.can_access_project(project_id));
create policy scenes_read on public.scenes for select to authenticated using (public.can_access_project(project_id));
create policy versions_read on public.scene_versions for select to authenticated using (exists (select 1 from public.scenes s where s.id = scene_id and public.can_access_project(s.project_id)));
create policy operations_read on public.scene_operations for select to authenticated using (exists (select 1 from public.scenes s where s.id = scene_id and public.can_access_project(s.project_id)));
create policy proposals_read on public.scene_proposals for select to authenticated using (actor_id = auth.uid() and exists (select 1 from public.scenes s where s.id = scene_id and public.can_edit_project(s.project_id)));
create policy products_read on public.products for select to authenticated using (public.is_staff(organisation_id));
create policy products_insert on public.products for insert to authenticated with check (public.is_org_admin(organisation_id));
create policy products_edit on public.products for update to authenticated using (public.is_org_admin(organisation_id)) with check (public.is_org_admin(organisation_id));
create policy products_delete on public.products for delete to authenticated using (public.is_org_admin(organisation_id));
create policy variants_read on public.product_variants for select to authenticated using (public.is_staff(organisation_id));
create policy variants_insert on public.product_variants for insert to authenticated with check (public.is_org_admin(organisation_id));
create policy variants_edit on public.product_variants for update to authenticated using (public.is_org_admin(organisation_id)) with check (public.is_org_admin(organisation_id));
create policy variants_delete on public.product_variants for delete to authenticated using (public.is_org_admin(organisation_id));
create policy assets_read on public.product_assets for select to authenticated using (public.is_staff(organisation_id));
create policy imports_read on public.catalogue_imports for select to authenticated using (public.is_org_admin(organisation_id));

create function public.create_organisation(p_name text, p_currency text default 'EUR') returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org public.organisations; v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.organisations(name, currency, created_by) values (btrim(p_name), upper(p_currency), v_actor) returning * into v_org;
  insert into public.organisation_members(organisation_id, user_id, role) values (v_org.id, v_actor, 'owner');
  return to_jsonb(v_org);
end $$;

create function public.list_members(p_org_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not public.is_org_admin(p_org_id) then raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'email', u.email, 'role', m.role, 'joinedAt', m.joined_at) order by m.joined_at)
    from public.organisation_members m join auth.users u on u.id = m.user_id where m.organisation_id = p_org_id), '[]');
end $$;

create function public.set_member_role(p_org_id uuid, p_user_id uuid, p_role text) returns jsonb
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
  return to_jsonb(v_member);
end $$;

create function public.create_invitation(p_org_id uuid, p_email text, p_role text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_invitation public.organisation_invitations; v_role text := public.organisation_role(p_org_id);
begin
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  if p_role = 'owner' and v_role <> 'owner' then raise exception 'Only an owner may invite another owner' using errcode = '42501'; end if;
  insert into public.organisation_invitations(organisation_id, email, role, token_hash, invited_by)
    values(p_org_id, lower(btrim(p_email)), p_role, p_token_hash, auth.uid()) returning * into v_invitation;
  return to_jsonb(v_invitation) - 'token_hash';
end $$;

create function public.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_invitation public.organisation_invitations; v_actor uuid := auth.uid(); v_email text;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = v_actor and email_confirmed_at is not null;
  select * into v_invitation from public.organisation_invitations where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found or v_invitation.accepted_at is not null or v_invitation.revoked_at is not null or v_invitation.expires_at <= now() or v_email is distinct from v_invitation.email then
    raise exception 'Invitation invalid, expired, used or addressed to another account' using errcode = '42501';
  end if;
  if exists (select 1 from public.organisation_members where organisation_id = v_invitation.organisation_id and user_id = v_actor) then
    raise exception 'Already a member of this organisation' using errcode = '23505';
  end if;
  insert into public.organisation_members(organisation_id, user_id, role) values(v_invitation.organisation_id, v_actor, v_invitation.role);
  update public.organisation_invitations set accepted_at = now(), accepted_by = v_actor where id = v_invitation.id;
  return jsonb_build_object('organisationId', v_invitation.organisation_id, 'userId', v_actor, 'role', v_invitation.role);
end $$;

create function public.revoke_invitation(p_org_id uuid, p_invitation_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not public.is_org_admin(p_org_id) then raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  update public.organisation_invitations set revoked_at = now() where id = p_invitation_id and organisation_id = p_org_id and accepted_at is null;
  if not found then raise exception 'Active invitation not found' using errcode = 'P0002'; end if;
end $$;

-- These RPCs can only be called by the application server's service role.
-- They verify actor permission again, but geometry/locks/catalogue validation belongs
-- to the server domain service; no authenticated RPC accepts replacement scene JSON.
create function public.create_project(p_org_id uuid, p_actor_id uuid, p_customer_id uuid, p_name text,
  p_budget_minor bigint, p_currency text, p_style text, p_room_type text, p_scene jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_project public.projects; v_room public.rooms; v_scene public.scenes; v_scene_id uuid := gen_random_uuid(); v_data jsonb;
begin
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

create function public.commit_scene(p_scene_id uuid, p_actor_id uuid, p_expected_version integer,
  p_scene jsonb, p_history jsonb, p_future jsonb, p_operation jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_scene public.scenes; v_data jsonb;
begin
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

-- Explicit grants avoid accidentally exposing newly created tables/functions.
revoke all on public.organisations, public.organisation_members, public.organisation_invitations, public.customers,
  public.projects, public.project_access, public.rooms, public.scenes, public.scene_versions,
  public.scene_operations, public.scene_proposals, public.products, public.product_variants,
  public.product_assets, public.catalogue_imports from anon, authenticated;
revoke all on function public.organisation_role(uuid), public.is_staff(uuid), public.is_org_admin(uuid),
  public.can_access_project(uuid), public.can_edit_project(uuid), public.actor_can_edit_project(uuid, uuid),
  public.immutable_tenant(), public.create_organisation(text, text), public.list_members(uuid),
  public.set_member_role(uuid, uuid, text), public.create_invitation(uuid, text, text, text),
  public.accept_invitation(text), public.revoke_invitation(uuid, uuid),
  public.create_project(uuid, uuid, uuid, text, bigint, text, text, text, jsonb),
  public.commit_scene(uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant select on public.organisations, public.organisation_members, public.organisation_invitations, public.customers,
  public.projects, public.project_access, public.rooms, public.scenes, public.scene_versions,
  public.scene_operations, public.scene_proposals, public.products, public.product_variants,
  public.product_assets, public.catalogue_imports to authenticated;
grant update(name, currency) on public.organisations to authenticated;
grant insert, update, delete on public.customers, public.project_access, public.products, public.product_variants to authenticated;
grant update(customer_id, name, budget_minor, currency, style, room_type, status) on public.projects to authenticated;
grant execute on function public.organisation_role(uuid), public.is_staff(uuid), public.is_org_admin(uuid),
  public.can_access_project(uuid), public.can_edit_project(uuid), public.create_organisation(text, text),
  public.list_members(uuid), public.set_member_role(uuid, uuid, text), public.create_invitation(uuid, text, text, text),
  public.accept_invitation(text), public.revoke_invitation(uuid, uuid) to authenticated;
grant all on public.organisations, public.organisation_members, public.organisation_invitations, public.customers,
  public.projects, public.project_access, public.rooms, public.scenes, public.scene_proposals,
  public.products, public.product_variants, public.product_assets, public.catalogue_imports to service_role;
revoke all on public.scene_versions, public.scene_operations from service_role;
grant select, insert on public.scene_versions, public.scene_operations to service_role;
grant execute on function public.actor_can_edit_project(uuid, uuid),
  public.create_project(uuid, uuid, uuid, text, bigint, text, text, text, jsonb),
  public.commit_scene(uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('product-assets', 'product-assets', false, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary'])
on conflict (id) do nothing;

-- A malformed first segment must yield false rather than a UUID cast error.
create function public.can_read_product_asset(p_path text) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_org uuid;
begin
  if split_part(p_path, '/', 1) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  v_org := split_part(p_path, '/', 1)::uuid;
  return public.is_staff(v_org);
end $$;
revoke all on function public.can_read_product_asset(text) from public, anon;
grant execute on function public.can_read_product_asset(text) to authenticated;
create policy product_assets_private_read on storage.objects for select to authenticated
  using (bucket_id = 'product-assets' and public.can_read_product_asset(name));
-- No authenticated Storage INSERT/UPDATE/DELETE policy: content validation must run
-- before a service-role upload. The server may issue scoped, short-lived signed URLs.

notify pgrst, 'reload schema';
