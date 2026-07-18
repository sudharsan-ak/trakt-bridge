import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";
import { normalizeList } from "@/lib/normalize";

// GET /recommendations/movies and /recommendations/shows
// https://docs.trakt.tv/reference/getrecommendationsmoviesrecommend
export const GET = withTraktAuth(async (_request, accessToken) => {
  const [movies, shows] = await Promise.all([
    traktGet({ accessToken, path: "/recommendations/movies", searchParams: { limit: 20 } }),
    traktGet({ accessToken, path: "/recommendations/shows", searchParams: { limit: 20 } }),
  ]);

  return NextResponse.json({
    movies: normalizeList(movies),
    shows: normalizeList(shows),
  });
});
