-- Job retention and account deletion must not erase or orphan issued image evidence.
alter table public.photo_compositions drop constraint photo_compositions_render_job_id_fkey;
alter table public.photo_compositions add constraint photo_compositions_render_job_id_fkey foreign key(render_job_id) references public.tenant_jobs(id) on delete set null;
alter table public.photo_compositions drop constraint photo_compositions_confirmed_by_fkey;
alter table public.quotation_photo_evidence drop constraint quotation_photo_evidence_quotation_id_fkey;
alter table public.quotation_photo_evidence add constraint quotation_photo_evidence_quotation_id_fkey foreign key(quotation_id) references public.quotations(id) on delete cascade;
notify pgrst,'reload schema';
