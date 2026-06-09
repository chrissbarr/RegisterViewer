import { serializeImportResult } from './storage';
import type { ImportResult } from './storage';
import type { AppState, SerializedAppState } from '../types/register';

/**
 * The four ways a freshly-fetched cloud project can be persisted locally,
 * taxonomizing the five persist-a-fetched-project sites (P1–P5):
 *
 * - `replace` — overwrite the local record straight from the import result,
 *   DROPPING local-only UI fields (P1: `persistDownloadedCloudProject`).
 * - `create`  — create a new local record from the import result, also dropping
 *   UI fields (P2: `createOwnedCloudProject`, P5: `loadCloudProject` owned).
 * - `merge`   — overwrite register data but PRESERVE the existing local-only UI
 *   fields (activeRegisterId / mapTableWidth / mapShowGaps / mapSortDescending)
 *   (P4: `checkAndPullFreshVersion` localId branch).
 * - `skip`    — non-writing: the local cache is dirty/conflicted and must keep
 *   the user's in-progress edits (P3: hydrate dirty-cache branch).
 *
 * `replace`/`create` and `merge` differ precisely on UI-field preservation;
 * unifying them onto one helper is only safe because the helper honors the mode
 * faithfully — `replace`/`create` keep dropping UI fields. (P1/P2/P5 run only on
 * fresh hydration / load where no diverged UI fields exist.)
 */
type CloudWriteMode = 'replace' | 'merge' | 'create' | 'skip';

/** The subset of a fetched cloud project this helper serializes. */
export type MaterializeImportResult = Pick<
  ImportResult,
  'registers' | 'values' | 'project' | 'addressUnitBits'
>;

/** Side-effect callbacks injected by the calling hook/component. */
interface MaterializeCallbacks {
  /**
   * Persist the serialized project state through the call site's storage
   * primitive (saveProject / createProject / patchProjectState). Returns whether
   * the write succeeded so callers can short-circuit follow-up steps.
   */
  persist: (serialized: SerializedAppState) => boolean;
  /**
   * Read the current local state for `localId` so `merge` mode can preserve its
   * UI-only fields. Only invoked for `merge`. Returns `null` when no record
   * exists (then defaults are used).
   */
  loadExistingState: (localId: string) => AppState | null;
}

interface MaterializeParams {
  writeMode: CloudWriteMode;
  localId: string | null;
  cloudId: string;
  importResult: MaterializeImportResult;
  callbacks: MaterializeCallbacks;
}

interface MaterializeResult {
  /** True when the helper invoked `persist` and it succeeded. */
  persisted: boolean;
}

/**
 * Build the serialized state for a `merge` write: register data from the import
 * result, UI-only fields preserved from the existing local record (or storage
 * defaults when none exists). Mirrors the manual build at the P4 site.
 */
function mergeSerialized(
  importResult: MaterializeImportResult,
  existing: AppState | null,
): SerializedAppState {
  const registerValues: Record<string, string> = {};
  for (const [id, value] of Object.entries(importResult.values)) {
    registerValues[id] = '0x' + value.toString(16);
  }
  return {
    registers: importResult.registers,
    registerValues,
    activeRegisterId: existing?.activeRegisterId ?? importResult.registers[0]?.id ?? '',
    project: importResult.project,
    addressUnitBits: importResult.addressUnitBits ?? 8,
    mapTableWidth: existing?.mapTableWidth ?? 32,
    mapShowGaps: existing?.mapShowGaps ?? true,
    mapSortDescending: existing?.mapSortDescending ?? false,
  };
}

/**
 * Unify the five persist-a-fetched-project paths behind one `writeMode`-driven
 * helper. The helper owns the load-bearing serialization decision (drop vs.
 * preserve UI fields, or skip entirely); the call site's storage primitive and
 * any follow-up side effects (metadata write, IMPORT_STATE dispatch) live in the
 * injected `persist` callback.
 */
export function materializeCloudProject(params: MaterializeParams): MaterializeResult {
  const { writeMode, localId, importResult, callbacks } = params;

  if (writeMode === 'skip') {
    return { persisted: false };
  }

  let serialized: SerializedAppState;
  if (writeMode === 'merge') {
    const existing = localId !== null ? callbacks.loadExistingState(localId) : null;
    serialized = mergeSerialized(importResult, existing);
  } else {
    // 'replace' | 'create': serialize straight from the import result, which
    // omits the map UI fields and defaults activeRegisterId to the first
    // register (UI fields fall back to storage defaults on read).
    serialized = serializeImportResult(importResult);
  }

  return { persisted: callbacks.persist(serialized) };
}
