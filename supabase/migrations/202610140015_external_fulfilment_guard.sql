-- Snapshot-only providers cannot acknowledge outbound orders. Fail closed until an actual order adapter is configured.
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
 elsif p_action='cancel' and v_order.status in ('reserved','confirmed') then v_status:='cancelled';
 elsif p_action='fulfil' and v_order.status='confirmed' then
  if exists(select 1 from public.order_items i join public.inventory_mappings m on m.variant_id=i.variant_id and m.organisation_id=i.organisation_id where i.order_id=p_order_id)
   and not exists(select 1 from public.organisations where id=v_org_id and is_test) then
   raise exception 'This inventory connector reads snapshots only. Configure upstream order acknowledgement before fulfilling externally managed stock.' using errcode='23514';
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
