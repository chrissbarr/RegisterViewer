import { useCloudProject, useCloudActions } from '../../context/cloud-context';

function CloudUploadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" className={className}>
      <path d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 1.956 5.38 4.522a3.752 3.752 0 0 1-1.13 7.228H4.25a4.251 4.251 0 0 1-.907-8.408ZM8.75 9V6.75a.75.75 0 0 0-1.5 0V9h-1.5a.25.25 0 0 0-.177.427l2.25 2.25a.25.25 0 0 0 .354 0l2.25-2.25A.25.25 0 0 0 10.25 9h-1.5Z" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="16" height="16">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function SaveButton() {
  const cloud = useCloudProject();
  const actions = useCloudActions();

  const isSaving = cloud.status === 'saving';
  const isOwner = cloud.isOwner;
  const hasProject = cloud.projectId !== null;

  let tooltip: string;
  if (hasProject && isOwner) {
    tooltip = 'Update saved project';
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
      actions.save();
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
      {isSaving ? <SpinnerIcon /> : <CloudUploadIcon className="block" />}
    </button>
  );
}
