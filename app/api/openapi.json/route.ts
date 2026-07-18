import { NextRequest, NextResponse } from "next/server";

// Serves an OpenAPI 3.1 description of /api/trakt/recommendation-context so
// it can be imported directly as a Custom GPT Action. Not used by the bridge
// itself — purely a convenience for wiring up ChatGPT.

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

const movieSectionsSchema = {
  type: "object",
  properties: {
    watched: itemArray,
    recentlyWatched: itemArray,
    watchlist: itemArray,
    collection: itemArray,
    ratings: itemArray,
    continueWatching: itemArray,
    recommendations: itemArray,
  },
};

const showSectionsSchema = {
  type: "object",
  properties: {
    watched: itemArray,
    recentlyWatched: itemArray,
    watchlist: itemArray,
    collection: itemArray,
    ratings: itemArray,
    continueWatching: itemArray,
    calendar: itemArray,
    recommendations: itemArray,
  },
};

export async function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Trakt Bridge",
      description: "Read-only bridge exposing a Trakt user's watch history, watchlist, collection, ratings, and recommendations as normalized JSON.",
      version: "1.0.0",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/trakt/recommendation-context": {
        get: {
          operationId: "getTraktRecommendationContext",
          summary: "Get the user's latest Trakt context (movies, shows, watchlist, ratings, recommendations)",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            "200": {
              description: "Normalized Trakt context",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      profile: {
                        type: "object",
                        properties: {
                          username: { type: "string" },
                          name: { type: "string" },
                        },
                      },
                      movies: movieSectionsSchema,
                      shows: showSectionsSchema,
                      lists: { type: "array", items: {} },
                      metadata: {
                        type: "object",
                        properties: {
                          lastFetchedAt: { type: "string" },
                          source: { type: "string" },
                          missingOrUnsupportedSections: {
                            type: "array",
                            items: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { description: "Missing or invalid x-api-key" },
            "409": { description: "Trakt account not connected yet" },
          },
        },
      },
    },
    components: {
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
