/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security headers, including the Content-Security-Policy, are set per
  // request in `src/middleware.ts` so the policy can carry a fresh nonce for
  // Next.js's inline bootstrap script.
  poweredByHeader: false,
};

export default nextConfig;
