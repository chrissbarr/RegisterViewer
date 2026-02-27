/** Default display name for projects without a title */
export const DEFAULT_PROJECT_NAME = 'Untitled Project';

/** Visibility levels for cloud-saved projects */
export type Visibility = 'private' | 'unlisted';

/** Lightweight entry in the project manifest (no project data, no ownerToken) */
export interface ProjectManifestEntry {
  localId: string;          // UUID v4
  cloudId: string | null;   // 12-char base62
  name: string;
  visibility: Visibility;
  createdAt: string;        // ISO 8601
  localSavedAt: string;     // ISO 8601
  cloudSavedAt: string | null;
}

/** The manifest stored at `register-viewer-manifest` */
export interface ProjectManifest {
  version: 1;
  projects: ProjectManifestEntry[];
}

/** Full project record stored at `register-viewer-project:{localId}` */
export interface StoredLocalProject {
  localId: string;
  cloudId: string | null;
  name: string;
  visibility: Visibility;
  createdAt: string;
  localSavedAt: string;
  cloudSavedAt: string | null;
  ownerToken: string | null;
  state: import('./register').SerializedAppState;
}

/** UI-safe view type — omits ownerToken to prevent secret leakage */
export interface ProjectListEntry {
  localId: string;
  cloudId: string | null;
  name: string;
  visibility: Visibility;
  createdAt: string;
  localSavedAt: string;
  cloudSavedAt: string | null;
  isCloudSaved: boolean;      // derived: cloudId !== null
}

/** Global preferences stored at `register-viewer-prefs` */
export interface GlobalPreferences {
  theme: 'light' | 'dark';
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}
