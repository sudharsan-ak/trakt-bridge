import { NextRequest, NextResponse } from "next/server";
import { ownerKeyMatches, generateOwnerCookieValue, OWNER_COOKIE_NAME } from "@/lib/mcp-auth";

// One-time (or "whenever cookies are cleared") setup step for the account
// owner. Visit /oauth/setup?key=<MCP_OWNER_KEY> once in your own browser;
// this sets a long-lived cookie that /oauth/authorize checks on every future
// ChatGPT linking attempt, so the owner key itself never needs to be re-typed
// and is never seen by ChatGPT.
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");

  if (!ownerKeyMatches(key)) {
    return NextResponse.json({ error: "Invalid or missing key" }, { status: 403 });
  }

  const response = NextResponse.json({
    ok: true,
    message: "Owner cookie set. You can now complete the ChatGPT MCP connector linking flow from this browser.",
  });

  response.cookies.set(OWNER_COOKIE_NAME, generateOwnerCookieValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: "/",
  });

  return response;
}
