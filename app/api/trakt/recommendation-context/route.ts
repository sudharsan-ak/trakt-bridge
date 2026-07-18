import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getValidAccessToken, traktGet } from "@/lib/trakt";
import { normalizeList, type NormalizedItem } from "@/lib/normalize";

// The single endpoint ChatGPT calls. Protected by a static API key (not
// OAuth) since the caller is a Custom GPT Action, not the Trakt user's
// browser. Reads the stored Trakt token, refreshes it if needed, fans out to
// several Trakt endpoints in parallel, and returns one normalized JSON blob.
//
// Design choice: a failure in any single Trakt section (e.g. VIP-only
// recommendations, a transient 5xx) must not fail the whole request. Each
// section is fetched independently and degrades to an empty array with a
// note in metadata.missingOrUnsupportedSections.

interface UserSettingsResponse {
  user?: { username?: string; name?: string | null };
}

interface CalendarShowEntry {
  first_aired?: string;
  episode?: {
    season?: number;
    number?: number;
    title?: string;
    ids?: { trakt?: number };
  };
  show?: {
    title?: string;
    year?: number;
    ids?: { trakt?: number; slug?: string; imdb?: string; tmdb?: number };
    overview?: string;
    genres?: string[];
  };
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function section<T>(
  name: string,
  missing: string[],
  fn: () => Promise<T[]>
): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    console.error(`recommendation-context: section "${name}" failed:`, err instanceof Error ? err.message : err);
    missing.push(`${name}: endpoint unavailable or requires different access`);
    return [];
  }
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== env.RECOMMENDATION_API_KEY) {
    return unauthorized();
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Trakt account not connected yet. Visit /api/trakt/login first." },
      { status: 409 }
    );
  }

  const missingOrUnsupportedSections: string[] = [];

  const [
    settings,
    moviesWatched,
    moviesHistory,
    moviesWatchlist,
    moviesCollection,
    moviesRatings,
    moviesRecommendations,
    showsWatched,
    showsHistory,
    showsWatchlist,
    showsCollection,
    showsRatings,
    showsRecommendations,
    playback,
    calendar,
  ] = await Promise.all([
    section("profile", missingOrUnsupportedSections, async () => {
      const result = await traktGet<UserSettingsResponse>({ accessToken, path: "/users/settings" });
      return result ? [result] : [];
    }),
    section("movies.watched", missingOrUnsupportedSections, async () =>
      normalizeList(await traktGet({ accessToken, path: "/sync/watched/movies" }))
    ),
    section("movies.recentlyWatched", missingOrUnsupportedSections, async () =>
      normalizeList(
        await traktGet({ accessToken, path: "/sync/history/movies", searchParams: { limit: 20 } })
      )
    ),
    section("movies.watchlist", missingOrUnsupportedSections, async () =>
      normalizeList(await traktGet({ accessToken, path: "/sync/watchlist/movies" }))
    ),
    section("movies.collection", missingOrUnsupportedSections, async () =>
      normalizeList(await traktGet({ accessToken, path: "/sync/collection/movies" }))
    ),
    section("movies.ratings", missingOrUnsupportedSections, async () =>
      normalizeList(await traktGet({ accessToken, path: "/sync/ratings/movies" }))
    ),
    section("movies.recommendations", missingOrUnsupportedSections, async () =>
      normalizeList(
        await traktGet({ accessToken, path: "/recommendations/movies", searchParams: { limit: 20 } })
      )
    ),
    section("shows.watched", missingOrUnsupportedSections, async () =>
      normalizeList(await traktGet({ accessToken, path: "/sync/watched/shows" }))
    ),
    section("shows.recentlyWatched", missingOrUnsupportedSections, async () =>
      normalizeList(
        await traktGet({ accessToken, path: "/sync/history/shows", searchParams: { limit: 20 } })
      )
    ),
    section("shows.watchlist", missingOrUnsupportedSections, async () =>
      normalizeList(await traktGet({ accessToken, path: "/sync/watchlist/shows" }))
    ),
    section("shows.collection", missingOrUnsupportedSections, async () =>
      normalizeList(await traktGet({ accessToken, path: "/sync/collection/shows" }))
    ),
    section("shows.ratings", missingOrUnsupportedSections, async () =>
      normalizeList(await traktGet({ accessToken, path: "/sync/ratings/shows" }))
    ),
    section("shows.recommendations", missingOrUnsupportedSections, async () =>
      normalizeList(
        await traktGet({ accessToken, path: "/recommendations/shows", searchParams: { limit: 20 } })
      )
    ),
    section("continueWatching", missingOrUnsupportedSections, async () =>
      normalizeList(await traktGet({ accessToken, path: "/sync/playback" }))
    ),
    section("shows.calendar", missingOrUnsupportedSections, async () => {
      const startDate = new Date().toISOString().slice(0, 10);
      const raw = await traktGet<CalendarShowEntry[]>({
        accessToken,
        path: `/calendars/my/shows/${startDate}/14`,
      });
      return (raw ?? []).map((entry) => ({
        title: entry.show?.title ?? "",
        year: entry.show?.year ?? null,
        traktId: entry.show?.ids?.trakt ?? null,
        slug: entry.show?.ids?.slug ?? "",
        imdbId: entry.show?.ids?.imdb ?? "",
        tmdbId: entry.show?.ids?.tmdb ?? null,
        watchedAt: "",
        listedAt: entry.first_aired ?? "",
        rating: null,
        genres: entry.show?.genres ?? [],
        runtime: null,
        overview: entry.episode?.title
          ? `S${entry.episode.season}E${entry.episode.number} - ${entry.episode.title}`
          : (entry.show?.overview ?? ""),
      }));
    }),
  ]);

  // continueWatching from /sync/playback mixes movies and episodes; split
  // isn't reliably derivable without extra per-item type checks, so we
  // surface the same normalized list under both movies and shows.
  const continueWatching: NormalizedItem[] = playback;

  const profile = settings[0]?.user
    ? { username: settings[0].user.username ?? "", name: settings[0].user.name ?? "" }
    : { username: "", name: "" };

  return NextResponse.json({
    profile,
    movies: {
      watched: moviesWatched,
      recentlyWatched: moviesHistory,
      watchlist: moviesWatchlist,
      collection: moviesCollection,
      ratings: moviesRatings,
      continueWatching,
      recommendations: moviesRecommendations,
    },
    shows: {
      watched: showsWatched,
      recentlyWatched: showsHistory,
      watchlist: showsWatchlist,
      collection: showsCollection,
      ratings: showsRatings,
      continueWatching,
      calendar,
      recommendations: showsRecommendations,
    },
    lists: [],
    metadata: {
      lastFetchedAt: new Date().toISOString(),
      source: "trakt",
      missingOrUnsupportedSections,
    },
  });
}
