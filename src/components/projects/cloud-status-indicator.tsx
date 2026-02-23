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
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 1.956 5.38 4.522a3.752 3.752 0 0 1-1.13 7.228H4.25a4.251 4.251 0 0 1-.907-8.408Z" />
        </svg>
      </span>
    );
  }

  return (
    <span
      title="Local only"
      aria-label="Local only"
      className="text-gray-400 dark:text-gray-500 shrink-0"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
        <path d="M8.354 1.146a.5.5 0 0 0-.708 0l-6.5 6.5A.5.5 0 0 0 1.5 8.5h1v5a1 1 0 0 0 1 1h2.5a.5.5 0 0 0 .5-.5V11a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v3a.5.5 0 0 0 .5.5H12a1 1 0 0 0 1-1v-5h1.5a.5.5 0 0 0 .354-.854l-6.5-6.5Z" />
      </svg>
    </span>
  );
}
