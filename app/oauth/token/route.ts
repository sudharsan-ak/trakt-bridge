import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthorizationCode, exchangeRefreshToken, McpAuthError } from "@/lib/mcp-auth";

// OAuth 2.1 token endpoint. Handles both grant types ChatGPT will use:
// authorization_code (first link) and refresh_token (renewing an expired
// access token without re-linking). application/x-www-form-urlencoded body,
// per RFC 6749 — same as Trakt's own token endpoint convention, just a
// different content type (Trakt's is JSON; this one follows the OAuth spec
// ChatGPT expects for MCP resource servers).
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await request.json().catch(() => ({}))
    : Object.fromEntries(new URLSearchParams(await request.text()));

  const grantType = body.grant_type;
  const clientId = body.client_id;

  if (!clientId) {
    return NextResponse.json({ error: "invalid_request", error_description: "Missing client_id" }, { status: 400 });
  }

  try {
    if (grantType === "authorization_code") {
      const { code, code_verifier: codeVerifier, redirect_uri: redirectUri } = body;
      if (!code || !codeVerifier || !redirectUri) {
        return NextResponse.json(
          { error: "invalid_request", error_description: "Missing code, code_verifier, or redirect_uri" },
          { status: 400 }
        );
      }
      const tokens = await exchangeAuthorizationCode({ code, codeVerifier, redirectUri, clientId });
      return NextResponse.json(tokens);
    }

    if (grantType === "refresh_token") {
      const refreshToken = body.refresh_token;
      if (!refreshToken) {
        return NextResponse.json(
          { error: "invalid_request", error_description: "Missing refresh_token" },
          { status: 400 }
        );
      }
      const tokens = await exchangeRefreshToken({ refreshToken, clientId });
      return NextResponse.json(tokens);
    }

    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  } catch (err) {
    if (err instanceof McpAuthError) {
      return NextResponse.json({ error: err.code, error_description: err.message }, { status: 400 });
    }
    console.error("MCP token endpoint failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
