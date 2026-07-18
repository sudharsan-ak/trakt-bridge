import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";
import { normalizeList } from "@/lib/normalize";

// GET /sync/watchlist/movies and /sync/watchlist/shows
// https://docs.trakt.tv/reference/getsyncwatchlistget
export const GET = withTraktAuth(async (_request, accessToken) => {
  const [movies, shows] = await Promise.all([
    traktGet({ accessToken, path: "/sync/watchlist/movies" }),
    traktGet({ accessToken, path: "/sync/watchlist/shows" }),
  ]);

  return NextResponse.json({
    movies: normalizeList(movies),
    shows: normalizeList(shows),
  });
});
