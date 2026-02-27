/**
 * Compares freshly-generated screenshots against the versions in git HEAD.
 * If a screenshot hasn't meaningfully changed (pixel diff below threshold),
 * it is restored from git so it won't appear as a dirty file.
 *
 * Run automatically as part of:  npm run screenshots
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/** Maximum fraction of changed pixels before we consider the image "different". */
const DIFF_THRESHOLD = 0.001; // 0.1%

const SCREENSHOTS = [
  'docs/images/screenshot-light.png',
  'docs/images/screenshot-dark.png',
  'docs/images/map-view-light.png',
  'docs/images/map-view-dark.png',
];

function getGitVersion(filePath: string): Buffer | null {
  try {
    return execSync(`git show HEAD:${filePath}`, {
      encoding: 'buffer',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // File doesn't exist in git yet
    return null;
  }
}

function decodePng(buffer: Buffer): PNG {
  return PNG.sync.read(buffer);
}

function compareImages(a: PNG, b: PNG): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const totalPixels = a.width * a.height;
  const diffPixels = pixelmatch(a.data, b.data, null, a.width, a.height, {
    threshold: 0.1,
  });
  return diffPixels / totalPixels;
}

let revertedCount = 0;
let updatedCount = 0;
let newCount = 0;

for (const file of SCREENSHOTS) {
  const gitBuffer = getGitVersion(file);

  if (!gitBuffer) {
    console.log(`  + ${file} (new — no previous version in git)`);
    newCount++;
    continue;
  }

  const currentBuffer = readFileSync(file);
  const gitPng = decodePng(gitBuffer);
  const currentPng = decodePng(currentBuffer);
  const diffRatio = compareImages(gitPng, currentPng);
  const diffPercent = (diffRatio * 100).toFixed(3);

  if (diffRatio <= DIFF_THRESHOLD) {
    execSync(`git checkout HEAD -- ${file}`);
    console.log(`  = ${file} (${diffPercent}% diff — reverted)`);
    revertedCount++;
  } else {
    console.log(`  * ${file} (${diffPercent}% diff — updated)`);
    updatedCount++;
  }
}

console.log(
  `\nDone: ${updatedCount} updated, ${revertedCount} reverted, ${newCount} new`,
);
