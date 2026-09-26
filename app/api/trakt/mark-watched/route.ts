import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { performTraktWrite } from "@/lib/write-actions";

// POST /sync/history — https://docs.trakt.tv/reference/postsynchistoryadd
//
// The one write endpoint in this otherwise read-only bridge. Callers are
// expected to resolve a title to a Trakt ID via /api/trakt/search first
// (which returns a poster + year for the caller to confirm with the user)
// rather than passing a raw title here — marking the wrong item watched
// isn't reversible through this API, and titles are ambiguous in a way
// Trakt IDs aren't.
interface MarkWatchedRequestBody {
  traktId?: number;
  type?: "movie" | "show";
  watchedAt?: string;
}

export const POST = withTraktAuth(async (request, accessToken) => {
  const body = (await request.json().catch(() => null)) as MarkWatchedRequestBody | null;

  if (!body?.traktId || (body.type !== "movie" && body.type !== "show")) {
    return NextResponse.json(
      { error: "Request body must include 'traktId' (number) and 'type' ('movie' or 'show')" },
      { status: 400 }
    );
  }

  const result = await performTraktWrite(accessToken, "mark_watched", {
    traktId: body.traktId,
    type: body.type,
    watchedAt: body.watchedAt,
  });

  if (!result.success) {
    return NextResponse.json(result, { status: 404 });
  }

  return NextResponse.json({ success: true, traktId: result.traktId, type: result.type });
});
