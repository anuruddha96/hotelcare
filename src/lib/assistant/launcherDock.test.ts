import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DOCK,
  dockBounds,
  dockToPoint,
  measureTopBars,
  readDock,
  releaseVelocity,
  serializeDock,
  snapToEdge,
} from "./launcherDock";

// iPhone 15 portrait with its notch and home indicator.
const phone = dockBounds({ width: 393, height: 852 }, { top: 59, right: 0, bottom: 34, left: 0 });
const midX = (phone.minX + phone.maxX) / 2;

describe("Mira launcher dock bounds", () => {
  it("keeps the button inside the safe area with a small gap from each edge", () => {
    expect(phone).toEqual({ minX: 8, maxX: 393 - 8 - 56, minY: 59 + 12, maxY: 852 - 34 - 24 - 56 });
  });

  it("clears a landscape notch on the side", () => {
    const landscape = dockBounds({ width: 852, height: 393 }, { top: 0, right: 59, bottom: 21, left: 59 });
    expect(landscape.minX).toBe(59 + 8);
    expect(landscape.maxX).toBe(852 - 59 - 8 - 56);
  });

  it("never inverts on a tiny viewport", () => {
    const tiny = dockBounds({ width: 40, height: 40 });
    expect(tiny.maxX).toBe(tiny.minX);
    expect(tiny.maxY).toBe(tiny.minY);
    expect(snapToEdge({ x: 20, y: 20 }, tiny).ratio).toBe(0);
  });
});

describe("Mira launcher edge snapping", () => {
  it("never rests in the middle of the screen, wherever it is let go", () => {
    for (let x = -50; x <= 450; x += 25) {
      for (let y = -50; y <= 900; y += 50) {
        const rest = dockToPoint(snapToEdge({ x, y }, phone), phone);
        expect([phone.minX, phone.maxX]).toContain(rest.x);
        expect(rest.y).toBeGreaterThanOrEqual(phone.minY);
        expect(rest.y).toBeLessThanOrEqual(phone.maxY);
      }
    }
  });

  it("settles on the nearer side and keeps the height it was dropped at", () => {
    const left = dockToPoint(snapToEdge({ x: midX - 40, y: 300 }, phone), phone);
    expect(left.x).toBe(phone.minX);
    expect(left.y).toBeCloseTo(300);

    const right = dockToPoint(snapToEdge({ x: midX + 40, y: 500 }, phone), phone);
    expect(right.x).toBe(phone.maxX);
    expect(right.y).toBeCloseTo(500);
  });

  it("follows a fling towards the far side", () => {
    expect(snapToEdge({ x: midX - 60, y: 400 }, phone, { x: 1.5, y: 0 }).side).toBe("right");
    expect(snapToEdge({ x: phone.maxX - 20, y: 400 }, phone, { x: -2.5, y: 0 }).side).toBe("left");
  });

  it("ignores a slow drift at the moment of release", () => {
    expect(snapToEdge({ x: midX - 60, y: 400 }, phone, { x: 0.05, y: 0 }).side).toBe("left");
  });

  it("stops at the top and bottom limits", () => {
    expect(snapToEdge({ x: 0, y: -400 }, phone).ratio).toBe(0);
    expect(snapToEdge({ x: 0, y: 5000 }, phone).ratio).toBe(1);
    expect(snapToEdge({ x: 0, y: phone.maxY - 10 }, phone, { x: 0, y: 3 }).ratio).toBe(1);
  });

  it("keeps its side and relative height when the phone rotates", () => {
    const dock = snapToEdge({ x: phone.maxX - 5, y: (phone.minY + phone.maxY) / 2 }, phone);
    const landscape = dockBounds({ width: 852, height: 393 }, { top: 0, right: 59, bottom: 21, left: 59 });
    const rest = dockToPoint(dock, landscape);
    expect(rest.x).toBe(landscape.maxX);
    expect(rest.y).toBeCloseTo((landscape.minY + landscape.maxY) / 2);
  });

  it("starts on the right edge, a little below the middle", () => {
    expect(DEFAULT_DOCK.side).toBe("right");
    expect(dockToPoint(DEFAULT_DOCK, phone).x).toBe(phone.maxX);
  });
});

describe("Mira launcher release speed", () => {
  it("measures px per ms over the last moments of the drag", () => {
    const samples = [
      { x: 100, y: 400, t: 1000 },
      { x: 140, y: 400, t: 1016 },
      { x: 180, y: 392, t: 1032 },
      { x: 200, y: 390, t: 1040 },
    ];
    expect(releaseVelocity(samples)).toEqual({ x: 2.5, y: -0.25 });
  });

  it("ignores movement from before a pause", () => {
    expect(releaseVelocity([{ x: 0, y: 0, t: 1000 }, { x: 300, y: 0, t: 1050 }, { x: 300, y: 0, t: 1400 }])).toEqual({ x: 0, y: 0 });
  });

  it("is zero without enough samples", () => {
    expect(releaseVelocity([])).toEqual({ x: 0, y: 0 });
    expect(releaseVelocity([{ x: 10, y: 10, t: 5 }])).toEqual({ x: 0, y: 0 });
  });
});

describe("Mira launcher saved position", () => {
  it("round-trips the saved side and height", () => {
    expect(readDock(serializeDock({ side: "left", ratio: 0.25 }), phone)).toEqual({ side: "left", ratio: 0.25 });
  });

  it("clamps an out-of-range height and rejects anything else", () => {
    expect(readDock('{"side":"right","ratio":4}', phone)).toEqual({ side: "right", ratio: 1 });
    expect(readDock('{"side":"middle","ratio":0.5}', phone)).toBeNull();
    expect(readDock("not json", phone)).toBeNull();
    expect(readDock("null", phone)).toBeNull();
    expect(readDock(null, phone)).toBeNull();
  });

  it("moves a position saved by the old pill to the nearest edge", () => {
    // The old pill sat a little right of centre (its left edge just left of the middle).
    const migrated = readDock(JSON.stringify({ x: 170, y: 640 }), phone);
    expect(migrated?.side).toBe("right");
    expect(dockToPoint(migrated!, phone).y).toBeCloseTo(640);

    expect(readDock(JSON.stringify({ x: 20, y: 200 }), phone)?.side).toBe("left");
  });
});

describe("Mira launcher below the app header", () => {
  it("never rests inside the sticky header", () => {
    const withHeader = dockBounds({ width: 393, height: 852 }, { top: 59, right: 0, bottom: 34, left: 0 }, 140);
    expect(withHeader.minY).toBe(140 + 12);
    expect(withHeader.maxY).toBe(phone.maxY);
    expect(dockToPoint(snapToEdge({ x: 300, y: 0 }, withHeader), withHeader).y).toBe(152);
  });

  it("still clears the notch when it reaches lower than the header", () => {
    expect(dockBounds({ width: 393, height: 852 }, { top: 59, right: 0, bottom: 34, left: 0 }, 30).minY).toBe(59 + 12);
  });
});

describe("Mira launcher top bar detection", () => {
  const viewport = { width: 393, height: 852 };
  const columns = [36, 357];
  const added: HTMLElement[] = [];

  function bar(position: string, zIndex: string, top: number, bottom: number, width = viewport.width) {
    const element = document.createElement("div");
    element.style.position = position;
    element.style.zIndex = zIndex;
    element.getBoundingClientRect = () => ({ top, bottom, left: 0, right: width, width, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
    document.body.appendChild(element);
    added.push(element);
    return { element, top, bottom };
  }

  function hitTest(bars: Array<{ element: HTMLElement; top: number; bottom: number }>) {
    (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = (_x, y) =>
      bars.filter((item) => item.top <= y && y < item.bottom).map((item) => item.element);
  }

  afterEach(() => {
    delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
    added.splice(0).forEach((element) => element.remove());
  });

  it("finds the header and a sticky navigation strip stacked under it", () => {
    hitTest([
      bar("sticky", "50", 0, 120), // app header
      bar("sticky", "40", 120, 164), // sticky module navigation
      bar("sticky", "10", 164, 200), // a table's own sticky header: the button may sit over it
      bar("fixed", "40", 100, 156, 56), // the button itself
      bar("fixed", "50", 0, 852), // an open dialog's backdrop
    ]);
    expect(measureTopBars(window, viewport, columns)).toBe(164);
  });

  it("ignores bars that scroll with the page", () => {
    hitTest([bar("static", "50", 0, 120), bar("relative", "50", 0, 120)]);
    expect(measureTopBars(window, viewport, columns)).toBe(0);
  });

  it("is 0 where the browser can't tell what is on screen", () => {
    expect(measureTopBars(window, viewport, columns)).toBe(0);
  });
});
