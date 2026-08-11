import type { Page } from 'playwright';
import type { Region } from './capture.ts';
import { PLAYER_SELECTOR } from './config.ts';

export type Rgb = [number, number, number];

export type RegionStats = {
  mean: Rgb;
  /** Mean per-channel absolute deviation. Flat areas sit near 0, artwork is far above it. */
  spread: number;
};

/**
 * Summarises a region's pixels. The maths runs inside the page so only the summary crosses
 * the CDP wire instead of a full RGBA buffer.
 */
export async function regionStats(page: Page, region: Region): Promise<RegionStats> {
  return page.evaluate(
    ({ sel, roi }) => {
      const source = document.querySelector(sel) as HTMLCanvasElement | HTMLVideoElement | null;
      if (!source) throw new Error(`game player not found: ${sel}`);
      const off = document.createElement('canvas');
      off.width = roi.width;
      off.height = roi.height;
      const ctx = off.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      ctx.drawImage(source, roi.x, roi.y, roi.width, roi.height, 0, 0, roi.width, roi.height);
      const { data } = ctx.getImageData(0, 0, roi.width, roi.height);

      const sum = [0, 0, 0];
      const pixels = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        sum[0]! += data[i]!;
        sum[1]! += data[i + 1]!;
        sum[2]! += data[i + 2]!;
      }
      const mean = sum.map((v) => v / pixels) as [number, number, number];

      let deviation = 0;
      for (let i = 0; i < data.length; i += 4) {
        deviation +=
          Math.abs(data[i]! - mean[0]) +
          Math.abs(data[i + 1]! - mean[1]) +
          Math.abs(data[i + 2]! - mean[2]);
      }
      return { mean, spread: deviation / (pixels * 3) };
    },
    { sel: PLAYER_SELECTOR, roi: region },
  );
}

/** Colours at individual game-space points, for cheap card-frame signature checks. */
export async function samplePoints(page: Page, points: { x: number; y: number }[]): Promise<Rgb[]> {
  return page.evaluate(
    ({ sel, pts }) => {
      const source = document.querySelector(sel) as HTMLCanvasElement | HTMLVideoElement | null;
      if (!source) throw new Error(`game player not found: ${sel}`);
      const off = document.createElement('canvas');
      off.width = Math.max(pts.length, 1);
      off.height = 1;
      const ctx = off.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      // Copies one pixel per point instead of the whole frame, which keeps this cheap.
      pts.forEach((p, i) => ctx.drawImage(source, p.x, p.y, 1, 1, i, 0, 1, 1));
      const { data } = ctx.getImageData(0, 0, off.width, 1);
      return pts.map((_, i) => [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!] as [number, number, number]);
    },
    { sel: PLAYER_SELECTOR, pts: points },
  );
}

export function colourDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Greyscale thumbnail of a region, small enough that stream compression noise averages out.
 * Two copies of the same card produce nearly the same values, different cards do not.
 */
export async function fingerprint(page: Page, region: Region, size = 8): Promise<number[]> {
  return page.evaluate(
    ({ sel, roi, n }) => {
      const source = document.querySelector(sel) as HTMLCanvasElement | HTMLVideoElement | null;
      if (!source) throw new Error(`game player not found: ${sel}`);
      const off = document.createElement('canvas');
      off.width = n;
      off.height = n;
      const ctx = off.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, roi.x, roi.y, roi.width, roi.height, 0, 0, n, n);

      const { data } = ctx.getImageData(0, 0, n, n);
      const out: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        out.push((data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000);
      }
      return out;
    },
    { sel: PLAYER_SELECTOR, roi: region, n: size },
  );
}

/** Mean absolute difference between two fingerprints, in 0-255 grey levels. */
export function fingerprintDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('fingerprint size mismatch');
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}
