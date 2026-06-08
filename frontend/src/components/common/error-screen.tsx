import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * Full-screen "Unable to load project" card. Shared by AppLoader's
 * `phase:'error'` path and the last-resort ErrorBoundary fallback so both
 * render one styled card. Context-free (no AnnouncerProvider/MotionConfig
 * dependency) so it stays usable from the boundary.
 */
export function ErrorScreen({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="h-screen flex items-center justify-center bg-gray-950 text-gray-100">
      <div className="max-w-md w-full mx-4 rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <TriangleAlert size={24} className="text-red-400 shrink-0" />
          <h2 className="text-lg font-bold">Unable to load project</h2>
        </div>
        <p className="text-sm text-gray-300 mb-6">{message}</p>
        {action}
      </div>
    </div>
  );
}
