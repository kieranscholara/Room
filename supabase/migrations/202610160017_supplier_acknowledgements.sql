-- Idempotent custom REST supplier acknowledgements. Existing snapshots stay read-only unless explicitly configured.
alter table public.inventory_connections add column order_endpoint text;
alter table public.inventory_connections add constraint inventory_order_same_origin check (
 order_endpoint is null or (length(order_endpoint)<=2048 and order_endpoint ~ '^https://[^/?#@]+(/[^?#]*)?$'
 and split_part(order_endpoint,'/',3)=split_part(endpoint,'/',3))
);
create table public.supplier_fulfilments (
 order_id uuid primary key, organisation_id uuid not null, connection_id uuid not null,
 endpoint text not null, request jsonb not null, request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 receipt jsonb, created_at timestamptz not null default now(), completed_at timestamptz,
 foreign key(order_id,organisation_id) references public.retailer_orders(id,organisation_id) on delete cascade,
 foreign key(connection_id,organisation_id) references public.inventory_connections(id,organisation_id),
 check((receipt is null)=(completed_at is null))
);
alter table public.supplier_fulfilments enable row level security;
create policy supplier_fulfilments_read on public.supplier_fulfilments for select to authenticated using (
 exists(select 1 from public.retailer_orders o where o.id=order_id and public.can_access_project(o.project_id))
);
revoke all on public.supplier_fulfilments from public,anon,authenticated,service_role;
grant select on public.supplier_fulfilments to authenticated,service_role;

-- Pin credentials, mappings and stock while the supplier may have accepted a command.
-- A timeout leaves this fence in place. Retrying uses the exact same immutable request.
create function public.guard_pending_supplier_fulfilment() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_pending boolean; v_org uuid;
begin
 v_org:=coalesce((to_jsonb(old)->>'organisation_id')::uuid,(to_jsonb(new)->>'organisation_id')::uuid);
 perform 1 from public.organisations where id=v_org for update;
 if TG_TABLE_NAME='product_variants' then
  select exists(select 1 from public.supplier_fulfilments f join public.order_items i on i.order_id=f.order_id
   where f.receipt is null and i.variant_id in((to_jsonb(old)->>'id')::uuid,(to_jsonb(new)->>'id')::uuid)) into v_pending;
 else
  select exists(select 1 from public.supplier_fulfilments f where f.receipt is null and f.connection_id in(
   coalesce((to_jsonb(old)->>'connection_id')::uuid,(to_jsonb(old)->>'id')::uuid),
   coalesce((to_jsonb(new)->>'connection_id')::uuid,(to_jsonb(new)->>'id')::uuid))) into v_pending;
  if TG_TABLE_NAME='inventory_mappings' then
   v_pending:=v_pending or exists(select 1 from public.supplier_fulfilments f join public.order_items i on i.order_id=f.order_id where f.receipt is null and i.variant_id in((to_jsonb(old)->>'variant_id')::uuid,(to_jsonb(new)->>'variant_id')::uuid));
  end if;
 end if;
 if v_pending then raise exception 'Supplier fulfilment is pending. Retry acknowledgement before changing inventory or its connection.' using errcode='40001'; end if;
 if TG_OP='DELETE' then return old; else return new; end if;
end $$;
create trigger pending_supplier_connection before update or delete on public.inventory_connections for each row execute function public.guard_pending_supplier_fulfilment();
create trigger pending_supplier_mapping before insert or update or delete on public.inventory_mappings for each row execute function public.guard_pending_supplier_fulfilment();
create trigger pending_supplier_credential before update or delete on public.inventory_credentials for each row execute function public.guard_pending_supplier_fulfilment();
create trigger pending_supplier_stock before update or delete on public.product_variants for each row execute function public.guard_pending_supplier_fulfilment();

create or replace function public.inventory_connection_write(p_org_id uuid, p_actor_id uuid, p_connection_id uuid,
  p_expected_revision integer, p_config jsonb, p_token_envelope text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_connection public.inventory_connections;
begin
  perform 1 from public.organisations where id = p_org_id for update;
  if not exists(select 1 from public.organisation_members where organisation_id = p_org_id and user_id = p_actor_id and role in ('owner', 'admin')) then
    raise exception 'Organisation administrator required' using errcode = '42501'; end if;
  if p_connection_id is null then
    if p_token_envelope is null then raise exception 'A connector credential is required' using errcode = '23514'; end if;
    if (select count(*) from public.inventory_connections where organisation_id = p_org_id) >= 20 then
      raise exception 'An organisation supports at most twenty inventory connections' using errcode = '23514'; end if;
    insert into public.inventory_connections(organisation_id, name, provider, endpoint, enabled, order_endpoint)
      values(p_org_id, p_config ->> 'name', 'custom_rest', p_config ->> 'endpoint', (p_config ->> 'enabled')::boolean, p_config ->> 'orderEndpoint')
      returning * into v_connection;
  else
    select * into v_connection from public.inventory_connections where id = p_connection_id and organisation_id = p_org_id for update;
    if not found then raise exception 'Inventory connection not found' using errcode = 'P0002'; end if;
    if v_connection.revision is distinct from p_expected_revision then raise exception 'Inventory configuration changed; reload and retry' using errcode = '40001'; end if;
    update public.inventory_connections set name = p_config ->> 'name', endpoint = p_config ->> 'endpoint', enabled = (p_config ->> 'enabled')::boolean,
      order_endpoint = case when p_config ? 'orderEndpoint' then p_config ->> 'orderEndpoint' when split_part(endpoint,'/',3)=split_part(p_config->>'endpoint','/',3) then order_endpoint else null end,
      revision = revision + 1, updated_at = clock_timestamp() where id = v_connection.id returning * into v_connection;
  end if;
  if p_token_envelope is not null then
    insert into public.inventory_credentials(connection_id, organisation_id, token_envelope)
      values(v_connection.id, p_org_id, p_token_envelope)
      on conflict (connection_id) do update set token_envelope = excluded.token_envelope;
  end if;
  return to_jsonb(v_connection);
end $$;


create or replace function public.transition_retailer_order(p_order_id uuid,p_actor_id uuid,p_expected_status text,p_action text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.retailer_orders;v_org_id uuid;v_status text;v_item public.order_items;v_variant public.product_variants;
begin
 select organisation_id into v_org_id from public.retailer_orders where id=p_order_id;
 perform 1 from public.organisations where id=v_org_id for update;
 select * into v_order from public.retailer_orders where id=p_order_id for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if not public.actor_can_order_project(v_order.project_id,p_actor_id) then raise exception 'Explicit project ordering permission required' using errcode='42501'; end if;
 if v_order.created_by <> p_actor_id and not public.is_staff_actor(v_org_id,p_actor_id) then raise exception 'Only the buyer or retailer staff may manage this order' using errcode='42501'; end if;
 perform public.expire_order_reservations(v_org_id);
 select * into v_order from public.retailer_orders where id=p_order_id;
 if v_order.status is distinct from p_expected_status then raise exception 'Order status changed; reload' using errcode='40001'; end if;
 if p_action='confirm' and v_order.status='reserved' then
  for v_item in select * from public.order_items where order_id=p_order_id and stock_tracked loop
   select * into v_variant from public.product_variants where id=v_item.variant_id;
   if v_variant.availability<>'in_stock' or v_variant.stock_quantity<(select coalesce(sum(i.quantity),0) from public.order_items i join public.retailer_orders o on o.id=i.order_id where i.variant_id=v_item.variant_id and i.stock_tracked and (o.status='confirmed' or (o.status='reserved' and o.expires_at>now()))) then raise exception 'Inventory changed; retailer review required' using errcode='40001'; end if;
  end loop;
  v_status:='confirmed';
 elsif p_action='cancel' and v_order.status in ('reserved','confirmed') then
  if exists(select 1 from public.supplier_fulfilments where order_id=p_order_id and receipt is null) then raise exception 'Supplier fulfilment is pending. Retry acknowledgement before changing this order.' using errcode='40001'; end if;
  v_status:='cancelled';
 elsif p_action='fulfil' and v_order.status='confirmed' then
  if exists(select 1 from public.order_items i join public.inventory_mappings m on m.variant_id=i.variant_id and m.organisation_id=i.organisation_id where i.order_id=p_order_id)
   and not exists(select 1 from public.supplier_fulfilments where order_id=p_order_id and receipt is not null) then
   raise exception 'Supplier acknowledgement is required before fulfilling externally managed stock.' using errcode='23514';
  end if;
  if not exists(select 1 from public.organisation_members where organisation_id=v_org_id and user_id=p_actor_id and role in ('owner','admin','salesperson')) then raise exception 'Retailer fulfilment permission required' using errcode='42501'; end if;
  for v_item in select * from public.order_items where order_id=p_order_id and stock_tracked loop
   select * into v_variant from public.product_variants where id=v_item.variant_id;
   if v_variant.availability<>'in_stock' or v_variant.stock_quantity<(select coalesce(sum(i.quantity),0) from public.order_items i join public.retailer_orders o on o.id=i.order_id where i.variant_id=v_item.variant_id and i.stock_tracked and (o.status='confirmed' or (o.status='reserved' and o.expires_at>now()))) then raise exception 'Physical stock cannot cover outstanding orders; retailer review required' using errcode='40001'; end if;
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


create function public.begin_supplier_fulfilment(p_order_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org uuid;v_order public.retailer_orders;v_existing public.supplier_fulfilments;v_connection public.inventory_connections;
 v_count integer;v_request jsonb;v_hash text;v_item public.order_items;v_variant public.product_variants;
begin
 select organisation_id into v_org from public.retailer_orders where id=p_order_id;
 perform 1 from public.organisations where id=v_org for update;
 select * into v_order from public.retailer_orders where id=p_order_id for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if not public.actor_can_order_project(v_order.project_id,p_actor_id) or not exists(select 1 from public.organisation_members where organisation_id=v_org and user_id=p_actor_id and role in ('owner','admin','salesperson')) then
  raise exception 'Retailer fulfilment permission required' using errcode='42501'; end if;
 select * into v_existing from public.supplier_fulfilments where order_id=p_order_id;
 if found then
  if v_order.status not in ('confirmed','fulfilled') then raise exception 'Order status changed' using errcode='40001'; end if;
  return to_jsonb(v_existing);
 end if;
 if v_order.status<>'confirmed' then raise exception 'Confirmed order required' using errcode='40001'; end if;
 select count(distinct m.connection_id) into v_count from public.order_items i join public.inventory_mappings m on m.variant_id=i.variant_id and m.organisation_id=i.organisation_id where i.order_id=p_order_id;
 if v_count=0 then return null; end if;
 if v_count<>1 then raise exception 'One supplier connection per order is supported. Split this order before fulfilment.' using errcode='23514'; end if;
 select c.* into v_connection from public.inventory_connections c where c.id=(select m.connection_id from public.order_items i join public.inventory_mappings m on m.variant_id=i.variant_id and m.organisation_id=i.organisation_id where i.order_id=p_order_id limit 1);
 if not v_connection.enabled or v_connection.order_endpoint is null then raise exception 'Configure this supplier acknowledgement endpoint before fulfilment.' using errcode='23514'; end if;
 if exists(select 1 from public.supplier_fulfilments f where f.receipt is null and (f.connection_id=v_connection.id or exists(select 1 from public.order_items a join public.order_items b on a.variant_id=b.variant_id where a.order_id=p_order_id and b.order_id=f.order_id))) then
  raise exception 'Another supplier fulfilment is pending for this stock. Recover that order first.' using errcode='40001'; end if;
 for v_item in select * from public.order_items where order_id=p_order_id and stock_tracked loop
  select * into v_variant from public.product_variants where id=v_item.variant_id;
  if v_variant.availability<>'in_stock' or v_variant.stock_quantity<(select coalesce(sum(i.quantity),0) from public.order_items i join public.retailer_orders o on o.id=i.order_id where i.variant_id=v_item.variant_id and i.stock_tracked and (o.status='confirmed' or (o.status='reserved' and o.expires_at>now()))) then
   raise exception 'Physical stock cannot cover outstanding orders; retailer review required' using errcode='40001'; end if;
 end loop;
 select jsonb_build_object('schemaVersion',1,'orderId',p_order_id,'currency',v_order.snapshot#>>'{source,project,currency}',
  'items',jsonb_agg(jsonb_build_object('externalProductId',m.external_product_id,'externalVariantId',m.external_variant_id,'sku',v.sku,'quantity',i.quantity) order by m.external_product_id,m.external_variant_id))
 into v_request from public.order_items i join public.inventory_mappings m on m.variant_id=i.variant_id and m.organisation_id=i.organisation_id join public.product_variants v on v.id=i.variant_id where i.order_id=p_order_id;
 v_hash:=encode(extensions.digest(v_request::text,'sha256'),'hex');
 insert into public.supplier_fulfilments(order_id,organisation_id,connection_id,endpoint,request,request_hash)
 values(p_order_id,v_org,v_connection.id,v_connection.order_endpoint,v_request||jsonb_build_object('requestHash',v_hash),v_hash) returning * into v_existing;
 return to_jsonb(v_existing);
end $$;
create function public.finish_supplier_fulfilment(p_order_id uuid,p_actor_id uuid,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org uuid;v_existing public.supplier_fulfilments;v_order public.retailer_orders;
begin
 select organisation_id into v_org from public.retailer_orders where id=p_order_id;
 perform 1 from public.organisations where id=v_org for update;
 select * into v_order from public.retailer_orders where id=p_order_id for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if not public.actor_can_order_project(v_order.project_id,p_actor_id) or not exists(select 1 from public.organisation_members where organisation_id=v_org and user_id=p_actor_id and role in ('owner','admin','salesperson')) then raise exception 'Retailer fulfilment permission required' using errcode='42501'; end if;
 select * into v_existing from public.supplier_fulfilments where order_id=p_order_id for update;
 if not found then raise exception 'Supplier request not found' using errcode='P0002'; end if;
 if v_existing.receipt is not null then
  if p_receipt is distinct from v_existing.receipt then raise exception 'Supplier receipt changed' using errcode='40001'; end if;
  return to_jsonb(v_order);
 end if;
 if jsonb_typeof(p_receipt) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_receipt))<>5
  or p_receipt->'schemaVersion' is distinct from '1'::jsonb or p_receipt->>'orderId' is distinct from p_order_id::text
  or p_receipt->>'requestHash' is distinct from v_existing.request_hash or p_receipt->>'status' is distinct from 'accepted'
  or jsonb_typeof(p_receipt->'supplierReference') is distinct from 'string' or length(btrim(p_receipt->>'supplierReference')) not between 1 and 200
 then raise exception 'Invalid supplier acknowledgement' using errcode='23514'; end if;
 update public.supplier_fulfilments set receipt=p_receipt,completed_at=now() where order_id=p_order_id;
 return public.transition_retailer_order(p_order_id,p_actor_id,'confirmed','fulfil');
end $$;
revoke all on function public.begin_supplier_fulfilment(uuid,uuid),public.finish_supplier_fulfilment(uuid,uuid,jsonb),public.guard_pending_supplier_fulfilment() from public,anon,authenticated;
grant execute on function public.begin_supplier_fulfilment(uuid,uuid),public.finish_supplier_fulfilment(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
