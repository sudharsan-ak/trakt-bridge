import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";
import { normalizeList } from "@/lib/normalize";

// GET /sync/ratings/movies and /sync/ratings/shows
// https://docs.trakt.tv/reference/getsyncratingsget
export const GET = withTraktAuth(async (_request, accessToken) => {
  const [movies, shows] = await Promise.all([
    traktGet({ accessToken, path: "/sync/ratings/movies" }),
    traktGet({ accessToken, path: "/sync/ratings/shows" }),
  ]);

  return NextResponse.json({
    movies: normalizeList(movies),
    shows: normalizeList(shows),
  });
});
