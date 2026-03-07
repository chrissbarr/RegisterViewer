import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';

interface PerfEntry {
  id: string;
  phase: 'mount' | 'update';
  actualDuration: number;
  baseDuration: number;
  timestamp: number;
}

interface PerfData {
  entries: PerfEntry[];
  clear(): void;
  getEntriesSince(timestamp: number): PerfEntry[];
}

declare global {
  interface Window {
    __PERF_DATA__?: PerfData;
  }
}

function ensurePerfData(): PerfData {
  if (!window.__PERF_DATA__) {
    const entries: PerfEntry[] = [];
    window.__PERF_DATA__ = {
      entries,
      clear() {
        entries.length = 0;
      },
      getEntriesSince(timestamp: number) {
        return entries.filter((e) => e.timestamp >= timestamp);
      },
    };
  }
  return window.__PERF_DATA__;
}

interface Props {
  id: string;
  children: ReactNode;
}

export function PerfProfiler({ id, children }: Props) {
  if (!__PERF_PROFILING__) {
    return children;
  }

  const onRender: ProfilerOnRenderCallback = (
    profilerId,
    phase,
    actualDuration,
    baseDuration,
  ) => {
    const data = ensurePerfData();
    data.entries.push({
      id: profilerId,
      phase: phase as 'mount' | 'update',
      actualDuration,
      baseDuration,
      timestamp: performance.now(),
    });
  };

  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}
