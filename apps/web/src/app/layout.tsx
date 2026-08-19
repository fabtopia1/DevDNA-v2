import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * Every route renders per request.
 *
 * The CSP in `src/middleware.ts` carries a per-request nonce, and Next.js can
 * only stamp that nonce onto its script tags while rendering dynamically — a
 * prerendered page would ship markup whose scripts the policy then blocks.
 * Nothing here is publicly cacheable anyway: the dashboard is authenticated
 * and report verification must always reflect current data.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'DevDNA SoftwareDNA',
  description: 'iPhone verification for repair, refurbishment and resale businesses.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-ink antialiased">{children}</body>
    </html>
  );
}
