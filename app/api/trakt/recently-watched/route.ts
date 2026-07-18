import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";
import { normalizeList } from "@/lib/normalize";

// GET /sync/history/movies and /sync/history/shows
// https://docs.trakt.tv/reference/getsynchistoryget
// Accepts an optional ?limit= (default 20, most-recent-first per Trakt).
export const GET = withTraktAuth(async (request, accessToken) => {
  const limit = Number(new URL(request.url).searchParams.get("limit")) || 20;

  const [movies, shows] = await Promise.all([
    traktGet({ accessToken, path: "/sync/history/movies", searchParams: { limit } }),
    traktGet({ accessToken, path: "/sync/history/shows", searchParams: { limit } }),
  ]);

  return NextResponse.json({
    movies: normalizeList(movies),
    shows: normalizeList(shows),
  });
});
