-- Reservation and order authority lives in the same organisation transaction as catalogue writes.
alter table public.project_access add column can_order boolean not null default false;
drop function public.grant_project_access(uuid,uuid,uuid,boolean);
create function public.grant_project_access(p_org_id uuid,p_project_id uuid,p_user_id uuid,p_can_edit boolean,p_can_order boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_access public.project_access;
begin
 perform 1 from public.organisations where id=p_org_id for update;
 if not public.is_org_admin(p_org_id) then raise exception 'Organisation administrator required' using errcode='42501'; end if;
 if not exists(select 1 from public.projects where id=p_project_id and organisation_id=p_org_id) then raise exception 'Project not found' using errcode='42501'; end if;
 if not exists(select 1 from public.organisation_members where organisation_id=p_org_id and user_id=p_user_id and role='customer') then raise exception 'Customer membership required' using errcode='42501'; end if;
 insert into public.project_access(project_id,organisation_id,user_id,can_edit,can_order) values(p_project_id,p_org_id,p_user_id,p_can_edit,p_can_order)
 on conflict(project_id,user_id) do update set can_edit=excluded.can_edit,can_order=excluded.can_order returning * into v_access;
 return to_jsonb(v_access);
end $$;
revoke all on function public.grant_project_access(uuid,uuid,uuid,boolean,boolean) from public,anon;
grant execute on function public.grant_project_access(uuid,uuid,uuid,boolean,boolean) to authenticated;
create function public.actor_can_order_project(p_project_id uuid,p_actor_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.projects p join public.organisation_members m on m.organisation_id=p.organisation_id and m.user_id=p_actor_id
 where p.id=p_project_id and (m.role in ('owner','admin','salesperson','designer') or exists(select 1 from public.project_access a where a.project_id=p.id and a.user_id=p_actor_id and a.can_order)))
$$;
alter table public.quotations add constraint quotations_id_org unique(id,organisation_id);
create table public.retailer_orders (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null, project_id uuid not null, quotation_id uuid not null,
 created_by uuid not null references auth.users(id), idempotency_key uuid not null,
 status text not null default 'reserved' check(status in ('reserved','confirmed','cancelled','expired','fulfilled')),
 expires_at timestamptz not null default now()+interval '15 minutes',snapshot jsonb not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(quotation_id,idempotency_key),unique(id,organisation_id),
 foreign key(project_id,organisation_id) references public.projects(id,organisation_id),
 foreign key(quotation_id,organisation_id) references public.quotations(id,organisation_id)
);
create table public.order_items (
 order_id uuid not null,organisation_id uuid not null,product_id uuid not null,variant_id uuid not null,quantity integer not null check(quantity between 1 and 30),
 stock_tracked boolean not null,primary key(order_id,variant_id),
 foreign key(order_id,organisation_id) references public.retailer_orders(id,organisation_id) on delete cascade,
 foreign key(variant_id,organisation_id,product_id) references public.product_variants(id,organisation_id,product_id)
);
create index order_items_variant on public.order_items(variant_id,order_id);
create table public.order_events (
 id uuid primary key default gen_random_uuid(),order_id uuid not null,organisation_id uuid not null,actor_id uuid references auth.users(id),
 status text not null,created_at timestamptz not null default now(),
 foreign key(order_id,organisation_id) references public.retailer_orders(id,organisation_id) on delete cascade
);
alter table public.retailer_orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
create policy orders_read on public.retailer_orders for select to authenticated using(public.can_access_project(project_id));
create policy order_items_read on public.order_items for select to authenticated using(exists(select 1 from public.retailer_orders o where o.id=order_id and public.can_access_project(o.project_id)));
create policy order_events_read on public.order_events for select to authenticated using(exists(select 1 from public.retailer_orders o where o.id=order_id and public.can_access_project(o.project_id)));
revoke all on public.retailer_orders,public.order_items,public.order_events from public,anon,authenticated,service_role;
grant select on public.retailer_orders,public.order_items,public.order_events to authenticated,service_role;
create function public.immutable_order_snapshot() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.id is distinct from old.id or new.organisation_id is distinct from old.organisation_id or new.project_id is distinct from old.project_id
 or new.quotation_id is distinct from old.quotation_id or new.created_by is distinct from old.created_by or new.snapshot is distinct from old.snapshot
 or new.idempotency_key is distinct from old.idempotency_key then raise exception 'Order identity and commercial snapshot are immutable' using errcode='23514'; end if;
 return new;
end $$;
create trigger order_snapshot_immutable before update on public.retailer_orders for each row execute function public.immutable_order_snapshot();
create function public.available_variant_stock(p_variant_id uuid) returns integer
language sql stable security definer set search_path=pg_catalog,public as $$
 select greatest(0,v.stock_quantity-coalesce((select sum(i.quantity) from public.order_items i join public.retailer_orders o on o.id=i.order_id
 where i.variant_id=v.id and i.stock_tracked and (o.status='confirmed' or (o.status='reserved' and o.expires_at>now()))),0))::integer from public.product_variants v where v.id=p_variant_id
$$;
create function public.available_variant_stocks(p_variant_ids uuid[]) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_object_agg(id::text,public.available_variant_stock(id)),'{}'::jsonb) from unnest(p_variant_ids) id
$$;
create function public.expire_order_reservations(p_org_id uuid) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.retailer_orders; v_count integer:=0;
begin
 perform 1 from public.organisations where id=p_org_id for update;
 for v_order in update public.retailer_orders set status='expired',updated_at=now() where organisation_id=p_org_id and status='reserved' and expires_at<=now() returning * loop
  insert into public.order_events(order_id,organisation_id,status) values(v_order.id,p_org_id,'expired');v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
create function public.reserve_quotation_order(p_project_id uuid,p_actor_id uuid,p_quotation_id uuid,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_quote public.quotations;v_order public.retailer_orders;v_item jsonb;v_variant public.product_variants;v_product public.products;
begin
 select * into v_quote from public.quotations where id=p_quotation_id and project_id=p_project_id;
 if not found then raise exception 'Quotation not found' using errcode='P0002'; end if;
 perform 1 from public.organisations where id=v_quote.organisation_id for update;
 if not public.actor_can_order_project(p_project_id,p_actor_id) then raise exception 'Explicit project ordering permission required' using errcode='42501'; end if;
 perform public.expire_order_reservations(v_quote.organisation_id);
 select * into v_order from public.retailer_orders where quotation_id=p_quotation_id and idempotency_key=p_idempotency_key;
 if found then
  if v_order.created_by is distinct from p_actor_id then raise exception 'Order key belongs to another actor' using errcode='40001'; end if;
  return to_jsonb(v_order);
 end if;
 if exists(select 1 from public.retailer_orders where quotation_id=p_quotation_id and status in ('reserved','confirmed','fulfilled')) then raise exception 'This quotation already has an active or fulfilled order' using errcode='40001'; end if;
 for v_item in select value from jsonb_array_elements(v_quote.snapshot#>'{source,items}') loop
  select * into v_variant from public.product_variants where id=(v_item->>'variantId')::uuid and organisation_id=v_quote.organisation_id;
  select * into v_product from public.products where id=v_variant.product_id and organisation_id=v_quote.organisation_id;
  if not found or not v_variant.active or not v_product.active or v_variant.availability='out_of_stock' or v_product.availability='out_of_stock'
   or v_variant.sku is distinct from v_item->>'sku' or v_product.currency is distinct from v_item->>'currency'
   or v_variant.width_m is distinct from (v_item#>>'{dimensions,width}')::numeric or v_variant.depth_m is distinct from (v_item#>>'{dimensions,depth}')::numeric
   or v_variant.height_m is distinct from (v_item#>>'{dimensions,height}')::numeric then raise exception 'Quoted furniture needs retailer review before ordering' using errcode='40001'; end if;
  if v_variant.availability='in_stock' and public.available_variant_stock(v_variant.id)<(v_item->>'quantity')::integer then raise exception 'Insufficient unreserved variant stock' using errcode='40001'; end if;
 end loop;
 insert into public.retailer_orders(organisation_id,project_id,quotation_id,created_by,idempotency_key,snapshot)
 values(v_quote.organisation_id,p_project_id,p_quotation_id,p_actor_id,p_idempotency_key,v_quote.snapshot) returning * into v_order;
 for v_item in select value from jsonb_array_elements(v_quote.snapshot#>'{source,items}') loop
  insert into public.order_items(order_id,organisation_id,product_id,variant_id,quantity,stock_tracked)
   select v_order.id,v_quote.organisation_id,product_id,id,(v_item->>'quantity')::integer,availability='in_stock' from public.product_variants where id=(v_item->>'variantId')::uuid and organisation_id=v_quote.organisation_id;
 end loop;
 insert into public.order_events(order_id,organisation_id,actor_id,status) values(v_order.id,v_quote.organisation_id,p_actor_id,'reserved');return to_jsonb(v_order);
end $$;
create function public.transition_retailer_order(p_order_id uuid,p_actor_id uuid,p_expected_status text,p_action text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.retailer_orders;v_org_id uuid;v_status text;v_item public.order_items;v_variant public.product_variants;
begin
 select organisation_id into v_org_id from public.retailer_orders where id=p_order_id;
 perform 1 from public.organisations where id=v_org_id for update;
 select * into v_order from public.retailer_orders where id=p_order_id for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if not public.actor_can_order_project(v_order.project_id,p_actor_id) then raise exception 'Explicit project ordering permission required' using errcode='42501'; end if;
 perform public.expire_order_reservations(v_org_id);
 select * into v_order from public.retailer_orders where id=p_order_id;
 if v_order.status is distinct from p_expected_status then raise exception 'Order status changed; reload' using errcode='40001'; end if;
 if p_action='confirm' and v_order.status='reserved' then
  for v_item in select * from public.order_items where order_id=p_order_id and stock_tracked loop
   select * into v_variant from public.product_variants where id=v_item.variant_id;
   if v_variant.availability<>'in_stock' or v_variant.stock_quantity<(select coalesce(sum(i.quantity),0) from public.order_items i join public.retailer_orders o on o.id=i.order_id where i.variant_id=v_item.variant_id and i.stock_tracked and (o.status='confirmed' or (o.status='reserved' and o.expires_at>now()))) then raise exception 'Inventory changed; retailer review required' using errcode='40001'; end if;
  end loop;
  v_status:='confirmed';
 elsif p_action='cancel' and v_order.status in ('reserved','confirmed') then v_status:='cancelled';
 elsif p_action='fulfil' and v_order.status='confirmed' then
  if not exists(select 1 from public.organisation_members where organisation_id=v_org_id and user_id=p_actor_id and role in ('owner','admin','salesperson')) then raise exception 'Retailer fulfilment permission required' using errcode='42501'; end if;
  for v_item in select * from public.order_items where order_id=p_order_id and stock_tracked loop
   update public.product_variants set stock_quantity=stock_quantity-v_item.quantity,
    availability=case when stock_quantity-v_item.quantity=0 then 'out_of_stock' else availability end,updated_at=now()
    where id=v_item.variant_id and organisation_id=v_org_id and stock_quantity>=v_item.quantity;
   if not found then raise exception 'Physical stock changed; cannot fulfil' using errcode='40001'; end if;
  end loop;
  update public.products p set stock_quantity=s.stock,availability=case when s.in_stock then 'in_stock' when s.made_to_order then 'made_to_order' else 'out_of_stock' end,updated_at=now()
   from(select product_id,sum(stock_quantity)::integer as stock,bool_or(availability='in_stock' and stock_quantity>0) as in_stock,bool_or(availability='made_to_order') as made_to_order
    from public.product_variants where organisation_id=v_org_id and active and product_id in(select v.product_id from public.order_items i join public.product_variants v on v.id=i.variant_id where i.order_id=p_order_id) group by product_id) s where p.id=s.product_id and p.organisation_id=v_org_id;
  v_status:='fulfilled';
 else raise exception 'Invalid order transition' using errcode='23514'; end if;
 update public.retailer_orders set status=v_status,updated_at=now() where id=p_order_id returning * into v_order;
 insert into public.order_events(order_id,organisation_id,actor_id,status) values(v_order.id,v_org_id,p_actor_id,v_status);return to_jsonb(v_order);
end $$;
-- Cleanup of a project photograph is allowed to its current editors, not only managers.
create or replace function public.job_actor_authorised(p_kind text,p_org_id uuid,p_project_id uuid,p_actor_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select case when p_kind='ai_design' or (p_kind='cleanup_storage' and p_project_id is not null) then p_project_id is not null and public.actor_can_edit_project(p_project_id,p_actor_id)
 else exists(select 1 from public.organisation_members where organisation_id=p_org_id and user_id=p_actor_id and role in ('owner','admin')) end
$$;
alter table public.tenant_jobs add constraint job_result_bound check(result is null or octet_length(result::text)<=65536);
create function public.job_ai_quota() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.kind='ai_design' and ((select count(*) from public.tenant_jobs where actor_id=new.actor_id and kind='ai_design' and created_at>now()-interval '1 hour')>=20
  or (select count(*) from public.tenant_jobs where organisation_id=new.organisation_id and kind='ai_design' and created_at>now()-interval '1 hour')>=100) then
  raise exception 'AI hourly request capacity reached' using errcode='23514'; end if;return new;
end $$;
create trigger ai_quota before insert on public.tenant_jobs for each row execute function public.job_ai_quota();
revoke all on function public.actor_can_order_project(uuid,uuid),public.available_variant_stock(uuid),public.available_variant_stocks(uuid[]),
 public.expire_order_reservations(uuid),public.reserve_quotation_order(uuid,uuid,uuid,uuid),public.transition_retailer_order(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.actor_can_order_project(uuid,uuid),public.available_variant_stock(uuid),public.available_variant_stocks(uuid[]),
 public.expire_order_reservations(uuid),public.reserve_quotation_order(uuid,uuid,uuid,uuid),public.transition_retailer_order(uuid,uuid,text,text) to service_role;
create or replace function public.quotation_source(p_project_id uuid, p_actor_id uuid, p_expected_scene_version integer, p_expected_policy_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_project public.projects; v_org public.organisations; v_scene public.scenes; v_policy public.retailer_pricing_policies;
  v_customer public.customers; v_object jsonb; v_variant record; v_items jsonb;
begin
  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  select * into v_org from public.organisations where id = v_project.organisation_id for update;
  if p_actor_id is null or not exists(select 1 from public.organisation_members where organisation_id = v_project.organisation_id and user_id = p_actor_id and role in ('owner', 'admin', 'salesperson', 'designer')) then
    raise exception 'Staff membership required to price or issue quotations' using errcode = '42501';
  end if;
  select * into v_project from public.projects where id = p_project_id for update;
  select * into v_scene from public.scenes where project_id = p_project_id for update;
  if not found then raise exception 'Project scene not found' using errcode = 'P0002'; end if;
  if v_scene.version is distinct from p_expected_scene_version then raise exception 'Scene version changed; review the current scene' using errcode = '40001'; end if;
  select * into v_policy from public.retailer_pricing_policies where organisation_id = v_project.organisation_id;
  if not found then raise exception 'Configure the retailer pricing policy before quoting' using errcode = '23514'; end if;
  if v_policy.revision is distinct from p_expected_policy_revision then raise exception 'Pricing policy changed; preview the quotation again' using errcode = '40001'; end if;
  if v_policy.policy ->> 'currency' is distinct from v_project.currency then raise exception 'Project and retailer pricing currencies must match' using errcode = '23514'; end if;
  if v_scene.data #>> '{room,measurementsConfirmed}' is distinct from 'true' or jsonb_array_length(v_scene.data -> 'objects') = 0 then
    raise exception 'A measured scene containing real catalogue items is required' using errcode = '23514';
  end if;
  if v_project.customer_id is not null then select * into v_customer from public.customers where id = v_project.customer_id and organisation_id = v_project.organisation_id for share; end if;
  for v_object in select value from jsonb_array_elements(v_scene.data -> 'objects') loop
    select v.*, p.name as product_name, p.category as product_category, p.currency as product_currency,
      p.active as product_active, p.availability as product_availability into v_variant
      from public.product_variants v join public.products p on p.id = v.product_id and p.organisation_id = v.organisation_id
      where v.id::text = v_object ->> 'variantId' and v.organisation_id = v_project.organisation_id;
    if not found or not v_variant.active or not v_variant.product_active
      or v_variant.availability = 'out_of_stock' or v_variant.product_availability = 'out_of_stock'
      or v_variant.product_currency is distinct from v_project.currency
      or v_object ->> 'sku' is distinct from v_variant.sku or v_object ->> 'name' is distinct from v_variant.product_name
      or v_object ->> 'category' is distinct from v_variant.product_category or v_object ->> 'color' is distinct from v_variant.color
      or (v_object ->> 'solid')::boolean is distinct from (v_variant.product_category <> 'rug')
      or (v_object #>> '{dimensions,width}')::numeric is distinct from v_variant.width_m
      or (v_object #>> '{dimensions,depth}')::numeric is distinct from v_variant.depth_m
      or (v_object #>> '{dimensions,height}')::numeric is distinct from v_variant.height_m then
      raise exception 'A scene item is missing, unavailable or differs from its current catalogue variant' using errcode = '40001';
    end if;
  end loop;
  with counts as (
    select value ->> 'variantId' as variant_id, count(*)::integer as quantity,
      jsonb_agg(value ->> 'id' order by value ->> 'id') as object_ids
      from jsonb_array_elements(v_scene.data -> 'objects') group by value ->> 'variantId'
  )
  select jsonb_agg(jsonb_build_object('variantId', v.id, 'productId', p.id, 'objectIds', c.object_ids,
    'sku', v.sku, 'name', p.name, 'variantName', v.name, 'category', p.category, 'quantity', c.quantity,
    'unitPriceMinor', v.price_minor, 'currency', p.currency,
    'dimensions', jsonb_build_object('width', v.width_m, 'depth', v.depth_m, 'height', v.height_m),
    'color', v.color, 'material', v.material, 'availability', v.availability, 'stockQuantity', public.available_variant_stock(v.id),
    'leadTimeDays', v.lead_time_days, 'variantUpdatedAt', v.updated_at, 'productUpdatedAt', p.updated_at) order by v.id)
    into v_items from counts c join public.product_variants v on v.id::text = c.variant_id and v.organisation_id = v_project.organisation_id
      join public.products p on p.id = v.product_id and p.organisation_id = v.organisation_id;
  if exists(select 1 from jsonb_array_elements(v_items) item where item ->> 'availability' = 'in_stock' and (item ->> 'quantity')::integer > (item ->> 'stockQuantity')::integer) then
    raise exception 'Requested quantities exceed current variant stock; stock is not reserved by a quotation' using errcode = '40001';
  end if;
  return jsonb_build_object('version', 1, 'retailer', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'currency', v_org.currency),
    'project', jsonb_build_object('id', v_project.id, 'name', v_project.name, 'currency', v_project.currency, 'budgetMinor', v_project.budget_minor, 'customerId', v_project.customer_id),
    'customer', case when v_customer.id is null then null else jsonb_build_object('id', v_customer.id, 'name', v_customer.name, 'email', v_customer.email, 'phone', v_customer.phone) end,
    'sceneId', v_scene.id, 'sceneVersion', v_scene.version, 'policyRevision', v_policy.revision, 'policy', v_policy.policy, 'items', v_items);
end $$;


notify pgrst,'reload schema';
