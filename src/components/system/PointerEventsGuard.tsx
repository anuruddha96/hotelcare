import { useEffect } from "react";

/**
 * App-wide safety net for the Radix "dead page" bug.
 *
 * Radix locks the page while a modal layer is open by writing
 * `pointer-events: none` onto <body>, and removes it when that layer closes.
 * If a hover card, tooltip or popover is unmounted mid-gesture — which happens
 * constantly on the rate calendar, where cells re-render under the finger —
 * the cleanup never runs and the lock stays behind. Everything still looks
 * normal, but no click, tap or button press reaches the page again until a
 * reload. That is what made "Update 132 prices" appear to do nothing.
 *
 * Instead of patching each dialog, this watches the body for that lock and
 * removes it whenever no Radix layer is actually open, so any screen in the
 * app recovers by itself within a frame.
 */
const OPEN_LAYER_SELECTOR = [
  "[data-radix-popper-content-wrapper]",
  "[role='dialog'][data-state='open']",
  "[role='alertdialog'][data-state='open']",
  "[role='menu'][data-state='open']",
  "[data-radix-focus-guard]",
  "[data-state='open'][data-radix-dialog-content]",
  "[vaul-drawer][data-state='open']",
].join(",");

export function PointerEventsGuard() {
  useEffect(() => {
    const hasOpenLayer = () => document.querySelector(OPEN_LAYER_SELECTOR) !== null;

    const check = () => {
      if (document.body.style.pointerEvents !== "none") return;
      if (hasOpenLayer()) return;
      document.body.style.removeProperty("pointer-events");
    };

    // Watch the body attribute itself: the fix runs the moment the stale lock
    // is written, not on a timer.
    const observer = new MutationObserver(check);
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    observer.observe(document.body, { childList: true, subtree: false });

    // A user gesture that lands on a locked page is the clearest signal that
    // the lock is stale — recover immediately so the very next tap works.
    const onGesture = () => {
      if (document.body.style.pointerEvents === "none" && !hasOpenLayer()) {
        document.body.style.removeProperty("pointer-events");
      }
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("touchstart", onGesture, { capture: true, passive: true });
    window.addEventListener("keydown", onGesture, true);
    document.addEventListener("visibilitychange", check);

    check();
    return () => {
      observer.disconnect();
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("touchstart", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return null;
}

export default PointerEventsGuard;
