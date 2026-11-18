/**
 * Non-urgent toast notifications should not compete with an active dialog.
 * A modal can disable pointer events outside its focus layer, leaving an
 * otherwise visible Sonner close button unclickable.
 *
 * Radix dialogs and Vaul drawers expose open state in the DOM. Do not treat
 * popovers, tooltips or the Sonner notification viewport as blocking dialogs.
 */
export function hasBlockingDialog(root: ParentNode = document): boolean {
  return root.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [vaul-drawer][data-state="open"]',
  ) !== null;
}
