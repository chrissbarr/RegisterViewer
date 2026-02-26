import { Cloud, House } from 'lucide-react';

interface CloudStatusIndicatorProps {
  isCloudSaved: boolean;
}

/** Read-only icon showing cloud or local status. Not interactive. */
export function CloudStatusIndicator({ isCloudSaved }: CloudStatusIndicatorProps) {
  if (isCloudSaved) {
    return (
      <span
        title="Saved to cloud"
        aria-label="Saved to cloud"
        className="text-blue-500 dark:text-blue-400 shrink-0"
      >
        <Cloud size={16} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      title="Local only"
      aria-label="Local only"
      className="text-gray-400 dark:text-gray-500 shrink-0"
    >
      <House size={16} aria-hidden="true" />
    </span>
  );
}
