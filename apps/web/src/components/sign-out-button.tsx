'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/login');
        router.refresh();
      }}
      className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-panel disabled:opacity-60"
    >
      Sign out
    </button>
  );
}
