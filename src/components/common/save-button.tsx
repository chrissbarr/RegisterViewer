import { CloudUpload, Loader2 } from 'lucide-react';
import { useCloudSync, useCloudSyncActions } from '../../context/cloud-sync-context';

export function SaveButton() {
  const cloud = useCloudSync();
  const actions = useCloudSyncActions();

  const isSaving = cloud.status === 'saving';
  const isOwner = cloud.isOwner;
  const hasProject = cloud.cloudId !== null;

  // Only show for projects already saved to cloud (first save happens from My Projects)
  if (!hasProject && !isSaving) return null;

  let tooltip: string;
  if (hasProject && isOwner) {
    tooltip = 'Update cloud copy';
  } else if (hasProject && !isOwner) {
    tooltip = 'Save as copy';
  } else {
    tooltip = 'Save to cloud';
  }

  function handleClick() {
    if (isSaving) return;
    if (hasProject && !isOwner) {
      actions.fork();
    } else {
      actions.saveToCloud();
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isSaving}
      title={tooltip}
      aria-label={tooltip}
      className="px-2.5 py-1.5 rounded-md text-sm font-medium
        bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200
        hover:bg-gray-300 dark:hover:bg-gray-600
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-colors"
    >
      {isSaving ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16} className="block" />}
    </button>
  );
}
