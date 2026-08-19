export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  /** Public base URL used in QR codes on generated reports. */
  publicVerifyBaseUrl: string;
  corsOrigins: string[];
  reportStorageDir: string;
  /** Maximum age of a signed bridge request before it is rejected. */
  bridgeRequestSkewSeconds: number;
  /** Persist raw UDIDs/serials rather than only salted hashes. */
  retainPlaintextIdentifiers: boolean;
  /**
   * Local-development authentication bypass.
   *
   * When true, every guarded route accepts an injected fake principal and no
   * token is required. This is a total removal of authentication, so it is
   * refused outright when NODE_ENV=production — see `loadConfiguration`.
   */
  devAuthBypass: boolean;
}

const required = (name: string, value: string | undefined, fallback?: string): string => {
  if (value && value.trim()) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
};

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

export const loadConfiguration = (): AppConfig => {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const isProd = nodeEnv === 'production';

  // Development gets working defaults so a fresh clone runs; production refuses
  // to boot on a default secret rather than silently accepting a known key.
  const devDefault = (name: string, value: string): string | undefined =>
    isProd ? undefined : value;

  // A single mistyped environment variable must never be able to serve an
  // unauthenticated API to the internet. This is the one config value that
  // fails the boot rather than falling back to a safe default, because a
  // silent fallback would leave the operator believing bypass was active while
  // the app rejected their requests - and, far worse, the inverse mistake is
  // unrecoverable once traffic reaches it.
  const devAuthBypass = bool(process.env['DEV_AUTH_BYPASS'], false);
  if (devAuthBypass && isProd) {
    throw new Error(
      'DEV_AUTH_BYPASS is enabled but NODE_ENV=production. This would disable ' +
        'authentication on every route. Refusing to start.',
    );
  }

  return {
    port: num(process.env['PORT'], 4000),
    nodeEnv,
    databaseUrl: required(
      'DATABASE_URL',
      process.env['DATABASE_URL'],
      devDefault('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/devdna'),
    ),
    jwt: {
      accessSecret: required(
        'JWT_ACCESS_SECRET',
        process.env['JWT_ACCESS_SECRET'],
        devDefault('JWT_ACCESS_SECRET', 'dev-access-secret-not-for-production'),
      ),
      refreshSecret: required(
        'JWT_REFRESH_SECRET',
        process.env['JWT_REFRESH_SECRET'],
        devDefault('JWT_REFRESH_SECRET', 'dev-refresh-secret-not-for-production'),
      ),
      accessTtlSeconds: num(process.env['JWT_ACCESS_TTL'], 15 * 60),
      refreshTtlSeconds: num(process.env['JWT_REFRESH_TTL'], 30 * 24 * 60 * 60),
    },
    publicVerifyBaseUrl: process.env['PUBLIC_VERIFY_BASE_URL'] ?? 'http://localhost:3000/verify',
    corsOrigins: (process.env['CORS_ORIGINS'] ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    reportStorageDir: process.env['REPORT_STORAGE_DIR'] ?? '.data/reports',
    bridgeRequestSkewSeconds: num(process.env['BRIDGE_SKEW_SECONDS'], 300),
    retainPlaintextIdentifiers: bool(process.env['RETAIN_PLAINTEXT_IDENTIFIERS'], false),
    devAuthBypass,
  };
};

export const CONFIG_TOKEN = 'APP_CONFIG';
