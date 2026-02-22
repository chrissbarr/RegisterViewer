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
        <path d="M3.5 2.75a.75.75 0 0 0-1.5 0v10.5a.75.75 0 0 0 1.5 0v-4.5h4v4.5a.75.75 0 0 0 1.5 0V7.5h3.25a.75.75 0 0 0 .53-1.28l-3.5-3.5a.75.75 0 0 0-1.06 0L5.5 5.94V2.75ZM7.5 6h3.94l-2-2L7.5 6Z" />
      </svg>
    </span>
  );
}
