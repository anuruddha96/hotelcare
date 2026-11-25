import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { GozsduLaundryDutyUniversalSlot } from '../GozsduLaundryDutyUniversalSlot';

function createWizard(title: string, withStaffSlot = false) {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const heading = document.createElement('div');
  heading.textContent = title;
  const scroll = document.createElement('div');
  scroll.className = 'flex-1 min-h-0 overflow-y-auto';
  const content = document.createElement('p');
  content.textContent = 'The saved plan must remain intact';
  scroll.append(content);
  if (withStaffSlot) {
    const staffSlot = document.createElement('div');
    staffSlot.dataset.gozsduLaundrynerSlot = 'true';
    scroll.prepend(staffSlot);
  }
  dialog.append(heading, scroll);
  document.body.append(dialog);
  return { dialog, scroll };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('Gozsdu Laundryner access in tomorrow Auto Assign', () => {
  it('adds an in-flow slot when a saved plan opens directly on Preview', async () => {
    const { scroll } = createWizard('Tomorrow · 08:00 release');
    const { unmount } = render(<GozsduLaundryDutyUniversalSlot open workDate="2026-09-20" />);
    await waitFor(() => expect(scroll.querySelector('[data-laundryner-fallback]')).not.toBeNull());
    expect(scroll.textContent).toContain('The saved plan must remain intact');
    unmount();
    expect(scroll.querySelector('[data-laundryner-fallback]')).toBeNull();
  });

  it('does not create a competing slot when Staff already provides one', () => {
    const { scroll } = createWizard('Tomorrow · 08:00 release', true);
    render(<GozsduLaundryDutyUniversalSlot open workDate="2026-09-20" />);
    expect(scroll.querySelectorAll('[data-gozsdu-laundryner-slot]')).toHaveLength(1);
    expect(scroll.querySelector('[data-laundryner-fallback]')).toBeNull();
  });

  it('ignores dialogs belonging to unrelated features', () => {
    const { scroll } = createWizard('Unrelated staff dialog');
    render(<GozsduLaundryDutyUniversalSlot open workDate="2026-09-20" />);
    expect(scroll.querySelector('[data-laundryner-fallback]')).toBeNull();
  });

  it('waits for the PMS gate to mount the actual tomorrow wizard', async () => {
    const { unmount } = render(<GozsduLaundryDutyUniversalSlot open workDate="2026-09-20" />);
    const { scroll } = createWizard('Tomorrow · 08:00 release');
    await waitFor(() => expect(scroll.querySelector('[data-laundryner-fallback]')).not.toBeNull());
    unmount();
    expect(scroll.querySelector('[data-laundryner-fallback]')).toBeNull();
  });
});
