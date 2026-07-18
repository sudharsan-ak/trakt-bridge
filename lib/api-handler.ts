import { NextRequest, NextResponse } from "next/server";
import { env } from "./env";
import { getValidAccessToken } from "./trakt";

// Shared wrapper for every /api/trakt/* section endpoint: checks the
// x-api-key header, loads (and refreshes if needed) the stored Trakt access
// token, then hands both to the handler. Centralizes the 401/409 responses
// so each route file only contains its own Trakt calls + normalization.
export function withTraktAuth(
  handler: (request: NextRequest, accessToken: string) => Promise<NextResponse>
) {
  return async (request: NextRequest) => {
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey || apiKey !== env.RECOMMENDATION_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return NextResponse.json(
        { error: "Trakt account not connected yet. Visit /api/trakt/login first." },
        { status: 409 }
      );
    }

    return handler(request, accessToken);
  };
}
