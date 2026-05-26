import type { ProjectListEntry, StoredLocalProject } from '../types/project';

type ProjectCloudIdentity = Pick<ProjectListEntry | StoredLocalProject, 'cloudId' | 'storage'>;

export function isOwnedCloudEntry<T extends ProjectCloudIdentity>(
  entry: T,
): entry is T & { cloudId: string; storage: 'cloud' } {
  return entry.storage === 'cloud' && typeof entry.cloudId === 'string' && entry.cloudId.length > 0;
}
