import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktPost } from "@/lib/trakt";

// POST /sync/watchlist/remove — https://docs.trakt.tv/reference/postsyncwatchlistremove
//
// Removes a single movie or show from the user's watchlist. Same request/
// response convention as /api/trakt/mark-watched and /api/trakt/watchlist/add.
interface RemoveFromWatchlistRequestBody {
  traktId?: number;
  type?: "movie" | "show";
}

interface SyncWatchlistRemoveResponse {
  deleted: { movies: number; shows: number };
  not_found: { movies?: unknown[] | null; shows?: unknown[] | null };
}

export const POST = withTraktAuth(async (request, accessToken) => {
  const body = (await request.json().catch(() => null)) as RemoveFromWatchlistRequestBody | null;

  if (!body?.traktId || (body.type !== "movie" && body.type !== "show")) {
    return NextResponse.json(
      { error: "Request body must include 'traktId' (number) and 'type' ('movie' or 'show')" },
      { status: 400 }
    );
  }

  const key = body.type === "movie" ? "movies" : "shows";
  const result = await traktPost<SyncWatchlistRemoveResponse>({
    accessToken,
    path: "/sync/watchlist/remove",
    body: {
      [key]: [{ ids: { trakt: body.traktId } }],
    },
  });

  const notFound = (result.not_found[key] ?? []).length > 0;
  if (notFound) {
    return NextResponse.json(
      { success: false, error: `No ${body.type} found on Trakt with id ${body.traktId}` },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, traktId: body.traktId, type: body.type, action: "removed" });
});
