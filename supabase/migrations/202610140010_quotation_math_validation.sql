-- Additive financial defence after quotation workflow migration 008.
-- The insert trigger prevents any trusted caller from persisting policy-invalid
-- maths, even when line/header conservation checks happen to balance.
-- Exact numeric counterparts of the BigInt calculator's half-up rounding and
-- largest-remainder allocation. This independently prevents a coherent but
-- policy-inconsistent calculation from ever becoming an issued snapshot.
create function public.quotation_math_matches_policy(p_source jsonb, p_calculation jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  with parameters as (
    select (p_source #>> '{policy,taxRateBps}')::numeric as tax_rate,
      (p_source #>> '{policy,discountBps}')::numeric as discount_rate,
      p_source #>> '{policy,rounding}' as rounding,
      p_source #>> '{policy,taxMode}' as tax_mode,
      (p_source #>> '{policy,feesTaxable}')::boolean as fees_taxable,
      case when p_source #>> '{policy,taxMode}' = 'inclusive' then 10000 + (p_source #>> '{policy,taxRateBps}')::numeric else 10000 end as tax_divisor
  ), items as (
    select item ->> 'variantId' as key, (item ->> 'unitPriceMinor')::numeric * (item ->> 'quantity')::numeric as subtotal
      from jsonb_array_elements(p_source -> 'items') item
  ), discount_numerators as (
    select items.*, subtotal * discount_rate as numerator from items cross join parameters
  ), discount_ranked as (
    select *, floor(numerator / 10000) as base_discount,
      row_number() over(order by mod(numerator, 10000) desc, key collate "C") as remainder_rank,
      floor((2 * sum(numerator) over() + 10000) / 20000) - sum(floor(numerator / 10000)) over() as residual
      from discount_numerators
  ), discounts as (
    select key, subtotal, case when rounding = 'per_line' then floor((2 * numerator + 10000) / 20000)
      else base_discount + case when remainder_rank <= residual then 1 else 0 end end as discount
      from discount_ranked cross join parameters
  ), tax_bases as (
    select key, 'item' as kind, subtotal, discount, subtotal - discount as base, true as taxable from discounts
    union all select '~fee:delivery', 'delivery', null, null, (p_source #>> '{policy,deliveryMinor}')::numeric, fees_taxable from parameters
    union all select '~fee:installation', 'installation', null, null, (p_source #>> '{policy,installationMinor}')::numeric, fees_taxable from parameters
  ), tax_numerators as (
    select tax_bases.*, case when taxable then base * tax_rate else 0 end as numerator, tax_divisor, rounding, tax_mode
      from tax_bases cross join parameters
  ), tax_ranked as (
    select *, floor(numerator / tax_divisor) as base_tax,
      row_number() over(order by mod(numerator, tax_divisor) desc, key collate "C") as remainder_rank,
      floor((2 * sum(numerator) over() + tax_divisor) / (2 * tax_divisor)) - sum(floor(numerator / tax_divisor)) over() as residual
      from tax_numerators
  ), rounded_tax as (
    select *, case when rounding = 'per_line' then floor((2 * numerator + tax_divisor) / (2 * tax_divisor))
      else base_tax + case when remainder_rank <= residual then 1 else 0 end end as tax from tax_ranked
  ), expected as (
    select *, case when tax_mode = 'inclusive' then base - tax else base end as net,
      case when tax_mode = 'inclusive' then base else base + tax end as total from rounded_tax
  ), actual as (
    select expected.*, case when kind = 'item' then
      (select line from jsonb_array_elements(p_calculation -> 'lines') line where line ->> 'variantId' = key)
      else p_calculation #> array['fees',kind] end as value from expected
  )
  select coalesce(bool_and(value ->> 'netMinor' is not distinct from net::text
    and value ->> 'taxMinor' is not distinct from tax::text and value ->> 'totalMinor' is not distinct from total::text
    and (kind <> 'item' or (value ->> 'subtotalMinor' is not distinct from subtotal::text and value ->> 'discountMinor' is not distinct from discount::text))), false)
    from actual
$$;

create function public.validate_quotation_snapshot_insert() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if not public.quotation_math_matches_policy(new.snapshot -> 'source', new.snapshot -> 'calculation') then
    raise exception 'Quotation calculation does not implement its retailer pricing policy' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger quotations_math_integrity before insert on public.quotations
  for each row execute function public.validate_quotation_snapshot_insert();
revoke all on function public.quotation_math_matches_policy(jsonb, jsonb), public.validate_quotation_snapshot_insert() from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
