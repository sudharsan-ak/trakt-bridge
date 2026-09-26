import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// Service-role client — server-only. Never import this from a client component
// or route that returns its key to the browser. Bypasses Row Level Security,
// which is fine here since the only table it touches is our own token store.
export function getSupabaseAdmin() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export interface TraktTokenRow {
  id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO timestamp
  created_at: string;
  updated_at: string;
}

// Single-user app: we always store/read the one row with id = 1.
const TOKEN_ROW_ID = 1;

export async function saveTraktTokens(params: {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("trakt_tokens").upsert(
    {
      id: TOKEN_ROW_ID,
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
      expires_at: params.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    throw new Error(`Failed to save Trakt tokens: ${error.message}`);
  }
}

export async function getTraktTokens(): Promise<TraktTokenRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("trakt_tokens")
    .select("*")
    .eq("id", TOKEN_ROW_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read Trakt tokens: ${error.message}`);
  }

  return data;
}

// --- MCP-facing OAuth layer (ChatGPT <-> this server) ---
// Fully separate token space from trakt_tokens above. See
// supabase/migrations/0002_mcp_oauth.sql for the table shapes.

export interface McpAuthCodeRow {
  code: string;
  code_challenge: string;
  code_challenge_method: string;
  redirect_uri: string;
  client_id: string;
  scopes: string[];
  expires_at: string;
  created_at: string;
}

export async function saveMcpAuthCode(params: {
  code: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  clientId: string;
  scopes: string[];
  expiresAt: Date;
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("mcp_auth_codes").insert({
    code: params.code,
    code_challenge: params.codeChallenge,
    code_challenge_method: params.codeChallengeMethod,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    scopes: params.scopes,
    expires_at: params.expiresAt.toISOString(),
  });

  if (error) {
    throw new Error(`Failed to save MCP auth code: ${error.message}`);
  }
}

export async function consumeMcpAuthCode(code: string): Promise<McpAuthCodeRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("mcp_auth_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read MCP auth code: ${error.message}`);
  }
  if (!data) return null;

  // One-time use: delete immediately regardless of what the caller does next.
  await supabase.from("mcp_auth_codes").delete().eq("code", code);

  return data;
}

export interface McpTokenRow {
  access_token: string;
  refresh_token: string;
  client_id: string;
  scopes: string[];
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  created_at: string;
  updated_at: string;
}

export async function saveMcpToken(params: {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  scopes: string[];
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("mcp_tokens").insert({
    access_token: params.accessToken,
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    scopes: params.scopes,
    access_token_expires_at: params.accessTokenExpiresAt.toISOString(),
    refresh_token_expires_at: params.refreshTokenExpiresAt.toISOString(),
  });

  if (error) {
    throw new Error(`Failed to save MCP token: ${error.message}`);
  }
}

export async function getMcpTokenByAccessToken(accessToken: string): Promise<McpTokenRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("mcp_tokens")
    .select("*")
    .eq("access_token", accessToken)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read MCP token: ${error.message}`);
  }

  return data;
}

export async function getMcpTokenByRefreshToken(refreshToken: string): Promise<McpTokenRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("mcp_tokens")
    .select("*")
    .eq("refresh_token", refreshToken)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read MCP token by refresh token: ${error.message}`);
  }

  return data;
}

export async function deleteMcpTokenByAccessToken(accessToken: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("mcp_tokens").delete().eq("access_token", accessToken);
  if (error) {
    throw new Error(`Failed to delete MCP token: ${error.message}`);
  }
}
