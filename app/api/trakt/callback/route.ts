import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/trakt";
import { saveTraktTokens } from "@/lib/supabase";

// Step 2 of the OAuth authorization-code flow.
// https://docs.trakt.tv/reference/postoauthtoken
//
// Trakt redirects here with ?code=...&state=.... We verify state against the
// cookie set in /api/trakt/login, exchange the code for an access/refresh
// token pair, and store it server-side in Supabase. The tokens never reach
// the browser response body.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = request.cookies.get("trakt_oauth_state")?.value;

  if (!code) {
    return NextResponse.json({ error: "Missing 'code' query parameter" }, { status: 400 });
  }

  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.json({ error: "Invalid or missing OAuth state" }, { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date((tokens.created_at + tokens.expires_in) * 1000);

    await saveTraktTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    });

    const response = NextResponse.json({
      ok: true,
      message: "Trakt account connected. You can now call /api/trakt/recommendation-context.",
    });
    response.cookies.delete("trakt_oauth_state");
    return response;
  } catch (err) {
    console.error("Trakt OAuth callback failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to complete Trakt authorization" }, { status: 502 });
  }
}
