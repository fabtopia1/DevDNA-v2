import { InspectFlow } from '@/components/inspect-flow';

export const metadata = { title: 'New inspection · DevDNA' };

export default function InspectPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">New inspection</h1>
        <p className="mt-1 text-xs text-muted">
          Connect an iPhone to this workstation by USB, unlock it, and tap Trust when prompted.
        </p>
      </div>
      <InspectFlow />
    </div>
  );
}
