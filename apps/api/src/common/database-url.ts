/**
 * Test databases live beside the development one on the same server, so a test
 * run never touches development data. The names live here, once.
 */
export const DATABASE_NAMES = {
  test: 'nts_test',
  e2e: 'nts_e2e',
  /** The database `CREATE DATABASE` itself is issued against. */
  maintenance: 'postgres',
} as const;

export type DatabaseName = (typeof DATABASE_NAMES)[keyof typeof DATABASE_NAMES];

/** Derives a sibling database URL from `baseUrl`, keeping credentials and host. */
export function siblingDatabaseUrl(baseUrl: string, name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}
