-- Single-row table storing this app's Trakt OAuth tokens.
-- Accessed only via the Supabase service-role key from server-side code,
-- so Row Level Security stays disabled (there is no browser client).
create table if not exists trakt_tokens (
  id integer primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table trakt_tokens is 'Stores the single Trakt OAuth token set for trakt-bridge. Always one row (id = 1).';
