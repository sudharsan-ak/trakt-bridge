import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";
import { normalizeList, type NormalizedItem } from "@/lib/normalize";

// GET /sync/watched/movies and /sync/watched/shows
// https://docs.trakt.tv/reference/getsyncwatched
//
// Accepts an optional ?genre= to filter server-side before returning. This
// account's full watched list (147 movies+shows combined and growing) is
// still comfortably under the Custom GPT Action response size limit today,
// but genre filtering exists so a query like "what comedies have I watched"
// doesn't need to grow the response as the account's history grows, and so
// it returns the *correct* full set of matches rather than an arbitrary
// truncated slice (a plain ?limit= would risk missing older matches).
//
// Fetching with extended=full is required to get genres at all — the
// default /sync/watched response doesn't include them.
function matchesGenre(item: NormalizedItem, genre: string): boolean {
  return item.genres.some((g) => g.toLowerCase() === genre.toLowerCase());
}

export const GET = withTraktAuth(async (request, accessToken) => {
  const genre = new URL(request.url).searchParams.get("genre");

  const [moviesRaw, showsRaw] = await Promise.all([
    traktGet({ accessToken, path: "/sync/watched/movies", searchParams: { extended: "full" } }),
    traktGet({ accessToken, path: "/sync/watched/shows", searchParams: { extended: "full" } }),
  ]);

  let movies = normalizeList(moviesRaw);
  let shows = normalizeList(showsRaw);

  if (genre) {
    movies = movies.filter((item) => matchesGenre(item, genre));
    shows = shows.filter((item) => matchesGenre(item, genre));
  }

  return NextResponse.json({ movies, shows });
});
