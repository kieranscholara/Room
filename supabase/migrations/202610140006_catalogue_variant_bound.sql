-- Archived variants retain their IDs for historical scenes. The total number
-- of active and archived variants is bounded so a product stays representable
-- by the same DTO after every successful write.
create function public.enforce_catalogue_variant_bound() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.product_id is distinct from old.product_id then
    perform 1 from public.organisations where id = new.organisation_id for update;
    if (select count(*) from public.product_variants where organisation_id = new.organisation_id
      and product_id = new.product_id and id <> new.id) >= 100 then
      raise exception 'A product may have at most 100 variants, including archived variants' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_catalogue_variant_bound() from public, anon, authenticated;
create trigger product_variants_bounded before insert or update of product_id on public.product_variants
  for each row execute function public.enforce_catalogue_variant_bound();
notify pgrst, 'reload schema';
