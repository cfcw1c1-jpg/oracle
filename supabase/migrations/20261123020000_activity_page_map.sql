-- What OGD's attendee page offered on the last attendee push (fields,
-- buttons, popups and grid headers; no field values), for fixing the add step.
alter table public.activities add column if not exists ogd_page_map text;
