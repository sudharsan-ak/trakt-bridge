import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";
import { normalizeList } from "@/lib/normalize";

// GET /sync/watched/movies and /sync/watched/shows
// https://docs.trakt.tv/reference/getsyncwatched
export const GET = withTraktAuth(async (_request, accessToken) => {
  const [movies, shows] = await Promise.all([
    traktGet({ accessToken, path: "/sync/watched/movies" }),
    traktGet({ accessToken, path: "/sync/watched/shows" }),
  ]);

  return NextResponse.json({
    movies: normalizeList(movies),
    shows: normalizeList(shows),
  });
});
