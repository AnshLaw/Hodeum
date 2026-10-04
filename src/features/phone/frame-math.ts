import type { Rect, ScreenTone, Size } from "../../lib/types";

/** Portrait iPhone screens are 9 : 19.5. */
export const IPHONE_ASPECT = 9 / 19.5;
/** Same budget as desktop captures for the vision model (PRD §12). */
export const MAX_PHONE_SIDE = 1280;
/** Change detection and tone run on a tiny grayscale thumbnail. */
export const THUMB_WIDTH = 32;
export const THUMB_HEIGHT = 64;
/** Mean luma (0–255) below which the screen counts as dark. iOS Dark Mode lists sit near 20. */
export const DARK_TONE_LUMA = 80;
const LUMA = { r: 0.299, g: 0.587, b: 0.114 };
const RGBA = 4;

/** Capture cards pillarbox the portrait phone inside 16:9; keep just the centred phone. */
export function phoneCrop(width: number, height: number): Rect {
  if (width <= height) return { x: 0, y: 0, width, height };
  const cropWidth = Math.round(height * IPHONE_ASPECT);
  return { x: Math.round((width - cropWidth) / 2), y: 0, width: cropWidth, height };
}

export function fitWithin(width: number, height: number, maxSide: number): Size {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function grayscale(rgba: Uint8ClampedArray): Uint8Array {
  const gray = new Uint8Array(rgba.length / RGBA);
  for (let i = 0; i < gray.length; i++) {
    const o = i * RGBA;
    gray[i] = Math.round(rgba[o] * LUMA.r + rgba[o + 1] * LUMA.g + rgba[o + 2] * LUMA.b);
  }
  return gray;
}

export function meanLuma(gray: Uint8Array): number {
  let sum = 0;
  for (const value of gray) sum += value;
  return gray.length === 0 ? 0 : sum / gray.length;
}

export function toneOf(gray: Uint8Array): ScreenTone {
  return meanLuma(gray) < DARK_TONE_LUMA ? "dark" : "light";
}

/** Mean absolute difference between two equal-size thumbnails (0–255). */
export function difference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return a.length === 0 ? 0 : sum / a.length;
}
