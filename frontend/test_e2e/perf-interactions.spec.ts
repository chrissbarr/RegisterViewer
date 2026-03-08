import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Thresholds (ms) — tune after baseline data is collected
// ---------------------------------------------------------------------------
// Render thresholds are based on React Profiler actualDuration (real CPU render
// time). E2E thresholds are wall-clock and include Playwright CDP round-trip
// overhead (~50-100ms), so they are set higher than user-felt latency.
//
// Baseline measurements (128-bit / 32-field worst case, dev server):
//   BitGrid render:      ~0.5-0.9ms
//   ValueInputBar render: ~0.2-0.9ms
//   FieldTable render:    ~1.5-9.6ms
//   E2E wall-clock:       ~66-116ms (dominated by CDP overhead)
//
// CI multiplier: set PERF_THRESHOLD_MULTIPLIER env var (default 1)
const CI_MULT = Number(process.env.PERF_THRESHOLD_MULTIPLIER) || 1;

const THRESHOLDS = {
  E2E_LATENCY_MS: 300 * CI_MULT,
  BITGRID_RENDER_MS: 16 * CI_MULT,
  VALUE_INPUT_RENDER_MS: 16 * CI_MULT,
  FIELD_TABLE_RENDER_MS: 30 * CI_MULT,
  RAPID_TOGGLE_TOTAL_MS: 2000 * CI_MULT,
  RAPID_TOGGLE_COUNT: 10,
};

// ---------------------------------------------------------------------------
// Stress fixture injection (mirrors existing E2E pattern via addInitScript)
// ---------------------------------------------------------------------------

interface StressFixtureDef {
  name: string;
  width: number;
  fieldCount: number;
}

const FIXTURES: StressFixtureDef[] = [
  { name: 'STRESS_32_8', width: 32, fieldCount: 8 },
  { name: 'STRESS_64_16', width: 64, fieldCount: 16 },
  { name: 'STRESS_128_32', width: 128, fieldCount: 32 },
];

/**
 * Build a stress register definition inline for injection.
 * We duplicate the factory logic here rather than importing from app source
 * because Playwright tests run in Node, not in the app bundle.
 */
function buildStressState(width: number, fieldCount: number) {
  const fields: Record<string, unknown>[] = [];
  const bitsPerField = Math.max(1, Math.floor(width / fieldCount));
  let currentBit = 0;

  for (let i = 0; i < fieldCount && currentBit < width; i++) {
    const lsb = currentBit;
    const remainingFields = fieldCount - i;
    const remainingBits = width - currentBit;
    const fieldWidth = i === fieldCount - 1
      ? remainingBits
      : Math.min(bitsPerField, remainingBits - (remainingFields - 1));
    const msb = lsb + fieldWidth - 1;

    const id = `stress-field-${i}`;
    const name = `field_${i}`;

    if (fieldWidth === 1) {
      fields.push({ id, name, msb, lsb, type: 'flag' });
    } else if (i % 3 === 1 && fieldWidth <= 4) {
      const entries = Array.from({ length: Math.min(1 << fieldWidth, 4) }, (_, v) => ({
        value: v,
        name: `${name}_opt${v}`,
      }));
      fields.push({ id, name, msb, lsb, type: 'enum', enumEntries: entries });
    } else {
      fields.push({ id, name, msb, lsb, type: 'integer' });
    }

    currentBit = msb + 1;
  }

  const regId = `stress-reg-${width}-${fieldCount}`;
  return {
    registers: [{ id: regId, name: `STRESS_${width}_${fieldCount}`, width, fields }],
    activeRegisterId: regId,
    registerValues: { [regId]: '0x0' },
    mapTableWidth: 32,
    mapShowGaps: true,
    mapSortDescending: false,
    addressUnitBits: 8,
  };
}

async function injectFixture(page: Page, width: number, fieldCount: number) {
  const state = buildStressState(width, fieldCount);
  const localId = 'perf-test-project';
  const now = new Date().toISOString();
  const name = state.registers[0].name;
  const manifest = {
    projects: [{ localId, name, storage: 'local', createdAt: now, localSavedAt: now }],
  };
  // Wrap state in StoredLocalProject format expected by loadProject
  const storedProject = {
    localId,
    cloudId: null,
    name,
    visibility: 'private',
    createdAt: now,
    localSavedAt: now,
    cloudSavedAt: null,
    storage: 'local',
    state,
  };
  await page.addInitScript(({ manifest, storedProject, localId }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('register-viewer-manifest', JSON.stringify(manifest));
    localStorage.setItem(`register-viewer-project:${localId}`, JSON.stringify(storedProject));
    sessionStorage.setItem('register-viewer-active-project', localId);
  }, { manifest, storedProject, localId });
}

// ---------------------------------------------------------------------------
// Measurement helpers
// ---------------------------------------------------------------------------

interface MeasureResult {
  e2eMs: number;
  renders: Record<string, { actualDuration: number; baseDuration: number }[]>;
}

/**
 * Clears perf data, runs an action, waits for a rAF, then reads profiler entries.
 * Returns end-to-end wall-clock time and per-component render durations.
 */
async function measureInteraction(
  page: Page,
  action: () => Promise<void>,
): Promise<MeasureResult> {
  // Clear and record start
  const startTime = await page.evaluate(() => {
    window.__PERF_DATA__?.clear();
    return performance.now();
  });

  // Perform the interaction
  await action();

  // Wait for paint (rAF + microtask flush) then read results in one round-trip
  const result = await page.evaluate((start) => {
    return new Promise<MeasureResult>((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          const endTime = performance.now();
          const entries = window.__PERF_DATA__?.getEntriesSince(start) ?? [];
          const renders: Record<string, { actualDuration: number; baseDuration: number }[]> = {};
          for (const e of entries) {
            if (!renders[e.id]) renders[e.id] = [];
            renders[e.id].push({ actualDuration: e.actualDuration, baseDuration: e.baseDuration });
          }
          resolve({ e2eMs: endTime - start, renders });
        }, 0);
      });
    });
  }, startTime);

  return result;
}

function maxRenderDuration(renders: MeasureResult['renders'], componentId: string): number {
  const entries = renders[componentId] ?? [];
  return Math.max(0, ...entries.map((e) => e.actualDuration));
}

// ---------------------------------------------------------------------------
// Locator helpers (matching existing E2E patterns)
// ---------------------------------------------------------------------------

function hexInput(page: Page) {
  return page.locator('label').filter({ hasText: 'HEX' }).locator('input');
}
function binInput(page: Page) {
  return page.locator('label').filter({ hasText: 'BIN' }).locator('input');
}
function decInput(page: Page) {
  return page.locator('label').filter({ hasText: 'DEC' }).locator('input');
}

// ---------------------------------------------------------------------------
// Tests — parameterized over stress fixtures
// ---------------------------------------------------------------------------

for (const fixture of FIXTURES) {
  test.describe(`perf: ${fixture.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await injectFixture(page, fixture.width, fixture.fieldCount);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: `STRESS_${fixture.width}_${fixture.fieldCount}` })).toBeVisible();
      // Warmup: first interaction has cold-start penalty (JIT, layout, paint)
      const warmupBit = page.locator('[role="button"][aria-label^="Toggle bit 0 "]');
      await warmupBit.click();
      await warmupBit.click(); // toggle back
    });

    // --- Test 1: Bit toggle ---
    test('bit toggle stays under threshold', async ({ page }) => {
      const bitCell = page.locator('[role="button"][aria-label^="Toggle bit 0"]');
      await expect(bitCell).toBeVisible();

      const result = await measureInteraction(page, () => bitCell.click());

      expect(result.e2eMs).toBeLessThan(THRESHOLDS.E2E_LATENCY_MS);
      expect(maxRenderDuration(result.renders, 'BitGrid')).toBeLessThan(THRESHOLDS.BITGRID_RENDER_MS);
    });

    // --- Test 2: Hex input typing ---
    test('hex input typing stays under threshold', async ({ page }) => {
      const input = hexInput(page);
      await input.focus();

      const result = await measureInteraction(page, async () => {
        await page.keyboard.press('A');
      });

      expect(result.e2eMs).toBeLessThan(THRESHOLDS.E2E_LATENCY_MS);
      expect(maxRenderDuration(result.renders, 'ValueInputBar')).toBeLessThan(THRESHOLDS.VALUE_INPUT_RENDER_MS);
    });

    // --- Test 3: Binary input typing ---
    test('binary input typing stays under threshold', async ({ page }) => {
      const input = binInput(page);
      await input.focus();

      const result = await measureInteraction(page, async () => {
        await page.keyboard.press('1');
      });

      expect(result.e2eMs).toBeLessThan(THRESHOLDS.E2E_LATENCY_MS);
      expect(maxRenderDuration(result.renders, 'ValueInputBar')).toBeLessThan(THRESHOLDS.VALUE_INPUT_RENDER_MS);
    });

    // --- Test 4: Decimal input typing ---
    test('decimal input typing stays under threshold', async ({ page }) => {
      const input = decInput(page);
      await input.focus();

      const result = await measureInteraction(page, async () => {
        await page.keyboard.press('5');
      });

      expect(result.e2eMs).toBeLessThan(THRESHOLDS.E2E_LATENCY_MS);
    });

    // --- Test 5: Flag field toggle ---
    test('flag field toggle stays under threshold', async ({ page }) => {
      // Find first flag-type field button in the field table
      const flagButton = page.locator('button', { hasText: /^(set|clear)$/ }).first();
      // Skip if no flag fields in this fixture
      if (await flagButton.count() === 0) return;

      const result = await measureInteraction(page, () => flagButton.click());

      expect(result.e2eMs).toBeLessThan(THRESHOLDS.E2E_LATENCY_MS);
      expect(maxRenderDuration(result.renders, 'FieldTable')).toBeLessThan(THRESHOLDS.FIELD_TABLE_RENDER_MS);
    });

    // --- Test 6: Enum/integer field editing ---
    test('field value editing stays under threshold', async ({ page }) => {
      // Try enum select first, fall back to integer input
      const enumSelect = page.locator('table select').first();
      if (await enumSelect.count() > 0) {
        const options = enumSelect.locator('option');
        const count = await options.count();
        if (count > 1) {
          const lastValue = await options.nth(count - 1).getAttribute('value');
          const result = await measureInteraction(page, () =>
            enumSelect.selectOption(lastValue!),
          );
          expect(result.e2eMs).toBeLessThan(THRESHOLDS.E2E_LATENCY_MS);
          return;
        }
      }

      // Fall back to integer input
      const intInput = page.locator('table input[type="text"]').first();
      if (await intInput.count() > 0) {
        await intInput.focus();
        const result = await measureInteraction(page, () => page.keyboard.press('7'));
        expect(result.e2eMs).toBeLessThan(THRESHOLDS.E2E_LATENCY_MS);
      }
    });

    // --- Test 6.5: Hover over field ---
    test('hover over field stays under threshold', async ({ page }) => {
      // Hover over a field label in the bit grid (grid row 3 elements with field names)
      const fieldLabel = page.locator('[title="field_0"]').first();
      if (await fieldLabel.count() === 0) return;

      await page.evaluate(() => performance.mark('hover-start'));
      await fieldLabel.hover();
      const duration = await page.evaluate(() => {
        performance.mark('hover-end');
        performance.measure('hover', 'hover-start', 'hover-end');
        return performance.getEntriesByName('hover')[0].duration;
      });

      expect(duration).toBeLessThan(THRESHOLDS.E2E_LATENCY_MS);
    });

    // --- Test 7: Rapid bit toggling ---
    test('rapid bit toggling handles all toggles under total threshold', async ({ page }) => {
      const toggleCount = THRESHOLDS.RAPID_TOGGLE_COUNT;

      const startTime = await page.evaluate(() => performance.now());

      for (let i = 0; i < toggleCount; i++) {
        const bitCell = page.locator(`[role="button"][aria-label^="Toggle bit ${i} "]`);
        if (await bitCell.count() === 0) break;
        await bitCell.click();
      }

      const totalMs = await page.evaluate((start) => performance.now() - start, startTime);

      // Verify all bits were actually toggled (they should all be 1 now)
      for (let i = 0; i < toggleCount; i++) {
        const bitCell = page.locator(`[role="button"][aria-label^="Toggle bit ${i} "]`);
        if (await bitCell.count() === 0) break;
        await expect(bitCell.locator('span.font-bold')).toHaveText('1');
      }

      expect(totalMs).toBeLessThan(THRESHOLDS.RAPID_TOGGLE_TOTAL_MS);
    });
  });
}
