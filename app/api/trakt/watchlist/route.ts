import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGetAllPages } from "@/lib/trakt";
import { normalizeList } from "@/lib/normalize";

// GET /sync/watchlist/movies and /sync/watchlist/shows
// https://docs.trakt.tv/reference/getsyncwatchlistget
export const GET = withTraktAuth(async (_request, accessToken) => {
  const [movies, shows] = await Promise.all([
    traktGetAllPages({ accessToken, path: "/sync/watchlist/movies" }),
    traktGetAllPages({ accessToken, path: "/sync/watchlist/shows" }),
  ]);

  return NextResponse.json({
    movies: normalizeList(movies),
    shows: normalizeList(shows),
  });
});
