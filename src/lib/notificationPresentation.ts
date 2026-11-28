/**
 * Non-urgent toast notifications should not compete with an active dialog.
 * A modal can disable pointer events outside its focus layer, leaving an
 * otherwise visible Sonner close button unclickable.
 *
 * Radix dialogs and Vaul drawers expose open state in the DOM. Do not treat
 * popovers, tooltips or the Sonner notification viewport as blocking dialogs.
 */
export function hasBlockingDialog(root: ParentNode = document): boolean {
  const openLayers = root.querySelectorAll(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [vaul-drawer][data-state="open"]',
  );

  // Radix non-modal Popover.Content also uses role="dialog". Unlike a real
  // modal, it lives inside a popper wrapper and does not trap outside clicks.
  return Array.from(openLayers).some(
    (element) => !element.closest('[data-radix-popper-content-wrapper]'),
  );
}

/** A foreground toast already delivers the event; avoid an additional OS alert.
 * Hidden pages still receive system notifications, including their deep links.
 */
export function shouldSendSystemNotification(visibility: DocumentVisibilityState): boolean {
  return visibility !== 'visible';
}

/** Shared across hook instances; only suppress sound, never distinct alerts. */
export function createNotificationSoundGate(cooldownMs = 15_000) {
  let lastPlayed = -Infinity;
  return (now = Date.now()) => {
    if (now >= lastPlayed && now - lastPlayed < cooldownMs) return false;
    lastPlayed = now;
    return true;
  };
}

/** Suppress replay of the same identified database event across hook instances.
 * Never deduplicate by message text: different rooms can have identical labels.
 */
export function createNotificationEventGate(ttlMs = 60_000) {
  const seen = new Map<string, number>();
  return (key: string, now = Date.now()) => {
    for (const [id, timestamp] of seen) {
      if (now < timestamp || now - timestamp >= ttlMs) seen.delete(id);
    }
    if (seen.has(key)) return false;
    seen.set(key, now);
    return true;
  };
}
