import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { traktGet, traktGetAllPages } from "./trakt";
import { normalizeList, normalizeItem, type NormalizedItem } from "./normalize";
import { searchTraktTitle } from "./search";
import { performTraktWrite } from "./write-actions";
import type { McpScope } from "./mcp-auth";

// Builds a fresh McpServer per request (stateless mode — matches Vercel's
// serverless-per-invocation model, and matches how every /api/trakt/* REST
// route already works: no server-held state between calls).
//
// Every tool here is a thin wrapper around the same lib/trakt.ts + lib/
// functions the REST routes call — no HTTP calls back into our own /api/
// routes, and no reimplementation of pagination or normalization.
//
// accessToken here is the Trakt account's access token (already resolved
// and refreshed by the caller via lib/trakt.ts#getValidAccessToken), not
// the MCP bearer token used to reach this endpoint — those are the two
// separate OAuth relationships described in lib/mcp-auth.ts.
//
// scopes is the granted-scope list from that MCP bearer token. Write tools
// are only registered at all when trakt.write is present, rather than being
// registered and then rejecting calls — so a read-only-scoped token doesn't
// even see them in tools/list.
export function buildMcpServer(accessToken: string, scopes: McpScope[]): McpServer {
  const server = new McpServer({
    name: "trakt-bridge",
    version: "1.0.0",
  });

  function textResult(data: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  }

  server.registerTool(
    "get_trakt_profile",
    {
      title: "Get Trakt Profile",
      description: "Returns the connected Trakt account's username and display name.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const settings = await traktGet<{ user?: { username?: string; name?: string | null } }>({
        accessToken,
        path: "/users/settings",
      });
      return textResult({
        profile: { username: settings?.user?.username ?? "", name: settings?.user?.name ?? "" },
      });
    }
  );

  server.registerTool(
    "get_trakt_watched",
    {
      title: "Get Trakt Watched History",
      description:
        "Returns the full list of movies and shows the user has watched, optionally filtered by genre. Fetches the complete account history across all pages, not just the first page.",
      inputSchema: { genre: z.string().optional().describe("Optional genre to filter by, e.g. 'comedy'") },
      annotations: { readOnlyHint: true },
    },
    async ({ genre }) => {
      const [moviesRaw, showsRaw] = await Promise.all([
        traktGetAllPages({ accessToken, path: "/sync/watched/movies", searchParams: { extended: "full" } }),
        traktGetAllPages({ accessToken, path: "/sync/watched/shows", searchParams: { extended: "full" } }),
      ]);

      let movies = normalizeList(moviesRaw);
      let shows = normalizeList(showsRaw);

      if (genre) {
        const matchesGenre = (item: NormalizedItem) => item.genres.some((g) => g.toLowerCase() === genre.toLowerCase());
        movies = movies.filter(matchesGenre);
        shows = shows.filter(matchesGenre);
      }

      return textResult({ movies, shows });
    }
  );

  server.registerTool(
    "get_trakt_recently_watched",
    {
      title: "Get Recently Watched",
      description: "Returns the most recently watched movies and shows, most-recent-first.",
      inputSchema: { limit: z.number().int().positive().optional().describe("Max items per type, default 20") },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const [movies, shows] = await Promise.all([
        traktGet({ accessToken, path: "/sync/history/movies", searchParams: { limit: limit ?? 20 } }),
        traktGet({ accessToken, path: "/sync/history/shows", searchParams: { limit: limit ?? 20 } }),
      ]);
      return textResult({ movies: normalizeList(movies), shows: normalizeList(shows) });
    }
  );

  server.registerTool(
    "get_trakt_watchlist",
    {
      title: "Get Trakt Watchlist",
      description: "Returns the full watchlist (movies and shows), fetched across all pages.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [movies, shows] = await Promise.all([
        traktGetAllPages({ accessToken, path: "/sync/watchlist/movies" }),
        traktGetAllPages({ accessToken, path: "/sync/watchlist/shows" }),
      ]);
      return textResult({ movies: normalizeList(movies), shows: normalizeList(shows) });
    }
  );

  server.registerTool(
    "get_trakt_collection",
    {
      title: "Get Trakt Collection",
      description: "Returns the full collection (movies and shows), fetched across all pages.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [movies, shows] = await Promise.all([
        traktGetAllPages({ accessToken, path: "/sync/collection/movies" }),
        traktGetAllPages({ accessToken, path: "/sync/collection/shows" }),
      ]);
      return textResult({ movies: normalizeList(movies), shows: normalizeList(shows) });
    }
  );

  server.registerTool(
    "get_trakt_ratings",
    {
      title: "Get Trakt Ratings",
      description: "Returns all rated movies and shows, fetched across all pages.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [movies, shows] = await Promise.all([
        traktGetAllPages({ accessToken, path: "/sync/ratings/movies" }),
        traktGetAllPages({ accessToken, path: "/sync/ratings/shows" }),
      ]);
      return textResult({ movies: normalizeList(movies), shows: normalizeList(shows) });
    }
  );

  server.registerTool(
    "get_trakt_continue_watching",
    {
      title: "Get Continue Watching",
      description: "Returns in-progress movies and episodes (playback list).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const playback = await traktGet({ accessToken, path: "/sync/playback" });
      return textResult({ items: normalizeList(playback) });
    }
  );

  server.registerTool(
    "get_trakt_calendar",
    {
      title: "Get Trakt Calendar",
      description: "Returns upcoming show episodes airing over the given number of days, starting today.",
      inputSchema: { days: z.number().int().positive().optional().describe("Days ahead to look, default 14") },
      annotations: { readOnlyHint: true },
    },
    async ({ days }) => {
      const startDate = new Date().toISOString().slice(0, 10);
      interface CalendarShowEntry {
        first_aired?: string;
        episode?: { season?: number; number?: number; title?: string };
        show?: {
          title?: string;
          year?: number;
          ids?: { trakt?: number; slug?: string; imdb?: string; tmdb?: number };
          overview?: string;
          genres?: string[];
          images?: { poster?: string[] };
        };
      }
      const raw = await traktGet<CalendarShowEntry[]>({
        accessToken,
        path: `/calendars/my/shows/${startDate}/${days ?? 14}`,
      });
      const items: NormalizedItem[] = (raw ?? []).map((entry) => ({
        ...normalizeItem({ show: entry.show, listed_at: entry.first_aired }),
        overview: entry.episode?.title
          ? `S${entry.episode.season}E${entry.episode.number} - ${entry.episode.title}`
          : (entry.show?.overview ?? ""),
      }));
      return textResult({ items });
    }
  );

  server.registerTool(
    "get_trakt_recommendations",
    {
      title: "Get Trakt Recommendations",
      description: "Returns personalized movie and show recommendations.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [movies, shows] = await Promise.all([
        traktGet({ accessToken, path: "/recommendations/movies", searchParams: { limit: 20 } }),
        traktGet({ accessToken, path: "/recommendations/shows", searchParams: { limit: 20 } }),
      ]);
      return textResult({ movies: normalizeList(movies), shows: normalizeList(shows) });
    }
  );

  server.registerTool(
    "search_trakt_title",
    {
      title: "Search Trakt Title",
      description:
        "Searches for a movie or show by title and returns the top match for each, cross-referenced against the user's watched/watchlist/ratings status.",
      inputSchema: { title: z.string().describe("Title to search for") },
      annotations: { readOnlyHint: true },
    },
    async ({ title }) => {
      const result = await searchTraktTitle(accessToken, title);
      return textResult(result);
    }
  );

  if (scopes.includes("trakt.write")) {
    const traktIdParam = z.number().int().describe("The Trakt ID of the movie or show, from search_trakt_title");
    const typeParam = z.enum(["movie", "show"]).describe("Whether the ID refers to a movie or a show");

    server.registerTool(
      "mark_watched",
      {
        title: "Mark Watched",
        description:
          "Marks a movie or show as watched on Trakt, adding a new history entry. Not idempotent — calling this again for the same title adds another play. Resolve the title to a Trakt ID with search_trakt_title first.",
        inputSchema: {
          traktId: traktIdParam,
          type: typeParam,
          watchedAt: z.string().optional().describe("ISO 8601 timestamp of when it was watched; defaults to now"),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ traktId, type, watchedAt }) => {
        const result = await performTraktWrite(accessToken, "mark_watched", { traktId, type, watchedAt });
        return textResult(result);
      }
    );

    server.registerTool(
      "mark_unwatched",
      {
        title: "Mark Unwatched",
        description:
          "Removes ALL watch history entries for a movie or show on Trakt (every play, not just the most recent). Resolve the title to a Trakt ID with search_trakt_title first.",
        inputSchema: { traktId: traktIdParam, type: typeParam },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async ({ traktId, type }) => {
        const result = await performTraktWrite(accessToken, "mark_unwatched", { traktId, type });
        return textResult(result);
      }
    );

    server.registerTool(
      "add_to_watchlist",
      {
        title: "Add to Watchlist",
        description:
          "Adds a movie or show to the Trakt watchlist. Resolve the title to a Trakt ID with search_trakt_title first.",
        inputSchema: { traktId: traktIdParam, type: typeParam },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ traktId, type }) => {
        const result = await performTraktWrite(accessToken, "watchlist_add", { traktId, type });
        return textResult(result);
      }
    );

    server.registerTool(
      "remove_from_watchlist",
      {
        title: "Remove from Watchlist",
        description:
          "Removes a movie or show from the Trakt watchlist. Resolve the title to a Trakt ID with search_trakt_title first.",
        inputSchema: { traktId: traktIdParam, type: typeParam },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async ({ traktId, type }) => {
        const result = await performTraktWrite(accessToken, "watchlist_remove", { traktId, type });
        return textResult(result);
      }
    );
  }

  return server;
}
