import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktPost } from "@/lib/trakt";

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

interface SyncHistoryResponse {
  added: { movies: number; episodes: number };
  not_found: { movies?: unknown[] | null; shows?: unknown[] | null };
}

export const POST = withTraktAuth(async (request, accessToken) => {
  const body = (await request.json().catch(() => null)) as MarkWatchedRequestBody | null;

  if (!body?.traktId || (body.type !== "movie" && body.type !== "show")) {
    return NextResponse.json(
      { error: "Request body must include 'traktId' (number) and 'type' ('movie' or 'show')" },
      { status: 400 }
    );
  }

  const key = body.type === "movie" ? "movies" : "shows";
  const result = await traktPost<SyncHistoryResponse>({
    accessToken,
    path: "/sync/history",
    body: {
      [key]: [
        {
          ids: { trakt: body.traktId },
          watched_at: body.watchedAt ?? new Date().toISOString(),
        },
      ],
    },
  });

  const notFound = (result.not_found[key] ?? []).length > 0;
  if (notFound) {
    return NextResponse.json(
      { success: false, error: `No ${body.type} found on Trakt with id ${body.traktId}` },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, traktId: body.traktId, type: body.type });
});
