// Central place to read + validate server-side env vars. Throws early and
// clearly instead of failing deep inside a fetch call with an undefined URL.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get TRAKT_CLIENT_ID() {
    return required("TRAKT_CLIENT_ID");
  },
  get TRAKT_CLIENT_SECRET() {
    return required("TRAKT_CLIENT_SECRET");
  },
  get TRAKT_REDIRECT_URI() {
    return required("TRAKT_REDIRECT_URI");
  },
  get SUPABASE_URL() {
    return required("SUPABASE_URL");
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get RECOMMENDATION_API_KEY() {
    return required("RECOMMENDATION_API_KEY");
  },
};
