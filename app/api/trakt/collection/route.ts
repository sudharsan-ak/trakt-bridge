import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";
import { normalizeList } from "@/lib/normalize";

// GET /sync/collection/movies and /sync/collection/shows
// https://docs.trakt.tv/reference/getsynccollectionmovies
export const GET = withTraktAuth(async (_request, accessToken) => {
  const [movies, shows] = await Promise.all([
    traktGet({ accessToken, path: "/sync/collection/movies" }),
    traktGet({ accessToken, path: "/sync/collection/shows" }),
  ]);

  return NextResponse.json({
    movies: normalizeList(movies),
    shows: normalizeList(shows),
  });
});
