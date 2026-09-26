import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ALL_SCOPES } from "@/lib/mcp-auth";

// RFC 9728 protected resource metadata for the /mcp endpoint itself. Tells
// ChatGPT which authorization server issues tokens accepted here.
export async function GET() {
  const base = env.MCP_PUBLIC_URL;

  return NextResponse.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: [...ALL_SCOPES],
    bearer_methods_supported: ["header"],
  });
}
