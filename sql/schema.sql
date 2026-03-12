create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  project_key text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  actor text not null,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists sessions_project_status_idx on sessions(project_id, status);

create table if not exists session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists session_events_session_created_idx on session_events(session_id, created_at);
