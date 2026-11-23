-- Live progress of a push to OGD (the activity itself or its attendees), so
-- the page can show a progress bar and time left while the run works.
alter table public.activities
  add column if not exists ogd_progress jsonb;
