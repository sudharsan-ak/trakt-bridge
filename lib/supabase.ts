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
