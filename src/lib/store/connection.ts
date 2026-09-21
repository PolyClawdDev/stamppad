/**
 * Where the Postgres URL lives. Vercel + Neon inject several names for the
 * same database. DATABASE_URL is the one we document; POSTGRES_URL is what
 * their marketplace template actually writes. Either is enough.
 */
const URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
] as const;

/** Docs and .env.example use this host. It is not a database. */
export function isPlaceholderUrl(url: string): boolean {
  return /db\.example\.com|user:pass@/i.test(url);
}

export function postgresUrl(): string | undefined {
  for (const key of URL_KEYS) {
    const value = process.env[key]?.trim();
    if (value && !isPlaceholderUrl(value)) return value;
  }
  return undefined;
}

export function hasPostgresUrl(): boolean {
  return Boolean(postgresUrl());
}

/**
 * Neon and Vercel refuse plaintext. A URL that already names an sslmode is
 * left alone; one that does not, and is clearly hosted, gets require added.
 */
export function connectionString(url: string): string {
  if (/[?&]sslmode=/i.test(url)) return url;
  if (!hostedPostgres(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require`;
}

export function hostedPostgres(url: string): boolean {
  return /neon\.tech|pooler\.|vercel-storage|amazonaws\.com/i.test(url) || Boolean(process.env.VERCEL);
}
