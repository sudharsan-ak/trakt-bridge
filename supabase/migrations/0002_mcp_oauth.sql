-- Tables for the MCP-facing OAuth 2.1 layer (ChatGPT <-> this server).
-- Fully separate from trakt_tokens: this is OUR authorization server's own
-- state (auth codes + access/refresh tokens we issue to ChatGPT), not the
-- Trakt account's tokens. Single-user app, so no users table — every row
-- here just represents "the one owner" by construction (gated upstream by
-- the owner cookie in /oauth/authorize).

create table if not exists mcp_auth_codes (
  code text primary key,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  redirect_uri text not null,
  client_id text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table mcp_auth_codes is 'Short-lived authorization codes issued by /oauth/authorize, consumed once by /oauth/token.';

create table if not exists mcp_tokens (
  access_token text primary key,
  refresh_token text not null unique,
  client_id text not null,
  scopes text[] not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table mcp_tokens is 'Access/refresh token pairs issued to ChatGPT by /oauth/token. Independent of trakt_tokens.';

create index if not exists mcp_tokens_refresh_token_idx on mcp_tokens (refresh_token);
