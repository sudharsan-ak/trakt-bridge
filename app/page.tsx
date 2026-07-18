export default function Home() {
  return (
    <main style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>trakt-bridge</h1>
      <p>Read-only Trakt-to-ChatGPT bridge. No UI here.</p>
      <ul>
        <li>
          <a href="/api/health">/api/health</a>
        </li>
        <li>/api/trakt/login — start Trakt OAuth</li>
        <li>/api/trakt/callback — OAuth redirect target</li>
        <li>/api/trakt/recommendation-context — main API (requires x-api-key)</li>
        <li>
          <a href="/api/openapi.json">/api/openapi.json</a>
        </li>
      </ul>
    </main>
  );
}
