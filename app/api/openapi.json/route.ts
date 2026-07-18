import { NextRequest, NextResponse } from "next/server";

// Serves an OpenAPI 3.1 description of every /api/trakt/* endpoint so it can
// be imported directly as a Custom GPT Action. Not used by the bridge
// itself — purely a convenience for wiring up ChatGPT.
//
// Endpoints are split by section (rather than one combined endpoint)
// because a single response covering watched/watchlist/collection/ratings/
// recommendations for both movies and shows exceeded ChatGPT's Custom GPT
// Action response size limit (~100KB) for accounts with a few hundred
// items. Splitting also matches how ChatGPT actually calls tools — one
// targeted call per question, not a full dump every time.

const normalizedItemSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    year: { type: ["integer", "null"] },
    traktId: { type: ["integer", "null"] },
    slug: { type: "string" },
    imdbId: { type: "string" },
    tmdbId: { type: ["integer", "null"] },
    watchedAt: { type: "string" },
    listedAt: { type: "string" },
    rating: { type: ["number", "null"] },
    genres: { type: "array", items: { type: "string" } },
    runtime: { type: ["integer", "null"] },
    overview: { type: "string" },
    posterUrl: { type: "string" },
  },
};

const itemArray = { type: "array", items: normalizedItemSchema };

const moviesAndShows = {
  type: "object",
  properties: { movies: itemArray, shows: itemArray },
};

function simpleGet(path: string, operationId: string, summary: string, responseSchema: object) {
  return {
    [path]: {
      get: {
        operationId,
        summary,
        security: [{ ApiKeyAuth: [] }],
        responses: {
          "200": { description: summary, content: { "application/json": { schema: responseSchema } } },
          "401": { description: "Missing or invalid x-api-key" },
          "409": { description: "Trakt account not connected yet" },
        },
      },
    },
  };
}

export async function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Trakt Bridge",
      description: "Bridge exposing a Trakt user's watch history, watchlist, collection, ratings, and recommendations as normalized JSON, split into small per-section endpoints. Mostly read-only, with one write action (markWatched) gated by a required prior search + user confirmation.",
      version: "2.2.0",
    },
    servers: [{ url: baseUrl }],
    paths: {
      ...simpleGet("/api/trakt/profile", "getTraktProfile", "Get the user's Trakt username and display name", {
        type: "object",
        properties: {
          profile: {
            type: "object",
            properties: { username: { type: "string" }, name: { type: "string" } },
          },
        },
      }),
      "/api/trakt/watched": {
        get: {
          operationId: "getTraktWatched",
          summary: "Get all movies and shows the user has ever watched, optionally filtered to one genre",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "genre",
              in: "query",
              required: false,
              description: "Filter to items matching this genre exactly (e.g. 'comedy', 'action', 'drama'). Case-insensitive. Omit to return the full watched list.",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Watched movies and shows", content: { "application/json": { schema: moviesAndShows } } },
            "401": { description: "Missing or invalid x-api-key" },
            "409": { description: "Trakt account not connected yet" },
          },
        },
      },
      "/api/trakt/recently-watched": {
        get: {
          operationId: "getTraktRecentlyWatched",
          summary: "Get the user's most recently watched movies and shows, most recent first",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "limit",
              in: "query",
              required: false,
              description: "Max items per type to return (default 20)",
              schema: { type: "integer", default: 20 },
            },
          ],
          responses: {
            "200": { description: "Recently watched movies and shows", content: { "application/json": { schema: moviesAndShows } } },
            "401": { description: "Missing or invalid x-api-key" },
            "409": { description: "Trakt account not connected yet" },
          },
        },
      },
      ...simpleGet("/api/trakt/watchlist", "getTraktWatchlist", "Get the user's Trakt watchlist (movies and shows they plan to watch)", moviesAndShows),
      ...simpleGet("/api/trakt/collection", "getTraktCollection", "Get the movies and shows the user has collected", moviesAndShows),
      ...simpleGet("/api/trakt/ratings", "getTraktRatings", "Get the movies and shows the user has rated, with their rating", moviesAndShows),
      ...simpleGet("/api/trakt/continue-watching", "getTraktContinueWatching", "Get movies and episodes the user has started but not finished", {
        type: "object",
        properties: { items: itemArray },
      }),
      "/api/trakt/calendar": {
        get: {
          operationId: "getTraktCalendar",
          summary: "Get upcoming episodes for shows the user watches, starting today",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "days",
              in: "query",
              required: false,
              description: "Number of days ahead to include (default 14)",
              schema: { type: "integer", default: 14 },
            },
          ],
          responses: {
            "200": { description: "Upcoming calendar items", content: { "application/json": { schema: { type: "object", properties: { items: itemArray } } } } },
            "401": { description: "Missing or invalid x-api-key" },
            "409": { description: "Trakt account not connected yet" },
          },
        },
      },
      ...simpleGet("/api/trakt/recommendations", "getTraktRecommendations", "Get Trakt's own movie and show recommendations for the user", moviesAndShows),
      "/api/trakt/search": {
        get: {
          operationId: "searchTraktTitle",
          summary: "Look up a single movie or show by title, returning its poster image, year, and Trakt ID along with whether the user has watched it, rated it, or has it on their watchlist. Always call this before markWatched so the exact title/poster can be confirmed with the user first.",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "title",
              in: "query",
              required: true,
              description: "Movie or show title to search for",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Best-matching movie and show, each with watched/rating/watchlist status",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      found: { type: "boolean" },
                      movie: { type: ["object", "null"] },
                      show: { type: ["object", "null"] },
                    },
                  },
                },
              },
            },
            "400": { description: "Missing 'title' query parameter" },
            "401": { description: "Missing or invalid x-api-key" },
            "409": { description: "Trakt account not connected yet" },
          },
        },
      },
      "/api/trakt/mark-watched": {
        post: {
          operationId: "markWatched",
          summary: "Mark a specific movie or show as watched on the user's Trakt account. This modifies the user's real Trakt history. Only call this after searchTraktTitle has been used to show the user the exact title, year, and poster, and the user has explicitly confirmed it's correct.",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["traktId", "type"],
                  properties: {
                    traktId: { type: "integer", description: "Trakt ID from a prior searchTraktTitle call" },
                    type: { type: "string", enum: ["movie", "show"] },
                    watchedAt: { type: "string", description: "ISO 8601 timestamp; defaults to now if omitted" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Marked as watched",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      traktId: { type: "integer" },
                      type: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": { description: "Missing or invalid traktId/type in request body" },
            "401": { description: "Missing or invalid x-api-key" },
            "404": { description: "No movie/show found on Trakt with that id" },
            "409": { description: "Trakt account not connected yet" },
          },
        },
      },
    },
    components: {
      schemas: {},
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
        },
      },
    },
  };

  return NextResponse.json(spec);
}
