/**
 * Claude/OpenCode-style transcript viewport: app-owned scroll + sticky bottom.
 * Stock Ink has no ScrollBox — we only render the visible item window.
 */

import type { TimelineItem } from "./types.js";

export interface ViewportWindow {
  items: TimelineItem[];
  /** 0 = pinned to bottom (sticky). */
  linesFromBottom: number;
  totalLines: number;
  maxLines: number;
  atBottom: boolean;
  canScrollUp: boolean;
  canScrollDown: boolean;
}

export function estimateItemLines(item: TimelineItem, columns: number): number {
  const cols = Math.max(20, columns);
  switch (item.kind) {
    case "system":
    case "error":
    case "done":
      return 1;
    case "tool":
      return 1;
    case "user":
      return 2 + wrapLines(item.text, cols);
    case "assistant":
      // Header + rough wrapped body (markdown chrome ignored).
      return 2 + wrapLines(item.text, cols);
    default:
      return 1;
  }
}

export function estimateStreamLines(text: string, columns: number): number {
  if (!text) return 0;
  return 2 + wrapLines(text, columns) + 1; // header + body + cursor
}

export function totalTimelineLines(
  items: TimelineItem[],
  columns: number,
): number {
  return items.reduce((sum, item) => sum + estimateItemLines(item, columns), 0);
}

/**
 * Pick timeline items overlapping the viewport window ending
 * `linesFromBottom` above the transcript end.
 */
export function selectVisibleItems(
  items: TimelineItem[],
  maxLines: number,
  linesFromBottom: number,
  columns: number,
): ViewportWindow {
  const heights = items.map((item) => estimateItemLines(item, columns));
  const totalLines = heights.reduce((a, b) => a + b, 0);
  const maxScroll = Math.max(0, totalLines - Math.max(1, maxLines));
  const clamped = clamp(linesFromBottom, 0, maxScroll);
  const viewEnd = totalLines - clamped;
  const viewStart = Math.max(0, viewEnd - Math.max(1, maxLines));

  const visible: TimelineItem[] = [];
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    const h = heights[i]!;
    const itemStart = cursor;
    const itemEnd = cursor + h;
    if (itemEnd > viewStart && itemStart < viewEnd) {
      visible.push(items[i]!);
    }
    cursor = itemEnd;
  }

  return {
    items: visible,
    linesFromBottom: clamped,
    totalLines,
    maxLines: Math.max(1, maxLines),
    atBottom: clamped === 0,
    canScrollUp: clamped < maxScroll,
    canScrollDown: clamped > 0,
  };
}

/** Move scroll away from bottom (older history). */
export function scrollUp(
  linesFromBottom: number,
  totalLines: number,
  maxLines: number,
  delta: number,
): number {
  const maxScroll = Math.max(0, totalLines - Math.max(1, maxLines));
  return clamp(linesFromBottom + delta, 0, maxScroll);
}

/** Move scroll toward bottom (newer). 0 re-enables sticky follow. */
export function scrollDown(
  linesFromBottom: number,
  totalLines: number,
  maxLines: number,
  delta: number,
): number {
  const maxScroll = Math.max(0, totalLines - Math.max(1, maxLines));
  return clamp(linesFromBottom - delta, 0, maxScroll);
}

function wrapLines(text: string, columns: number): number {
  if (!text) return 1;
  let lines = 0;
  for (const raw of text.split(/\r?\n/)) {
    const len = raw.length || 1;
    lines += Math.ceil(len / columns);
  }
  return Math.max(1, lines);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
