import { env } from "./env";
import { getTraktTokens, saveTraktTokens, type TraktTokenRow } from "./supabase";

export const TRAKT_API_BASE = "https://api.trakt.tv";
export const TRAKT_WEBSITE_BASE = "https://trakt.tv";

interface TraktTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  created_at: number;
}

// POST /oauth/token — authorization_code grant.
// https://docs.trakt.tv/reference/postoauthtoken
export async function exchangeCodeForTokens(code: string): Promise<TraktTokenResponse> {
  const res = await fetch(`${TRAKT_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "trakt-bridge/1.0" },
    body: JSON.stringify({
      client_id: env.TRAKT_CLIENT_ID,
      client_secret: env.TRAKT_CLIENT_SECRET,
      redirect_uri: env.TRAKT_REDIRECT_URI,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`Trakt token exchange failed: ${res.status} ${await safeText(res)}`);
  }

  return res.json();
}

// POST /oauth/token — refresh_token grant.
// https://docs.trakt.tv/reference/postoauthtoken
async function refreshTokens(refreshToken: string): Promise<TraktTokenResponse> {
  const res = await fetch(`${TRAKT_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "trakt-bridge/1.0" },
    body: JSON.stringify({
      client_id: env.TRAKT_CLIENT_ID,
      client_secret: env.TRAKT_CLIENT_SECRET,
      redirect_uri: env.TRAKT_REDIRECT_URI,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Trakt token refresh failed: ${res.status} ${await safeText(res)}`);
  }

  return res.json();
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}

// Loads the stored token, refreshing it first if it's expired (or about to
// expire within the next 60s) and persisting the refreshed pair back to
// Supabase. Returns null if the user has never completed the OAuth flow.
export async function getValidAccessToken(): Promise<string | null> {
  const row: TraktTokenRow | null = await getTraktTokens();
  if (!row) return null;

  const expiresAt = new Date(row.expires_at).getTime();
  const isExpiringSoon = expiresAt - Date.now() < 60_000;

  if (!isExpiringSoon) {
    return row.access_token;
  }

  const refreshed = await refreshTokens(row.refresh_token);
  const newExpiresAt = new Date((refreshed.created_at + refreshed.expires_in) * 1000);

  await saveTraktTokens({
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: newExpiresAt,
  });

  return refreshed.access_token;
}

interface TraktRequestOptions {
  accessToken: string;
  path: string;
  searchParams?: Record<string, string | number | undefined>;
}

// Thin GET wrapper that attaches the required Trakt headers. Returns null on
// 404 and throws on other non-2xx statuses so callers can decide per-endpoint
// whether a failure should be fatal or just an empty section.
export async function traktGet<T>({
  accessToken,
  path,
  searchParams,
}: TraktRequestOptions): Promise<T | null> {
  const url = new URL(`${TRAKT_API_BASE}${path}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": env.TRAKT_CLIENT_ID,
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "trakt-bridge/1.0",
    },
    // Always fetch fresh data — this endpoint exists to answer "what's my
    // latest Trakt activity", so caching would defeat the point.
    cache: "no-store",
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new TraktRequestError(path, res.status, await safeText(res));
  }

  return res.json();
}

interface TraktPostOptions {
  accessToken: string;
  path: string;
  body: unknown;
}

// POST wrapper for the one write path this bridge exposes (marking watched).
// Unlike traktGet, a non-2xx here always throws — there's no "empty section"
// fallback that makes sense for a write the caller explicitly asked for.
export async function traktPost<T>({ accessToken, path, body }: TraktPostOptions): Promise<T> {
  const res = await fetch(`${TRAKT_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": env.TRAKT_CLIENT_ID,
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "trakt-bridge/1.0",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new TraktRequestError(path, res.status, await safeText(res));
  }

  return res.json();
}

export class TraktRequestError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Trakt request to ${path} failed: ${status} ${body}`);
    this.name = "TraktRequestError";
  }
}
