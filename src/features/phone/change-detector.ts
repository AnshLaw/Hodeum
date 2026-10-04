import { difference } from "./frame-math";

/** Frame-to-frame difference that means something is moving (a tap, a scroll, a page sliding in). */
export const MOTION_THRESHOLD = 2;
/** How different the settled screen must be from the last one to count as a learner action. */
export const CHANGE_THRESHOLD = 6;
/** Animations finish before Hodey reads the new screen. */
export const SETTLE_MS = 600;

/**
 * Stands in for mouse and keyboard hooks on the mirrored phone: reports one learner action each time
 * the screen changes and then holds still, so OCR runs on the finished screen, not mid-animation.
 */
export class ChangeDetector {
  private baseline: Uint8Array | undefined;
  private last: Uint8Array | undefined;
  private movedAt: number | undefined;

  push(thumb: Uint8Array, at: number): boolean {
    if (!this.baseline || !this.last) {
      this.baseline = thumb;
      this.last = thumb;
      return false;
    }
    const moving = difference(thumb, this.last) > MOTION_THRESHOLD;
    this.last = thumb;
    if (moving) {
      this.movedAt = at;
      return false;
    }
    if (this.movedAt === undefined || at - this.movedAt < SETTLE_MS) return false;
    this.movedAt = undefined;
    const changed = difference(thumb, this.baseline) > CHANGE_THRESHOLD;
    this.baseline = thumb;
    return changed;
  }

  reset(): void {
    this.baseline = undefined;
    this.last = undefined;
    this.movedAt = undefined;
  }
}
