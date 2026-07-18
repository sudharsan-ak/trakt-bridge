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
      description: "Read-only bridge exposing a Trakt user's watch history, watchlist, collection, ratings, and recommendations as normalized JSON, split into small per-section endpoints.",
      version: "2.0.0",
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
      ...simpleGet("/api/trakt/watched", "getTraktWatched", "Get all movies and shows the user has ever watched", moviesAndShows),
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
          summary: "Look up a single movie or show by title and check whether the user has watched it, rated it, or has it on their watchlist",
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
