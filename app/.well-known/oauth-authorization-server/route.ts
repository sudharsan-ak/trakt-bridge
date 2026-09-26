import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ALL_SCOPES } from "@/lib/mcp-auth";

// RFC 8414 authorization server metadata. ChatGPT fetches this to discover
// our /oauth/authorize and /oauth/token endpoints before starting the
// OAuth 2.1 + PKCE flow.
export async function GET() {
  const base = env.MCP_PUBLIC_URL;

  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...ALL_SCOPES],
  });
}
