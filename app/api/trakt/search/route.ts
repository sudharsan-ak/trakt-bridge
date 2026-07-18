import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";
import { normalizeItem, normalizeList, type NormalizedItem } from "@/lib/normalize";

// GET /search/movie and /search/show — https://docs.trakt.tv/reference/getsearchquery
// Looks up a single title, then cross-references the top match against the
// user's watched/watchlist/ratings so ChatGPT can answer "have I seen X"
// without pulling the user's entire history (which is what /api/trakt/watched
// is for, and what blew past ChatGPT's response size limit).
interface SearchResult {
  type: "movie" | "show";
  movie?: Record<string, unknown>;
  show?: Record<string, unknown>;
}

function findMatch(entry: NormalizedItem[], traktId: number | null) {
  if (traktId === null) return undefined;
  return entry.find((item) => item.traktId === traktId);
}

export const GET = withTraktAuth(async (request, accessToken) => {
  const title = new URL(request.url).searchParams.get("title");
  if (!title) {
    return NextResponse.json({ error: "Missing required 'title' query parameter" }, { status: 400 });
  }

  const [movieResults, showResults] = await Promise.all([
    traktGet<SearchResult[]>({ accessToken, path: "/search/movie", searchParams: { query: title } }),
    traktGet<SearchResult[]>({ accessToken, path: "/search/show", searchParams: { query: title } }),
  ]);

  const topMovie = movieResults?.[0] ? normalizeItem(movieResults[0]) : null;
  const topShow = showResults?.[0] ? normalizeItem(showResults[0]) : null;

  if (!topMovie && !topShow) {
    return NextResponse.json({ found: false, movie: null, show: null });
  }

  async function withStatus(item: NormalizedItem, type: "movie" | "show") {
    const [watched, watchlist, ratings] = await Promise.all([
      traktGet<unknown>({ accessToken, path: `/sync/watched/${type}s` }),
      traktGet<unknown>({ accessToken, path: `/sync/watchlist/${type}s` }),
      traktGet<unknown>({ accessToken, path: `/sync/ratings/${type}s` }),
    ]);

    const watchedMatch = findMatch(normalizeList(watched), item.traktId);
    const watchlistMatch = findMatch(normalizeList(watchlist), item.traktId);
    const ratingMatch = findMatch(normalizeList(ratings), item.traktId);

    return {
      ...item,
      watched: Boolean(watchedMatch),
      lastWatchedAt: watchedMatch?.watchedAt ?? null,
      onWatchlist: Boolean(watchlistMatch),
      rating: ratingMatch?.rating ?? null,
    };
  }

  const [movie, show] = await Promise.all([
    topMovie ? withStatus(topMovie, "movie") : Promise.resolve(null),
    topShow ? withStatus(topShow, "show") : Promise.resolve(null),
  ]);

  return NextResponse.json({ found: true, movie, show });
});
