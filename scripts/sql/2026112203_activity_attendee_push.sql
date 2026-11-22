-- Sending Oracle-added attendees into an activity's attendees in OGD.
-- Each attendee entry also carries "ogd": 'added' | 'failed' once tried.
alter table public.activities
  add column if not exists attendee_push_status text check (attendee_push_status in ('pushing', 'pushed', 'partial', 'failed')),
  add column if not exists attendee_push_failure_code text,
  add column if not exists attendee_push_detail text,
  add column if not exists attendees_pushed_at timestamptz;
