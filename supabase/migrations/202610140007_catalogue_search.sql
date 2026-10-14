-- One search value supports stable pagination across names and SKUs without
-- interpolating PostgREST filter expressions from user input.
alter table public.products add column search_document text
  generated always as (name || ' ' || sku) stored;
create index products_catalogue_order_idx on public.products(organisation_id, name, id);
notify pgrst, 'reload schema';
