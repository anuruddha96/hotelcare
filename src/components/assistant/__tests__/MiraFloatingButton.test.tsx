import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import MiraFloatingButton from "../MiraFloatingButton";

// jsdom has no PointerEvent: without this, clientX/clientY are dropped.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "touch";
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

const KEY = "hc-mira-launcher-position:test-user";
// A 390 × 844 phone: the button may rest at x 8 (left) or 326 (right), y 12–764.
const LEFT_X = 8;
const RIGHT_X = 390 - 8 - 56;
const MID_X = (LEFT_X + RIGHT_X) / 2;

let now = 0;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function position(button: HTMLElement) {
  const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(button.style.transform);
  if (!match) throw new Error(`No position in "${button.style.transform}"`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** Presses the button's centre, moves through the given points (16 ms apart) and lets go. */
function drag(button: HTMLElement, path: Array<[number, number]>, { pauseBeforeRelease = true, cancel = false } = {}) {
  const start = position(button);
  const from: [number, number] = [start.x + 28, start.y + 28];
  fireEvent.pointerDown(button, { pointerId: 1, clientX: from[0], clientY: from[1] });
  for (const [x, y] of path) {
    now += 16;
    fireEvent.pointerMove(button, { pointerId: 1, clientX: x, clientY: y });
  }
  if (pauseBeforeRelease) now += 250;
  const [endX, endY] = path[path.length - 1];
  if (cancel) fireEvent.pointerCancel(button, { pointerId: 1, clientX: 0, clientY: 0 });
  else fireEvent.pointerUp(button, { pointerId: 1, clientX: endX, clientY: endY });
}

function renderButton(onOpen = vi.fn()) {
  render(<MiraFloatingButton storageKey={KEY} unread={false} onOpen={onOpen} />);
  return { button: screen.getByRole("button", { name: "Open Mira AI Operator" }), onOpen };
}

describe("Mira floating button", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewport(390, 844);
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it("is a round button resting on the right edge, and a tap opens Mira", () => {
    const { button, onOpen } = renderButton();
    expect(button).toHaveClass("rounded-full", "h-14", "w-14");
    expect(button).not.toHaveTextContent(/Mira/);
    expect(button).toHaveAttribute("data-side", "right");
    expect(position(button).x).toBe(RIGHT_X);

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 350, clientY: 490 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 352, clientY: 491 }); // finger wobble, not a drag
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 352, clientY: 491 });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(position(button).x).toBe(RIGHT_X);
  });

  it("follows the finger while dragged, then settles on the nearer edge without opening Mira", () => {
    const { button, onOpen } = renderButton();
    const start = position(button);
    fireEvent.pointerDown(button, { pointerId: 1, clientX: start.x + 28, clientY: start.y + 28 });
    now += 16;
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 150, clientY: 300 });
    expect(button).toHaveAttribute("data-dragging", "true");
    expect(position(button)).toEqual({ x: 150 - 28, y: 300 - 28 });

    now += 250;
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 150, clientY: 300 });
    fireEvent.click(button); // the click a mouse sends after a drag
    expect(onOpen).not.toHaveBeenCalled();
    expect(button).not.toHaveAttribute("data-dragging");
    expect(button).toHaveAttribute("data-side", "left");
    expect(position(button)).toEqual({ x: LEFT_X, y: 300 - 28 });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ side: "left" });
  });

  it("never stays in the middle of the screen", () => {
    const { button } = renderButton();
    for (const x of [MID_X - 30, MID_X, MID_X + 1, 60, 300]) {
      drag(button, [[x + 28, 420]]);
      expect([LEFT_X, RIGHT_X]).toContain(position(button).x);
    }
  });

  it("lands on the far side when flicked towards it", () => {
    const { button } = renderButton();
    // Let go while still right of centre, but moving fast to the left.
    drag(button, [[330, 480], [290, 478], [250, 476], [215, 474]], { pauseBeforeRelease: false });
    expect(button).toHaveAttribute("data-side", "left");
    expect(position(button).x).toBe(LEFT_X);
  });

  it("still settles on an edge when the browser cancels the drag", () => {
    const { button } = renderButton();
    drag(button, [[200, 400], [100, 380]], { cancel: true });
    expect(button).not.toHaveAttribute("data-dragging");
    expect(position(button).x).toBe(LEFT_X);
  });

  it("does not swallow the next tap when a touch drag sends no click", () => {
    const { button, onOpen } = renderButton();
    drag(button, [[100, 300]]);
    fireEvent.pointerDown(button, { pointerId: 2, clientX: 36, clientY: 300 });
    fireEvent.pointerUp(button, { pointerId: 2, clientX: 36, clientY: 300 });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("remembers the chosen edge and keeps it when the phone rotates", () => {
    localStorage.setItem(KEY, JSON.stringify({ side: "left", ratio: 0.25 }));
    const { button } = renderButton();
    expect(position(button)).toEqual({ x: LEFT_X, y: Math.round(12 + 0.25 * (764 - 12)) });

    act(() => {
      setViewport(844, 390);
      window.dispatchEvent(new Event("resize"));
    });
    expect(button).toHaveAttribute("data-side", "left");
    expect(position(button)).toEqual({ x: LEFT_X, y: Math.round(12 + 0.25 * (390 - 24 - 56 - 12)) });

    act(() => {
      setViewport(390, 844);
      window.dispatchEvent(new Event("resize"));
    });
    expect(position(button).x).toBe(LEFT_X);
  });

  it("moves a position saved by the old pill to the nearest edge", () => {
    localStorage.setItem(KEY, JSON.stringify({ x: 170, y: 640 }));
    const { button } = renderButton();
    expect(button).toHaveAttribute("data-side", "right");
    expect(position(button)).toEqual({ x: RIGHT_X, y: 640 });
  });

  it("announces an unread reply", () => {
    render(<MiraFloatingButton storageKey={KEY} unread onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open Mira AI Operator, unread reply" })).toBeInTheDocument();
  });
});
