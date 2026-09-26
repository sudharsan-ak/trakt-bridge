import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { env } from "./env";
import {
  saveMcpAuthCode,
  consumeMcpAuthCode,
  saveMcpToken,
  getMcpTokenByAccessToken,
  getMcpTokenByRefreshToken,
  deleteMcpTokenByAccessToken,
} from "./supabase";

// Minimal OAuth 2.1 (authorization-code + PKCE) authorization server for the
// ChatGPT <-> this MCP server relationship. Fully independent of the
// Trakt <-> this server OAuth relationship in lib/trakt.ts — see the
// architecture note in that file for the two-relationship split.
//
// Single-user app: there is no user table. "Is this the owner" is decided
// upstream, in app/oauth/authorize/route.ts, via the owner cookie set by
// app/oauth/setup/route.ts. Everything in this file assumes that gate has
// already passed by the time an auth code gets issued.

export const OWNER_COOKIE_NAME = "mcp_owner";
export const ALL_SCOPES = ["trakt.read", "trakt.write"] as const;
export type McpScope = (typeof ALL_SCOPES)[number];

const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes, single-use anyway
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

// Cookie value is an opaque random token, not the owner key itself, so the
// key never sits in the browser beyond the one-time /oauth/setup visit.
export function generateOwnerCookieValue(): string {
  return randomToken();
}

export function ownerKeyMatches(providedKey: string | null): boolean {
  if (!providedKey) return false;
  const expected = Buffer.from(env.MCP_OWNER_KEY);
  const provided = Buffer.from(providedKey);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function isValidScopeList(scopes: string[]): scopes is McpScope[] {
  return scopes.length > 0 && scopes.every((s) => (ALL_SCOPES as readonly string[]).includes(s));
}

// --- PKCE (RFC 7636), S256 only ---

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- Authorization code issuance (called from /oauth/authorize) ---

export async function issueAuthorizationCode(params: {
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  clientId: string;
  scopes: McpScope[];
}): Promise<string> {
  const code = randomToken();
  await saveMcpAuthCode({
    code,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    redirectUri: params.redirectUri,
    clientId: params.clientId,
    scopes: params.scopes,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
  });
  return code;
}

// --- Token endpoint operations (called from /oauth/token) ---

export class McpAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "McpAuthError";
  }
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}) {
  const row = await consumeMcpAuthCode(params.code);
  if (!row) {
    throw new McpAuthError("invalid_grant", "Unknown or already-used authorization code");
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new McpAuthError("invalid_grant", "Authorization code expired");
  }
  if (row.redirect_uri !== params.redirectUri) {
    throw new McpAuthError("invalid_grant", "redirect_uri does not match the one used to request the code");
  }
  if (row.client_id !== params.clientId) {
    throw new McpAuthError("invalid_grant", "client_id does not match the one used to request the code");
  }
  if (!verifyPkce(params.codeVerifier, row.code_challenge)) {
    throw new McpAuthError("invalid_grant", "PKCE verification failed");
  }

  return issueTokenPair({ clientId: row.client_id, scopes: row.scopes as McpScope[] });
}

export async function exchangeRefreshToken(params: { refreshToken: string; clientId: string }) {
  const row = await getMcpTokenByRefreshToken(params.refreshToken);
  if (!row) {
    throw new McpAuthError("invalid_grant", "Unknown refresh token");
  }
  if (row.client_id !== params.clientId) {
    throw new McpAuthError("invalid_grant", "client_id does not match the token being refreshed");
  }
  if (new Date(row.refresh_token_expires_at).getTime() < Date.now()) {
    throw new McpAuthError("invalid_grant", "Refresh token expired");
  }

  // Rotate: delete the old pair, issue a brand new one.
  await deleteMcpTokenByAccessToken(row.access_token);
  return issueTokenPair({ clientId: row.client_id, scopes: row.scopes as McpScope[] });
}

async function issueTokenPair(params: { clientId: string; scopes: McpScope[] }) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const now = Date.now();

  await saveMcpToken({
    accessToken,
    refreshToken,
    clientId: params.clientId,
    scopes: params.scopes,
    accessTokenExpiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
    refreshTokenExpiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer" as const,
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: params.scopes.join(" "),
  };
}

// --- Bearer token validation (called from /api/mcp) ---

export interface McpAuthContext {
  clientId: string;
  scopes: McpScope[];
}

export async function validateBearerToken(authorizationHeader: string | null): Promise<McpAuthContext> {
  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new McpAuthError("invalid_token", "Missing or malformed Authorization header");
  }

  const row = await getMcpTokenByAccessToken(match[1]);
  if (!row) {
    throw new McpAuthError("invalid_token", "Unknown access token");
  }
  if (new Date(row.access_token_expires_at).getTime() < Date.now()) {
    throw new McpAuthError("invalid_token", "Access token expired");
  }

  return { clientId: row.client_id, scopes: row.scopes as McpScope[] };
}

export function requireScope(context: McpAuthContext, scope: McpScope) {
  if (!context.scopes.includes(scope)) {
    throw new McpAuthError("insufficient_scope", `This tool requires the '${scope}' scope`);
  }
}
