import { AlertTriangle, Check, Loader2, WifiOff } from 'lucide-react';
import type { SyncStatus } from '../../context/cloud-sync-context';

export function SyncStatusIndicator({ status }: { status: SyncStatus }) {
  if (status === 'local-only') return null;

  const config = {
    saved: {
      icon: <Check size={16} aria-hidden="true" />,
      title: 'Saved to cloud',
      className: 'text-green-500 dark:text-green-400',
    },
    syncing: {
      icon: <Loader2 size={16} className="animate-spin" aria-hidden="true" />,
      title: 'Saving to cloud...',
      className: 'text-blue-500 dark:text-blue-400',
    },
    offline: {
      icon: <WifiOff size={16} aria-hidden="true" />,
      title: 'Offline — changes saved locally',
      className: 'text-amber-500 dark:text-amber-400',
    },
    rejected: {
      // Deterministic server rejection (BR-7) — NOT a connectivity problem,
      // so it must not reuse the WifiOff offline rendering.
      icon: <AlertTriangle size={16} aria-hidden="true" />,
      title: 'Cloud rejected the last save — open the register editor to fix the flagged field',
      className: 'text-red-500 dark:text-red-400',
    },
  }[status];

  return (
    <span
      title={config.title}
      aria-label={config.title}
      className={`px-2.5 py-1.5 flex items-center ${config.className}`}
    >
      {config.icon}
    </span>
  );
}
