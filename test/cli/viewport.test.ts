import { describe, expect, it } from "vitest";
import {
  scrollDown,
  scrollUp,
  selectVisibleItems,
  totalTimelineLines,
} from "../../src/cli/tui/viewport.js";
import type { TimelineItem } from "../../src/cli/tui/types.js";

function sys(id: string, text: string): TimelineItem {
  return { id, kind: "system", text };
}

describe("selectVisibleItems", () => {
  const items: TimelineItem[] = Array.from({ length: 20 }, (_, i) =>
    sys(`s${i}`, `line-${i}`),
  );

  it("pins to bottom when linesFromBottom is 0", () => {
    const view = selectVisibleItems(items, 5, 0, 80);
    expect(view.atBottom).toBe(true);
    expect(view.items.map((i) => i.id)).toEqual([
      "s15",
      "s16",
      "s17",
      "s18",
      "s19",
    ]);
  });

  it("scrolls up to older items", () => {
    const view = selectVisibleItems(items, 5, 5, 80);
    expect(view.atBottom).toBe(false);
    expect(view.items[0]?.id).toBe("s10");
    expect(view.canScrollDown).toBe(true);
  });

  it("clamps overscroll", () => {
    const view = selectVisibleItems(items, 5, 999, 80);
    expect(view.linesFromBottom).toBe(15);
    expect(view.items[0]?.id).toBe("s0");
  });
});

describe("scrollUp / scrollDown", () => {
  it("moves toward and away from bottom", () => {
    const total = 40;
    const max = 10;
    expect(scrollUp(0, total, max, 5)).toBe(5);
    expect(scrollDown(5, total, max, 5)).toBe(0);
    expect(scrollDown(0, total, max, 5)).toBe(0);
  });
});

describe("totalTimelineLines", () => {
  it("counts tool rows as one line", () => {
    const items: TimelineItem[] = [
      {
        id: "t1",
        kind: "tool",
        toolCallId: "c",
        toolName: "read",
        subject: "a.ts",
        status: "done",
        expanded: false,
        output: "x\n".repeat(50),
      },
    ];
    expect(totalTimelineLines(items, 80)).toBe(1);
  });
});
