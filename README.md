# trakt-bridge

Bridge between [Trakt](https://trakt.tv) and ChatGPT. Authenticate with Trakt once via OAuth, tokens are stored server-side in Supabase, and a set of small, protected endpoints/tools return your watch history, watchlist, collection, ratings, continue-watching, calendar, and recommendations as normalized JSON - plus write actions to mark things watched/unwatched and add/remove from your watchlist.

Two ways to reach it, sharing the same underlying Trakt logic:

- **REST Actions** (`/api/trakt/*`) - the original interface, for a Custom GPT Action.
- **MCP server** (`/api/mcp`) - a Model Context Protocol server for ChatGPT's Plugin/connector model, which is replacing Custom GPT Actions.

No UI beyond a one-line status page, no scraping - everything goes through Trakt's official REST API (verified against [docs.trakt.tv](https://docs.trakt.tv)).

## How the Trakt OAuth flow works

1. You visit `/api/trakt/login`. The server generates a random `state` value, stores it in an httpOnly cookie, and redirects your browser to `https://trakt.tv/oauth/authorize` with your `TRAKT_CLIENT_ID` and `TRAKT_REDIRECT_URI`.
2. You log in to Trakt and approve the app. Trakt redirects back to `/api/trakt/callback?code=...&state=...`.
3. The callback checks `state` matches the cookie (CSRF protection), then exchanges `code` for an access/refresh token pair via `POST https://api.trakt.tv/oauth/token`.
4. The tokens are upserted into the `trakt_tokens` table in Supabase using the service-role key. They never touch the browser response.
5. On every call to a `/api/trakt/*` data route or the MCP endpoint, the server loads the stored token, refreshes it first if it's within 60 seconds of expiring (same `/oauth/token` endpoint, `grant_type=refresh_token`), persists the refreshed pair, and uses it to call Trakt.

This is a **single-user** bridge: one Trakt account, one row in `trakt_tokens`.

## REST routes (Custom GPT Action)

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness check |
| `/api/trakt/login` | GET | Starts Trakt OAuth, redirects to Trakt |
| `/api/trakt/callback` | GET | OAuth redirect target, stores tokens |
| `/api/trakt/profile` | GET | Username + display name |
| `/api/trakt/watched` | GET | All-time watched movies + shows (`?genre=`, optional) |
| `/api/trakt/recently-watched` | GET | Most recent watch history (`?limit=`, default 20) |
| `/api/trakt/watchlist` | GET | Movies + shows on the watchlist |
| `/api/trakt/collection` | GET | Collected movies + shows |
| `/api/trakt/ratings` | GET | Rated movies + shows |
| `/api/trakt/continue-watching` | GET | What to watch next (`?type=movie\|show`, optional) - see below |
| `/api/trakt/calendar` | GET | Upcoming episodes (`?days=`, default 14) |
| `/api/trakt/recommendations` | GET | Trakt's own recommendations |
| `/api/trakt/search` | GET | Look up one title (`?title=`), with watched/rating/watchlist status and poster |
| `/api/trakt/mark-watched` | POST | Mark watched by Trakt ID (see "Write capability" below) |
| `/api/trakt/mark-unwatched` | POST | Remove all watch history for a Trakt ID |
| `/api/trakt/watchlist/add` | POST | Add to watchlist by Trakt ID |
| `/api/trakt/watchlist/remove` | POST | Remove from watchlist by Trakt ID |
| `/api/openapi.json` | GET | OpenAPI 3.1 doc for wiring a Custom GPT Action |

All `/api/trakt/*` data routes (everything except `login`/`callback`) require an `x-api-key` header matching `RECOMMENDATION_API_KEY`. Missing or wrong key returns 401. If the OAuth flow hasn't been completed yet, they return 409.

### Continue watching vs. playback progress

Trakt's `/sync/playback` endpoint is literal mid-episode/mid-movie pause data reported by a scrobbling client - for most accounts it's empty most of the time. The Trakt website's own Continue Watching page (`app.trakt.tv/users/me/progress`) is broader: for shows it's mostly the next unwatched episode per show, derived from watch history.

`/api/trakt/continue-watching` (and the `get_trakt_continue_watching` MCP tool) matches the website: next-episode-to-watch per watched show, merged with any genuinely paused movies/episodes, sorted by recent activity, fully-caught-up shows excluded. Pass `?type=movie` or `?type=show` to filter, matching the website's tabs.

If you want only the literal saved-pause data instead, use the `get_trakt_playback_progress` MCP tool (REST-only callers can get the same thing from Trakt's `/sync/playback` directly - there's no dedicated REST route for it).

Note this endpoint calls Trakt once per watched show to check progress, so it's noticeably heavier than the other routes - fine for occasional use, not something to call in a tight loop.

### Write capability

Four endpoints modify the Trakt account: `mark-watched`, `mark-unwatched`, `watchlist/add`, `watchlist/remove`. All four take a `traktId` and `type` (`"movie"` or `"show"`) - not a raw title, by design: titles are ambiguous, Trakt IDs aren't, and getting the wrong item wrong isn't easily reversible.

The intended flow is search-then-confirm-then-write:

1. Call `/api/trakt/search?title=...` (or `search_trakt_title` over MCP) to resolve a title to a Trakt ID, year, and poster image.
2. Show the result to the user and get explicit confirmation.
3. Only then call the write endpoint with that Trakt ID.

That confirmation step is enforced by instructions given to the GPT / MCP client, not by the API itself - none of the write endpoints can verify a human actually confirmed anything. Anyone holding the `RECOMMENDATION_API_KEY` (REST) or a valid MCP access token with `trakt.write` scope can write to the Trakt account directly. This is acceptable for a single-user bridge where you control both credentials, but it's not a safety boundary - treat them with the same care as the Trakt tokens themselves.

`mark-watched` is not idempotent - calling it again for the same title adds another history entry rather than erroring. `mark-unwatched` removes **all** history entries for that ID, not just the most recent play.

### Why so many endpoints instead of one combined one

An earlier version of this bridge had a single `/api/trakt/recommendation-context` endpoint that fanned out to every Trakt section and returned it all in one response. For an account with a few hundred watched/collected items, that response exceeded the roughly 100KB size limit Custom GPT Actions enforce, so ChatGPT couldn't consume it at all.

Splitting into one endpoint per section keeps every response small on its own, and matches how ChatGPT actually calls tools - a targeted call per question ("what's on my watchlist", "have I seen X") rather than a full dump every time. `/api/trakt/search` in particular exists so "have I watched X" doesn't require loading the entire watch history - it looks up one title via Trakt's search and checks it against watched/watchlist/ratings directly.

See [sample-response.json](./sample-response.json) for example responses from a few of these routes.

### Normalized item shape

Every movie/show in every list response (except `/api/trakt/search` and `/api/trakt/continue-watching`, which have their own shapes) looks like:

```json
{
  "title": "",
  "year": null,
  "traktId": null,
  "slug": "",
  "imdbId": "",
  "tmdbId": null,
  "watchedAt": "",
  "listedAt": "",
  "rating": null,
  "genres": [],
  "runtime": null,
  "overview": "",
  "posterUrl": ""
}
```

`posterUrl` is only populated by `/api/trakt/search` (Trakt's `/search/*` endpoints return images by default; the `/sync/*` endpoints used by the other list routes don't).

## MCP server (ChatGPT Plugin / connector)

`/api/mcp` exposes the same Trakt logic as MCP tools, for ChatGPT's Plugin/connector model (which is replacing Custom GPT Actions). Both interfaces call the same shared functions in `lib/` - the MCP server never makes HTTP calls back into this app's own REST routes.

### Tools

Read tools (require `trakt.read` scope): `get_trakt_profile`, `get_trakt_watched`, `get_trakt_recently_watched`, `get_trakt_watchlist`, `get_trakt_collection`, `get_trakt_ratings`, `get_trakt_continue_watching`, `get_trakt_playback_progress`, `get_trakt_calendar`, `get_trakt_recommendations`, `search_trakt_title`.

Write tools (require `trakt.write` scope, only registered/visible on a connection that was granted it): `mark_watched`, `mark_unwatched`, `add_to_watchlist`, `remove_from_watchlist`. Annotated with `readOnlyHint`/`destructiveHint` per action (removals are `destructiveHint: true`) so a client can prompt for confirmation.

### Auth: a separate OAuth relationship from Trakt's

The MCP endpoint is protected by its own OAuth 2.1 + PKCE authorization server, entirely independent of the Trakt OAuth flow above:

```
ChatGPT  --OAuth2.1+PKCE-->  /oauth/authorize, /oauth/token   (this server's own auth)
ChatGPT  --Bearer token-->   /api/mcp                          (validates token + scope, dispatches tools)
                                    |
                                    v
                          lib/trakt.ts, lib/search.ts, ...      (same logic the REST routes use)
                                    |
                                    v
                                Trakt API
```

This server is the resource server and its own authorization server. It issues its own short-lived access tokens (and longer-lived refresh tokens) to whatever links as a client - it never hands Trakt's own access/refresh tokens to ChatGPT.

Because this is a single-user bridge, `/oauth/authorize` doesn't have real login/consent UI. It's gated by an owner cookie:

1. Set `MCP_OWNER_KEY` (any long random string, known only to you) as an env var.
2. Once, in whichever browser you'll use to link ChatGPT, visit `/oauth/setup?key=<MCP_OWNER_KEY>`. This sets a long-lived httpOnly cookie.
3. When ChatGPT redirects your browser through `/oauth/authorize` to link the connector, the cookie is checked; if present, a code is issued straight back to ChatGPT with no further prompt. If missing, you're told to do step 2 first.

Metadata endpoints (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`) let ChatGPT discover the auth/token endpoints automatically.

### Wiring up as a ChatGPT connector

1. In ChatGPT, enable Developer Mode / a custom connector (naming varies by ChatGPT's current UI).
2. Server URL: `https://<your-app>.vercel.app/api/mcp`.
3. Authentication: OAuth (auto-discovered from the metadata endpoints above).
4. Advanced OAuth settings, if ChatGPT requires them explicitly:
   - Client ID: any consistent string, e.g. `chatgpt-trakt-bridge` (not validated against a registry).
   - Client secret: leave blank (PKCE-only, `token_endpoint_auth_methods_supported: ["none"]`).
   - Authorization URL: `https://<your-app>.vercel.app/oauth/authorize`
   - Token URL: `https://<your-app>.vercel.app/oauth/token`
   - Scopes: `trakt.read` and `trakt.write`, one per line.
5. Visit `/oauth/setup?key=<MCP_OWNER_KEY>` in your browser first (see above), then create/link the connector.

## Setup

### 1. Create a Trakt API app

Go to [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications) -> New Application.

- Redirect URI: `https://<your-vercel-domain>/api/trakt/callback` (use `http://localhost:3000/api/trakt/callback` for local dev - you can list both)
- Copy the generated Client ID and Client Secret.

### 2. Create the Supabase tables

In your Supabase project's SQL editor, run [supabase/migrations/0001_trakt_tokens.sql](./supabase/migrations/0001_trakt_tokens.sql) and [supabase/migrations/0002_mcp_oauth.sql](./supabase/migrations/0002_mcp_oauth.sql).

Grab `SUPABASE_URL` and the **service role** key (Settings -> API -> `service_role` secret - not the anon key) for env vars.

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in:

```
TRAKT_CLIENT_ID=
TRAKT_CLIENT_SECRET=
TRAKT_REDIRECT_URI=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
RECOMMENDATION_API_KEY=
MCP_OWNER_KEY=
MCP_PUBLIC_URL=
```

- `RECOMMENDATION_API_KEY` is any long random string you generate yourself - the shared secret the Custom GPT Action sends as `x-api-key`.
- `MCP_OWNER_KEY` is any long random string you generate yourself - gates `/oauth/setup` for the MCP connector, never shared with ChatGPT.
- `MCP_PUBLIC_URL` is this app's public base URL (e.g. `http://localhost:3000` locally, `https://<your-app>.vercel.app` in production, no trailing slash) - used in OAuth metadata responses.

### 4. Run locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000/api/trakt/login`, authorize, then:

```bash
curl -H "x-api-key: $RECOMMENDATION_API_KEY" http://localhost:3000/api/trakt/watchlist
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it in [Vercel](https://vercel.com/new).
3. Add the eight environment variables from `.env.example` in the Vercel project settings (Production + Preview).
4. Set `TRAKT_REDIRECT_URI` and `MCP_PUBLIC_URL` to your production URL and add the Trakt redirect URI to the Trakt app's redirect list (alongside the localhost one).
5. Deploy.
6. Visit `https://<your-app>.vercel.app/api/trakt/login` once to authorize and store your Trakt tokens.
7. For the Custom GPT Action: give ChatGPT your `RECOMMENDATION_API_KEY` to send as `x-api-key`, using `/api/openapi.json` as the schema source.
8. For the MCP connector: visit `/oauth/setup?key=<MCP_OWNER_KEY>` once, then link the connector as described above.

## Security notes

- `TRAKT_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_OWNER_KEY`, and all Trakt/MCP access/refresh tokens are only ever read server-side (route handlers, `lib/`) and are never included in a response body or logged.
- Every `/api/trakt/*` data route 401s without a valid `x-api-key`. Every `/api/mcp` request 401s without a valid, unexpired bearer token; write tools additionally require the `trakt.write` scope to even appear in the tool list.
- The MCP server never hands Trakt's own tokens to ChatGPT - it issues its own separate, short-lived tokens and uses the stored Trakt tokens itself when calling Trakt.
- Write actions (`mark-watched`/`mark-unwatched`/`watchlist add`/`watchlist remove`, both REST and MCP) have no server-side confirmation gating - see "Write capability" above.

## What this is not

- Not a full Trakt client app - there's no UI beyond a one-line status page.
- Not a recommendation engine - Trakt's own `/recommendations/*` endpoints are surfaced as-is, nothing is re-ranked.
- Not multi-user - one Trakt account, one set of stored tokens.
