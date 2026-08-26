export interface SparkleCursorOptions {
  /** Hex colors sparkles are drawn from. Defaults to the palette minus the page background. */
  colors?: string[];
  /** Size of the reusable sparkle pool, and so the cap on DOM nodes. */
  maxSparkles?: number;
  /** Pointer travel, in px, between sparkles. */
  spawnDistance?: number;
  /** How long a sparkle lives, in ms. */
  lifetime?: number;
  minSize?: number;
  maxSize?: number;
}

/** Starts the sparkle trail. Returns a teardown that removes it entirely. */
export function startSparkleCursor(options?: SparkleCursorOptions): () => void;
