import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { env } from "@/lib/env";
import { TRAKT_WEBSITE_BASE } from "@/lib/trakt";

// Step 1 of the OAuth authorization-code flow.
// https://docs.trakt.tv/reference/getoauthauthorize
//
// We redirect the browser to Trakt's own authorize page (note: trakt.tv,
// not api.trakt.tv). Trakt shows a login/allow-access screen, then redirects
// back to TRAKT_REDIRECT_URI with a one-time `code` we exchange in
// /api/trakt/callback.
export async function GET() {
  const state = randomBytes(16).toString("hex");

  const authorizeUrl = new URL("/oauth/authorize", TRAKT_WEBSITE_BASE);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", env.TRAKT_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", env.TRAKT_REDIRECT_URI);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl.toString());

  // Short-lived cookie so the callback can verify the redirect actually
  // originated from this login call (basic CSRF protection).
  response.cookies.set("trakt_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
