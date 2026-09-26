import { traktGet, traktGetAllPages } from "./trakt";
import { normalizeItem, normalizeList, type NormalizedItem } from "./normalize";

// Looks up a single title, then cross-references the top match against the
// user's watched/watchlist/ratings so callers can answer "have I seen X"
// without pulling the user's entire history (which is what /sync/watched
// is for, and what blew past ChatGPT's response size limit).
//
// Shared by the REST /api/trakt/search route and the MCP search_trakt_title
// tool so both stay in lockstep instead of drifting into two implementations.
interface SearchResult {
  type: "movie" | "show";
  movie?: Record<string, unknown>;
  show?: Record<string, unknown>;
}

export interface SearchTitleResult {
  found: boolean;
  movie: (NormalizedItem & { watched: boolean; lastWatchedAt: string | null; onWatchlist: boolean; rating: number | null }) | null;
  show: (NormalizedItem & { watched: boolean; lastWatchedAt: string | null; onWatchlist: boolean; rating: number | null }) | null;
}

function findMatch(entries: NormalizedItem[], traktId: number | null) {
  if (traktId === null) return undefined;
  return entries.find((item) => item.traktId === traktId);
}

export async function searchTraktTitle(accessToken: string, title: string): Promise<SearchTitleResult> {
  const [movieResults, showResults] = await Promise.all([
    traktGet<SearchResult[]>({ accessToken, path: "/search/movie", searchParams: { query: title } }),
    traktGet<SearchResult[]>({ accessToken, path: "/search/show", searchParams: { query: title } }),
  ]);

  const topMovie = movieResults?.[0] ? normalizeItem(movieResults[0]) : null;
  const topShow = showResults?.[0] ? normalizeItem(showResults[0]) : null;

  if (!topMovie && !topShow) {
    return { found: false, movie: null, show: null };
  }

  async function withStatus(item: NormalizedItem, type: "movie" | "show") {
    const [watched, watchlist, ratings] = await Promise.all([
      traktGetAllPages<unknown>({ accessToken, path: `/sync/watched/${type}s` }),
      traktGetAllPages<unknown>({ accessToken, path: `/sync/watchlist/${type}s` }),
      traktGetAllPages<unknown>({ accessToken, path: `/sync/ratings/${type}s` }),
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

  return { found: true, movie, show };
}
