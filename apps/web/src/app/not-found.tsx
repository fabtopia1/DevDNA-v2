import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-4">
      <div className="text-center">
        <p className="text-sm font-semibold text-ink">Not found</p>
        <p className="mt-1 text-xs text-muted">
          This report or inspection does not exist, or is not visible to your workspace.
        </p>
        <Link href="/dashboard" className="mt-4 inline-block text-xs font-medium text-brand">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
