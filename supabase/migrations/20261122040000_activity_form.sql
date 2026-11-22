-- OGD's New Activity form as read by Oracle (fields, and the extra fields
-- each Type option brings), one per chapter, plus each activity's values
-- for those extra fields.
create table if not exists public.ogd_activity_forms (
  area_id bigint primary key references public.areas (id) on delete cascade,
  status text not null check (status in ('reading', 'read', 'failed')),
  schema jsonb,
  is_partial boolean not null default false,
  failure_code text,
  status_detail text,
  captured_at timestamptz,
  captured_by uuid
);
alter table public.ogd_activity_forms enable row level security;

alter table public.activities add column if not exists ogd_fields jsonb not null default '{}'::jsonb;
