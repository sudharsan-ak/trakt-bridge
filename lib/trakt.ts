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

function diagLog(event: string, fields: Record<string, unknown>) {
  if (process.env.TRAKT_DEBUG !== "1") return;
  // Safe by construction: callers only ever pass status/counts/ids/headers,
  // never the accessToken or any Trakt response body in full.
  console.log(`[trakt] ${event}`, JSON.stringify(fields));
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

  diagLog("request", {
    path,
    searchParams,
    status: res.status,
    pageCount: res.headers.get("x-pagination-page-count"),
    itemCount: res.headers.get("x-pagination-item-count"),
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new TraktRequestError(path, res.status, await safeText(res));
  }

  return res.json();
}

// Trakt paginates /sync/* list endpoints (default page size is small enough
// that any account with 100+ items in a section will silently lose older
// entries past page 1 if only page 1 is fetched — this bit /sync/watched/movies
// for a 128-item history). Follows X-Pagination-Page-Count and concatenates
// every page. Callers that need a full, order-independent list (watched,
// watchlist, collection, ratings) should use this instead of a single traktGet.
export async function traktGetAllPages<T>({
  accessToken,
  path,
  searchParams,
}: TraktRequestOptions): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  let pageCount = 1;

  do {
    const url = new URL(`${TRAKT_API_BASE}${path}`);
    const params = { ...searchParams, page, limit: 100 };
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": env.TRAKT_CLIENT_ID,
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "trakt-bridge/1.0",
      },
      cache: "no-store",
    });

    const pageCountHeader = res.headers.get("x-pagination-page-count");
    const itemCountHeader = res.headers.get("x-pagination-item-count");

    diagLog("paginatedRequest", {
      path,
      page,
      status: res.status,
      pageCountHeader,
      itemCountHeader,
    });

    if (res.status === 404) return results;

    if (!res.ok) {
      throw new TraktRequestError(path, res.status, await safeText(res));
    }

    const body = (await res.json()) as T[];
    results.push(...body);

    pageCount = pageCountHeader ? Number(pageCountHeader) : 1;
    page += 1;
  } while (page <= pageCount);

  return results;
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
