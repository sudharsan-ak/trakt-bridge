# trakt-bridge

Read-only bridge between [Trakt](https://trakt.tv) and ChatGPT. Authenticate with Trakt once via OAuth, tokens are stored server-side in Supabase, and a single protected endpoint returns your latest watch history, watchlist, collection, ratings, continue-watching, calendar, and recommendations as normalized JSON.

No UI, no write access to your Trakt account, no scraping — everything goes through Trakt's official REST API (verified against [docs.trakt.tv](https://docs.trakt.tv)).

## How the OAuth flow works

1. You visit `/api/trakt/login`. The server generates a random `state` value, stores it in an httpOnly cookie, and redirects your browser to `https://trakt.tv/oauth/authorize` with your `TRAKT_CLIENT_ID` and `TRAKT_REDIRECT_URI`.
2. You log in to Trakt and approve the app. Trakt redirects back to `/api/trakt/callback?code=...&state=...`.
3. The callback checks `state` matches the cookie (CSRF protection), then exchanges `code` for an access/refresh token pair via `POST https://api.trakt.tv/oauth/token`.
4. The tokens are upserted into the `trakt_tokens` table in Supabase using the service-role key. They never touch the browser response.
5. On every call to `/api/trakt/recommendation-context`, the server loads the stored token, refreshes it first if it's within 60 seconds of expiring (same `/oauth/token` endpoint, `grant_type=refresh_token`), persists the refreshed pair, and uses it to call Trakt.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness check |
| `/api/trakt/login` | GET | Starts Trakt OAuth, redirects to Trakt |
| `/api/trakt/callback` | GET | OAuth redirect target, stores tokens |
| `/api/trakt/recommendation-context` | GET | Main endpoint — requires `x-api-key` header |
| `/api/openapi.json` | GET | OpenAPI 3.1 doc for wiring a Custom GPT Action |

See [sample-response.json](./sample-response.json) for a full example of what `/api/trakt/recommendation-context` returns.

### Graceful degradation

Each section (watched, watchlist, ratings, recommendations, etc.) is fetched independently. If one Trakt endpoint fails, errors, or requires access you don't have (e.g. some recommendation endpoints behave differently for non-VIP accounts), that section comes back as an empty array and a note is added to `metadata.missingOrUnsupportedSections` instead of failing the whole request.

## Setup

### 1. Create a Trakt API app

Go to [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications) → New Application.

- Redirect URI: `https://<your-vercel-domain>/api/trakt/callback` (use `http://localhost:3000/api/trakt/callback` for local dev)
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

Grab `SUPABASE_URL` and the **service role** key (Settings → API → `service_role` secret — not the anon key) for env vars.

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

`RECOMMENDATION_API_KEY` is any long random string you generate yourself — it's the shared secret ChatGPT sends back as `x-api-key`.

### 4. Run locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000/api/trakt/login`, authorize, then:

```bash
curl -H "x-api-key: $RECOMMENDATION_API_KEY" http://localhost:3000/api/trakt/recommendation-context
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it in [Vercel](https://vercel.com/new).
3. Add the six environment variables from `.env.example` in the Vercel project settings (Production + Preview).
4. Set `TRAKT_REDIRECT_URI` to your production URL (`https://<your-app>.vercel.app/api/trakt/callback`) and update the redirect URI on the Trakt app to match exactly.
5. Deploy.
6. Visit `https://<your-app>.vercel.app/api/trakt/login` once to authorize and store your tokens.
7. Give ChatGPT (as a Custom GPT Action, using `/api/openapi.json` as the schema source) your `RECOMMENDATION_API_KEY` to send as `x-api-key`.

## Security notes

- `TRAKT_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and Trakt access/refresh tokens are only ever read server-side (route handlers, `lib/`) and are never included in a response body or logged.
- `/api/trakt/recommendation-context` is the only route meant for external (ChatGPT) use, and it 401s without a valid `x-api-key`.
- This app only performs `GET` requests against Trakt — nothing here can modify your Trakt account.

## What this is not

- Not a full Trakt client app — there's no UI beyond a one-line status page.
- Not a recommendation engine — Trakt's own `/recommendations/*` endpoints are surfaced as-is, nothing is re-ranked.
- Not a write-capable integration — no add/remove/rate endpoints are called.
