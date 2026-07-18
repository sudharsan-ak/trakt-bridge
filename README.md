# trakt-bridge

Read-only bridge between [Trakt](https://trakt.tv) and ChatGPT. Authenticate with Trakt once via OAuth, tokens are stored server-side in Supabase, and a set of small, protected endpoints return your watch history, watchlist, collection, ratings, continue-watching, calendar, and recommendations as normalized JSON.

No UI, no write access to your Trakt account, no scraping - everything goes through Trakt's official REST API (verified against [docs.trakt.tv](https://docs.trakt.tv)).

## How the OAuth flow works

1. You visit `/api/trakt/login`. The server generates a random `state` value, stores it in an httpOnly cookie, and redirects your browser to `https://trakt.tv/oauth/authorize` with your `TRAKT_CLIENT_ID` and `TRAKT_REDIRECT_URI`.
2. You log in to Trakt and approve the app. Trakt redirects back to `/api/trakt/callback?code=...&state=...`.
3. The callback checks `state` matches the cookie (CSRF protection), then exchanges `code` for an access/refresh token pair via `POST https://api.trakt.tv/oauth/token`.
4. The tokens are upserted into the `trakt_tokens` table in Supabase using the service-role key. They never touch the browser response.
5. On every call to a `/api/trakt/*` data route, the server loads the stored token, refreshes it first if it's within 60 seconds of expiring (same `/oauth/token` endpoint, `grant_type=refresh_token`), persists the refreshed pair, and uses it to call Trakt.

## Routes

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
| `/api/trakt/continue-watching` | GET | In-progress playback |
| `/api/trakt/calendar` | GET | Upcoming episodes (`?days=`, default 14) |
| `/api/trakt/recommendations` | GET | Trakt's own recommendations |
| `/api/trakt/search` | GET | Look up one title (`?title=`), with watched/rating/watchlist status and poster |
| `/api/trakt/mark-watched` | POST | Mark a movie/show watched by Trakt ID (see "Write capability" below) |
| `/api/openapi.json` | GET | OpenAPI 3.1 doc for wiring a Custom GPT Action |

All `/api/trakt/*` data routes (everything except `login`/`callback`) require an `x-api-key` header matching `RECOMMENDATION_API_KEY`. Missing or wrong key returns 401. If the OAuth flow hasn't been completed yet, they return 409.

### Write capability

`/api/trakt/mark-watched` is the one endpoint in this bridge that modifies the Trakt account - it calls `POST https://api.trakt.tv/sync/history`. It takes a `traktId` and `type` (not a raw title), by design: titles are ambiguous, Trakt IDs aren't, and marking the wrong item watched isn't easily reversible.

The intended flow is search-then-confirm-then-write:

1. Call `/api/trakt/search?title=...` to resolve a title to a Trakt ID, year, and poster image.
2. Show the result to the user (title, year, poster) and get explicit confirmation.
3. Only then call `/api/trakt/mark-watched` with that Trakt ID.

That confirmation step is enforced by instructions given to the GPT (see "Wiring up a Custom GPT Action" below), not by the API itself - `/api/trakt/mark-watched` has no way to verify a human actually confirmed anything. Anyone holding the `RECOMMENDATION_API_KEY` can write to the Trakt account directly. This is acceptable for a single-user bridge where you control the key, but it's not a safety boundary - treat the API key with the same care as the Trakt tokens themselves.

### Why so many endpoints instead of one combined one

An earlier version of this bridge had a single `/api/trakt/recommendation-context` endpoint that fanned out to every Trakt section and returned it all in one response. For an account with a few hundred watched/collected items, that response exceeded the roughly 100KB size limit Custom GPT Actions enforce, so ChatGPT couldn't consume it at all.

Splitting into one endpoint per section keeps every response small on its own, and matches how ChatGPT actually calls tools - a targeted call per question ("what's on my watchlist", "have I seen X") rather than a full dump every time. `/api/trakt/search` in particular exists so "have I watched X" doesn't require loading the entire watch history - it looks up one title via Trakt's search and checks it against watched/watchlist/ratings directly.

See [sample-response.json](./sample-response.json) for example responses from a few of these routes.

### Normalized item shape

Every movie/show in every list response (except `/api/trakt/search`, which adds `watched`/`onWatchlist`/`lastWatchedAt`) looks like:

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

## Setup

### 1. Create a Trakt API app

Go to [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications) -> New Application.

- Redirect URI: `https://<your-vercel-domain>/api/trakt/callback` (use `http://localhost:3000/api/trakt/callback` for local dev - you can list both)
- Copy the generated Client ID and Client Secret.

### 2. Create the Supabase table

In your Supabase project's SQL editor, run [supabase/migrations/0001_trakt_tokens.sql](./supabase/migrations/0001_trakt_tokens.sql):

```sql
create table if not exists trakt_tokens (
  id integer primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

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
```

`RECOMMENDATION_API_KEY` is any long random string you generate yourself - it's the shared secret ChatGPT sends back as `x-api-key`.

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
3. Add the six environment variables from `.env.example` in the Vercel project settings (Production + Preview).
4. Set `TRAKT_REDIRECT_URI` to your production URL (`https://<your-app>.vercel.app/api/trakt/callback`) and add that same URI to the Trakt app's redirect list (alongside the localhost one).
5. Deploy.
6. Visit `https://<your-app>.vercel.app/api/trakt/login` once to authorize and store your tokens.
7. Give ChatGPT (as a Custom GPT Action, using `/api/openapi.json` as the schema source) your `RECOMMENDATION_API_KEY` to send as `x-api-key`.

## Wiring up a Custom GPT Action

1. In ChatGPT, create a new GPT -> Configure -> Actions -> Create new action.
2. Authentication: **API Key**, Auth Type **Custom**, header name `x-api-key`, value = your `RECOMMENDATION_API_KEY`.
3. Schema: **Import from URL** -> `https://<your-app>.vercel.app/api/openapi.json`.
4. Add instructions telling the GPT to call these actions when asked about watch history or for recommendations, to avoid re-recommending anything already watched or watchlisted, and - important - to always call `searchTraktTitle` and show the user the title/year/poster for explicit confirmation before ever calling `markWatched`.

## Security notes

- `TRAKT_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and Trakt access/refresh tokens are only ever read server-side (route handlers, `lib/`) and are never included in a response body or logged.
- Every `/api/trakt/*` data route 401s without a valid `x-api-key`.
- Almost everything here only performs `GET` requests against Trakt. The one exception is `/api/trakt/mark-watched`, which writes to the account - see "Write capability" above for how that's gated and what its limits are.

## What this is not

- Not a full Trakt client app - there's no UI beyond a one-line status page.
- Not a recommendation engine - Trakt's own `/recommendations/*` endpoints are surfaced as-is, nothing is re-ranked.
- Not a general write-capable integration - the only mutation exposed is marking something watched; there's no add-to-watchlist, remove-from-history, rate, or any endpoint that touches lists or collection.
