// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createNotificationEventGate, createNotificationSoundGate, hasBlockingDialog, shouldSendSystemNotification } from '../notificationPresentation';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

describe('quiet background notification delivery', () => {
  it('uses the in-app alert instead of a duplicate OS alert in the foreground', () => {
    expect(shouldSendSystemNotification('visible')).toBe(false);
    expect(shouldSendSystemNotification('hidden')).toBe(true);
  });
  it('allows one sound per 15 seconds without suppressing distinct events', () => {
    const allow = createNotificationSoundGate();
    expect(allow(0)).toBe(true);
    expect(allow(1)).toBe(false);
    expect(allow(14_999)).toBe(false);
    expect(allow(15_000)).toBe(true);
  });
  it('deduplicates identified event replays, not different rooms or recipients', () => {
    const allow = createNotificationEventGate();
    expect(allow('user:assignment:1', 0)).toBe(true);
    expect(allow('user:assignment:1', 1)).toBe(false);
    expect(allow('user:assignment:2', 1)).toBe(true);
    expect(allow('other:assignment:1', 1)).toBe(true);
    expect(allow('user:assignment:1', 60_000)).toBe(true);
  });
  it('keeps revenue activity in the bell without mounting a catch-up toast', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/revenue/RevenueAutomationNotifications.tsx'), 'utf8');
    expect(source).not.toContain('toast.message');
    expect(source).not.toContain('CATCH_UP_DELAY_MS');
    expect(source).toContain('unreadCount > 0');
    expect(source).toContain('markAllRead()');
    expect(source).toContain('openDetail(item)');
  });
});
