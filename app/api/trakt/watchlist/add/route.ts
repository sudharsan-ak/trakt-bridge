import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { performTraktWrite } from "@/lib/write-actions";

// POST /sync/watchlist — https://docs.trakt.tv/reference/postsyncwatchlist
//
// Adds a single movie or show to the user's watchlist. Same request/response
// convention as /api/trakt/mark-watched: caller resolves a title to a Trakt
// ID via /api/trakt/search first, then passes that ID here.
interface AddToWatchlistRequestBody {
  traktId?: number;
  type?: "movie" | "show";
}

export const POST = withTraktAuth(async (request, accessToken) => {
  const body = (await request.json().catch(() => null)) as AddToWatchlistRequestBody | null;

  if (!body?.traktId || (body.type !== "movie" && body.type !== "show")) {
    return NextResponse.json(
      { error: "Request body must include 'traktId' (number) and 'type' ('movie' or 'show')" },
      { status: 400 }
    );
  }

  const result = await performTraktWrite(accessToken, "watchlist_add", {
    traktId: body.traktId,
    type: body.type,
  });

  if (!result.success) {
    return NextResponse.json(result, { status: 404 });
  }

  return NextResponse.json({ success: true, traktId: result.traktId, type: result.type, action: result.action });
});
