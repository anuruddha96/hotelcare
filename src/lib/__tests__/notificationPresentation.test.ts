// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { hasBlockingDialog } from '../notificationPresentation';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('notification display outside active dialogs', () => {
  it('does not block ordinary toast messages or popovers', () => {
    document.body.innerHTML = '<div data-sonner-toaster></div><div data-state="open" role="menu"></div><div data-radix-popper-content-wrapper><div role="dialog" data-state="open"></div></div>';
    expect(hasBlockingDialog()).toBe(false);
  });

  it('defers background notifications while a Radix modal is open', () => {
    document.body.innerHTML = '<div role="dialog" data-state="open" aria-modal="true"></div>';
    expect(hasBlockingDialog()).toBe(true);
  });

  it('defers background notifications while an alert dialog is open', () => {
    document.body.innerHTML = '<div role="alertdialog" data-state="open"></div>';
    expect(hasBlockingDialog()).toBe(true);
  });

  it('allows notifications again after the dialog closes', () => {
    document.body.innerHTML = '<div role="dialog" data-state="closed"></div>';
    expect(hasBlockingDialog()).toBe(false);
  });

  it('respects a supplied subtree rather than unrelated dialogs', () => {
    const container = document.createElement('section');
    container.innerHTML = '<div role="dialog" data-state="open"></div>';
    expect(hasBlockingDialog(container)).toBe(true);
    expect(hasBlockingDialog()).toBe(false);
  });
});
