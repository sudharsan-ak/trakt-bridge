import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { env } from "@/lib/env";
import { getValidAccessToken } from "@/lib/trakt";
import { validateBearerToken, requireScope, McpAuthError } from "@/lib/mcp-auth";
import { buildMcpServer } from "@/lib/mcp-server";

// The MCP entry point ChatGPT calls after linking via /oauth/authorize +
// /oauth/token. Two separate checks happen before any tool runs:
//   1. The bearer token ChatGPT sends must be a valid, unexpired token we
//      issued (lib/mcp-auth.ts) — this is the ChatGPT <-> this server
//      relationship.
//   2. The Trakt account itself must be connected (lib/trakt.ts) — this is
//      the existing, unchanged this-server <-> Trakt relationship.
// Both must pass before a fresh MCP server/transport is built per request
// (stateless, matching Vercel's serverless model).
async function authenticate(request: NextRequest) {
  const context = await validateBearerToken(request.headers.get("authorization"));
  requireScope(context, "trakt.read");

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new McpAuthError("invalid_grant", "Trakt account not connected yet. Visit /api/trakt/login first.");
  }

  return accessToken;
}

function unauthorized(err: unknown) {
  const wwwAuthenticate = `Bearer resource_metadata="${env.MCP_PUBLIC_URL}/.well-known/oauth-protected-resource"`;
  if (err instanceof McpAuthError) {
    return NextResponse.json(
      { error: err.code, error_description: err.message },
      { status: 401, headers: { "WWW-Authenticate": wwwAuthenticate } }
    );
  }
  console.error("MCP auth failed:", err instanceof Error ? err.message : err);
  return NextResponse.json(
    { error: "server_error" },
    { status: 401, headers: { "WWW-Authenticate": wwwAuthenticate } }
  );
}

export async function POST(request: NextRequest) {
  let accessToken: string;
  try {
    accessToken = await authenticate(request);
  } catch (err) {
    return unauthorized(err);
  }

  const server = buildMcpServer(accessToken);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function GET(request: NextRequest) {
  try {
    await authenticate(request);
  } catch (err) {
    return unauthorized(err);
  }
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}

export async function DELETE(request: NextRequest) {
  try {
    await authenticate(request);
  } catch (err) {
    return unauthorized(err);
  }
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
