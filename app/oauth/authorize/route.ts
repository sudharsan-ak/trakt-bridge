import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { issueAuthorizationCode, isValidScopeList, OWNER_COOKIE_NAME, ALL_SCOPES } from "@/lib/mcp-auth";

// OAuth 2.1 authorization endpoint. ChatGPT redirects the user's browser
// here with standard authorization-code + PKCE params. We don't render a
// consent screen (single-user app, nothing to choose) — we just check the
// owner cookie set by /oauth/setup and, if present, redirect straight back
// to ChatGPT with a fresh authorization code. If the cookie is missing, we
// tell the visitor to complete /oauth/setup first instead of silently
// issuing a code to an unrecognized browser.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const responseType = params.get("response_type");
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method") ?? "S256";
  const requestedScope = params.get("scope");

  if (responseType !== "code") {
    return NextResponse.json({ error: "unsupported_response_type" }, { status: 400 });
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing client_id, redirect_uri, or code_challenge" },
      { status: 400 }
    );
  }
  if (codeChallengeMethod !== "S256") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Only the S256 code_challenge_method is supported" },
      { status: 400 }
    );
  }

  const scopes = (requestedScope ? requestedScope.split(" ") : [...ALL_SCOPES]).filter(Boolean);
  if (!isValidScopeList(scopes)) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }

  const ownerCookie = request.cookies.get(OWNER_COOKIE_NAME)?.value;
  if (!ownerCookie) {
    return NextResponse.json(
      {
        error: "access_denied",
        error_description: `This MCP server is private. Visit ${env.MCP_PUBLIC_URL}/oauth/setup?key=<your MCP_OWNER_KEY> once in this browser first, then retry linking.`,
      },
      { status: 403 }
    );
  }

  const code = await issueAuthorizationCode({
    codeChallenge,
    codeChallengeMethod,
    redirectUri,
    clientId,
    scopes,
  });

  const redirectTarget = new URL(redirectUri);
  redirectTarget.searchParams.set("code", code);
  if (state) redirectTarget.searchParams.set("state", state);

  return NextResponse.redirect(redirectTarget.toString());
}
