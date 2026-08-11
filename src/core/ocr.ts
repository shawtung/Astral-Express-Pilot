import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ocr from '@gutenye/ocr-node';
import type { Page } from 'playwright';
import { grab, type Region } from './capture.ts';
import { MODELS_DIR, TMP_DIR } from './config.ts';
import { containsFuzzy } from './match.ts';

export type OcrLine = {
  text: string;
  mean: number;
  box?: number[][];
};

type OcrEngine = { detect: (image: string) => Promise<OcrLine[]> };

let engine: Promise<OcrEngine> | null = null;

/** Loads PP-OCRv4 (Chinese) once; the first call takes a few seconds. */
export function getOcr(): Promise<OcrEngine> {
  // Left unset outside a packaged build, where the models resolve from node_modules on their own.
  const models = MODELS_DIR
    ? {
        detectionPath: join(MODELS_DIR, 'ch_PP-OCRv4_det_infer.onnx'),
        recognitionPath: join(MODELS_DIR, 'ch_PP-OCRv4_rec_infer.onnx'),
        dictionaryPath: join(MODELS_DIR, 'ppocr_keys_v1.txt'),
      }
    : undefined;
  engine ??= Ocr.create({ models }) as Promise<OcrEngine>;
  return engine;
}

export type ReadOptions = {
  /** Upscale factor before OCR; small in-game text detects much better at 2-3x. */
  scale?: number;
  /** Keep the intermediate PNG for inspection instead of deleting it. */
  keepFile?: boolean;
};

export async function readRegion(page: Page, region: Region, options: ReadOptions = {}): Promise<OcrLine[]> {
  const png = await grab(page, region, { scale: options.scale ?? 2 });
  return readBuffer(png, options);
}

export async function readBuffer(png: Buffer, options: ReadOptions = {}): Promise<OcrLine[]> {
  await mkdir(TMP_DIR, { recursive: true });
  const file = join(TMP_DIR, `roi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  await writeFile(file, png);
  try {
    return await (await getOcr()).detect(file);
  } finally {
    if (!options.keepFile) await rm(file, { force: true });
  }
}

export function joinText(lines: OcrLine[]): string {
  return lines.map((l) => l.text).join(' ');
}

/** A line of text found on screen, with its centre already back in game coordinates. */
export type Located = {
  text: string;
  x: number;
  y: number;
};

/**
 * Finds a line inside `region` and reports where to click it, which beats hardcoding a point
 * for anything the game draws at a position we have not measured.
 */
export async function locateText(
  page: Page,
  region: Region,
  wanted: string,
  options: ReadOptions & { minScore?: number } = {},
): Promise<Located | null> {
  const scale = options.scale ?? 2;
  const lines = await readRegion(page, region, { ...options, scale });

  for (const line of lines) {
    if (!line.box?.length) continue;
    if (!containsFuzzy(line.text, wanted, options.minScore ?? 0.6)) continue;

    const xs = line.box.map((point) => point[0] ?? 0);
    const ys = line.box.map((point) => point[1] ?? 0);
    return {
      text: line.text,
      x: region.x + (Math.min(...xs) + Math.max(...xs)) / 2 / scale,
      y: region.y + (Math.min(...ys) + Math.max(...ys)) / 2 / scale,
    };
  }
  return null;
}
