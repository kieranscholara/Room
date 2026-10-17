-- Local image exports have no provider charge; keep them separate from the shared AI budget.
create or replace function public.job_ai_quota() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.kind='photo_render' and new.payload->>'provider'='local' then
  if (select count(*) from public.tenant_jobs where actor_id=new.actor_id and kind='photo_render' and payload->>'provider'='local' and created_at>now()-interval '1 hour')>=60 then raise exception 'Image export hourly capacity reached' using errcode='23514';end if;
 elsif new.kind in ('ai_design','photo_analysis','photo_cleanup','photo_render') then
  if (select count(*) from public.tenant_jobs where actor_id=new.actor_id and (kind in ('ai_design','photo_analysis','photo_cleanup') or (kind='photo_render' and payload->>'provider'='openai')) and created_at>now()-interval '1 hour')>=20
   or (select count(*) from public.tenant_jobs where organisation_id=new.organisation_id and (kind in ('ai_design','photo_analysis','photo_cleanup') or (kind='photo_render' and payload->>'provider'='openai')) and created_at>now()-interval '1 hour')>=100 then raise exception 'AI hourly request capacity reached' using errcode='23514';end if;
 end if;return new;
end $$;
