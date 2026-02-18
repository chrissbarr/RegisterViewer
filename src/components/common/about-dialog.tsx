import { GITHUB_URL } from '../../constants';
import { Dialog } from './dialog';
import { GitHubIcon } from './github-icon';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  const tag = __GIT_TAG__;
  const hash = __GIT_HASH__;
  const buildDate = __BUILD_DATE__;

  return (
    <Dialog open={open} onClose={onClose} title="About Register Viewer">
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        A tool for decoding and encoding hardware register values. Define
        register field layouts and interactively inspect or modify values.
      </p>

      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
            Source
          </h3>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            <GitHubIcon />
            {GITHUB_URL.replace('https://', '')}
          </a>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
            Build
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 font-mono">
            {tag !== 'unknown' && <span>{tag} &middot; </span>}
            <span>{hash} &middot; {buildDate}</span>
          </p>
        </div>
      </div>
    </Dialog>
  );
}
