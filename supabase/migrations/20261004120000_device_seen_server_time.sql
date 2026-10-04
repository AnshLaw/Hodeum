-- A PC's "last seen" is stamped by the server, not the PC: the web dashboard compares it with the browser's
-- clock, so a PC whose clock runs a minute off would otherwise look offline while it's running.
create or replace function public.stamp_device_seen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.last_seen_at := now();
  return new;
end;
$$;

-- Safe to run again: the project's first schema was applied by hand, so the CLI's migration history may not list this one.
drop trigger if exists devices_seen_now on public.devices;
create trigger devices_seen_now
before insert or update on public.devices
for each row execute function public.stamp_device_seen();
