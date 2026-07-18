import { NextRequest, NextResponse } from "next/server";

// Serves an OpenAPI 3.1 description of /api/trakt/recommendation-context so
// it can be imported directly as a Custom GPT Action. Not used by the bridge
// itself — purely a convenience for wiring up ChatGPT.
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
              content: { "application/json": { schema: { type: "object" } } },
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
