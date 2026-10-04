-- Hodeum account data. Mirrors the learner's local SQLite after they sign in with Google.
-- Screenshots, audio and transcripts are never stored here.

create table public.skills (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  skill_id text not null,
  status text not null check (status in ('new', 'learning', 'mastered')),
  confidence real not null,
  success_count integer not null,
  failure_count integer not null,
  last_assistance_level text not null check (last_assistance_level in ('demonstrate', 'guide', 'hint', 'observe', 'independent')),
  last_seen_at timestamptz not null,
  primary key (user_id, skill_id)
);

create table public.hodes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  goal text not null,
  pack_id text,
  open boolean not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  outcome text check (outcome in ('completed', 'ended')),
  primary key (user_id, id)
);
create index hodes_started_at on public.hodes (user_id, started_at desc);

create table public.hode_events (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  hode_id text not null,
  seq integer not null,
  kind text not null,
  detail text,
  at timestamptz not null,
  primary key (user_id, hode_id, seq)
);

create table public.chats (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  title text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, id)
);

create table public.chat_messages (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  chat_id text not null,
  role text not null check (role in ('user', 'hodey')),
  content text not null,
  context text,
  web jsonb,
  at timestamptz not null,
  primary key (user_id, id)
);
create index chat_messages_chat on public.chat_messages (user_id, chat_id, at);

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- A signed-in PC. `live` is the notch's current Hode summary, null when idle.
create table public.devices (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  name text not null check (char_length(name) <= 100),
  last_seen_at timestamptz not null,
  live jsonb,
  primary key (user_id, id)
);

-- Web dashboard -> PC. The PC claims a pending command by moving it to a final status.
create table public.pc_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  device_id text not null,
  kind text not null check (kind in ('start_hode', 'end_hode')),
  goal text check (char_length(goal) <= 200),
  status text not null default 'pending' check (status in ('pending', 'started', 'ended', 'rejected', 'expired')),
  detail text,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index pc_commands_pending on public.pc_commands (user_id, device_id, status, created_at);

-- Every table: a learner sees and changes only their own rows.
do $$
declare t text;
begin
  foreach t in array array['skills', 'hodes', 'hode_events', 'chats', 'chat_messages', 'settings', 'devices', 'pc_commands'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Realtime: the PC hears commands; the dashboard hears progress and its PCs.
alter publication supabase_realtime add table public.pc_commands, public.devices, public.hodes, public.skills;
