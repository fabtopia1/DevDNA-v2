/**
 * Development authentication bypass (web).
 *
 * Enabled with `DEV_AUTH_BYPASS=true`. While on, the dashboard renders without
 * a session, the sign-in screen is unreachable, and a fixed development user is
 * used wherever the real one would be.
 *
 * The API is the actual security boundary — it enforces its own copy of this
 * flag. Turning it on here alone gets you a UI that renders and an API that
 * rejects every call, which is the intended failure direction.
 */

export interface DevUser {
  id: string;
  name: string;
  email: string;
  role: string;
  workspaceId: string;
}

export const DEV_USER: DevUser = {
  id: 'dev-user',
  name: 'DevDNA Test User',
  email: 'test@devdna.local',
  role: 'admin',
  workspaceId: 'devdna-demo-2026',
};

/**
 * Fails closed in production.
 *
 * A build shipped with the flag left on would otherwise serve every tenant's
 * inspection history to anyone who loaded the page. Rather than throwing —
 * which would take a deployed site down on a config typo — the flag is forced
 * off and the mistake is logged loudly. The safe direction here is "requires
 * login", never "does not".
 */
export const devAuthBypassEnabled = (): boolean => {
  const requested = ['1', 'true', 'yes', 'on'].includes(
    (process.env.DEV_AUTH_BYPASS ?? '').toLowerCase(),
  );
  if (requested && process.env.NODE_ENV === 'production') {
    console.error(
      '[devdna] DEV_AUTH_BYPASS is set but NODE_ENV=production. Ignoring it and ' +
        'requiring authentication. Remove the variable from this environment.',
    );
    return false;
  }
  return requested;
};
