/**
 * Adds a drop shadow to screenshots so they stand out against any
 * background (light or dark). Uses a transparent canvas so the shadow
 * blends naturally with GitHub's theme.
 *
 * Run automatically as part of:  npm run screenshots
 */

import { readFileSync, writeFileSync } from 'fs';
import { PNG } from 'pngjs';

const SCREENSHOTS = [
  'docs/images/screenshot-light.png',
  'docs/images/screenshot-dark.png',
  'docs/images/map-view-light.png',
  'docs/images/map-view-dark.png',
];

// Shadow parameters
const SHADOW_BLUR = 8; // blur radius in pixels
const SHADOW_OFFSET_X = 0; // horizontal offset
const SHADOW_OFFSET_Y = 2; // slight downward offset
const SHADOW_OPACITY = 0.3; // max shadow opacity (0–1)
const PADDING = SHADOW_BLUR + Math.max(Math.abs(SHADOW_OFFSET_X), Math.abs(SHADOW_OFFSET_Y));
const CORNER_RADIUS = 4;

/** Simple box blur on a single-channel (alpha) buffer. */
function boxBlur(data: Float64Array, w: number, h: number, radius: number) {
  const out = new Float64Array(w * h);
  const size = radius * 2 + 1;

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += data[y * w + Math.max(0, Math.min(x, w - 1))];
    }
    for (let x = 0; x < w; x++) {
      out[y * w + x] = sum / size;
      const addIdx = Math.min(x + radius + 1, w - 1);
      const removeIdx = Math.max(x - radius, 0);
      sum += data[y * w + addIdx] - data[y * w + removeIdx];
    }
  }

  // Vertical pass
  const result = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += out[Math.max(0, Math.min(y, h - 1)) * w + x];
    }
    for (let y = 0; y < h; y++) {
      result[y * w + x] = sum / size;
      const addIdx = Math.min(y + radius + 1, h - 1);
      const removeIdx = Math.max(y - radius, 0);
      sum += out[addIdx * w + x] - out[removeIdx * w + x];
    }
  }

  return result;
}

function addDropShadow(filePath: string) {
  const buffer = readFileSync(filePath);
  const src = PNG.sync.read(buffer);

  const dstW = src.width + PADDING * 2;
  const dstH = src.height + PADDING * 2;
  const dst = new PNG({ width: dstW, height: dstH });

  // Start with fully transparent canvas
  dst.data.fill(0);

  // Create shadow mask — a filled rounded rectangle
  const shadowAlpha = new Float64Array(dstW * dstH);
  const sx = PADDING + SHADOW_OFFSET_X;
  const sy = PADDING + SHADOW_OFFSET_Y;

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      // Round corners
      let inside = true;
      if (CORNER_RADIUS > 0) {
        const corners = [
          [0, 0],
          [src.width - 1, 0],
          [0, src.height - 1],
          [src.width - 1, src.height - 1],
        ] as const;
        for (const [cx, cy] of corners) {
          const dx = Math.abs(x - cx);
          const dy = Math.abs(y - cy);
          if (dx < CORNER_RADIUS && dy < CORNER_RADIUS) {
            const cornerX = cx < src.width / 2 ? CORNER_RADIUS : src.width - 1 - CORNER_RADIUS;
            const cornerY = cy < src.height / 2 ? CORNER_RADIUS : src.height - 1 - CORNER_RADIUS;
            const dist = Math.sqrt((x - cornerX) ** 2 + (y - cornerY) ** 2);
            if (dist > CORNER_RADIUS) {
              inside = false;
            }
          }
        }
      }

      if (inside) {
        shadowAlpha[(sy + y) * dstW + (sx + x)] = SHADOW_OPACITY;
      }
    }
  }

  // Blur the shadow (two passes for smoother result)
  const blurred = boxBlur(boxBlur(shadowAlpha, dstW, dstH, SHADOW_BLUR), dstW, dstH, SHADOW_BLUR);

  // Apply shadow as black pixels with alpha (transparent background)
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const a = blurred[y * dstW + x];
      if (a > 0) {
        const idx = (y * dstW + x) * 4;
        // RGB stays 0 (black shadow), just set alpha
        dst.data[idx + 3] = Math.round(a * 255);
      }
    }
  }

  // Composite source image on top
  const imgX = PADDING;
  const imgY = PADDING;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const srcIdx = (y * src.width + x) * 4;
      const dstIdx = ((imgY + y) * dstW + (imgX + x)) * 4;
      dst.data[dstIdx] = src.data[srcIdx];
      dst.data[dstIdx + 1] = src.data[srcIdx + 1];
      dst.data[dstIdx + 2] = src.data[srcIdx + 2];
      dst.data[dstIdx + 3] = 255;
    }
  }

  const out = PNG.sync.write(dst);
  writeFileSync(filePath, out);
  console.log(`  + ${filePath} (drop shadow added)`);
}

for (const file of SCREENSHOTS) {
  addDropShadow(file);
}

console.log('\nDone: drop shadows added to all screenshots');
