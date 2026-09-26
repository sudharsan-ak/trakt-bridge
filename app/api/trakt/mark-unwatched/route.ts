import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { performTraktWrite } from "@/lib/write-actions";

// POST /sync/history/remove — https://docs.trakt.tv/reference/postsynchistoryremove
//
// Removes ALL watch history entries for a movie/show (every play, not just
// the most recent), matching how markWatched adds by Trakt ID rather than
// by a specific play/history-entry ID. Same required-search-first convention
// as the other write actions in this bridge.
interface MarkUnwatchedRequestBody {
  traktId?: number;
  type?: "movie" | "show";
}

export const POST = withTraktAuth(async (request, accessToken) => {
  const body = (await request.json().catch(() => null)) as MarkUnwatchedRequestBody | null;

  if (!body?.traktId || (body.type !== "movie" && body.type !== "show")) {
    return NextResponse.json(
      { error: "Request body must include 'traktId' (number) and 'type' ('movie' or 'show')" },
      { status: 400 }
    );
  }

  const result = await performTraktWrite(accessToken, "mark_unwatched", {
    traktId: body.traktId,
    type: body.type,
  });

  if (!result.success) {
    return NextResponse.json(result, { status: 404 });
  }

  return NextResponse.json({ success: true, traktId: result.traktId, type: result.type, action: result.action });
});
