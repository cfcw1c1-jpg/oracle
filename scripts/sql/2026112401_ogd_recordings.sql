-- Private bucket for recordings (Playwright traces) of OGD pushes, for
-- troubleshooting. Only the server (service role) reads or writes it.
insert into storage.buckets (id, name, public)
values ('ogd-recordings', 'ogd-recordings', false)
on conflict (id) do nothing;
