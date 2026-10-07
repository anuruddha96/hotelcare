import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationProvider } from '@/hooks/useTranslation';
import { PreCompleteChecklistDialog } from './PreCompleteChecklistDialog';

afterEach(() => {
  localStorage.clear();
});

function renderLinenOnly(language: 'en' | 'hu') {
  localStorage.setItem('preferred_language', language);
  const onConfirm = vi.fn();

  render(
    <TranslationProvider>
      <PreCompleteChecklistDialog
        open
        onOpenChange={() => undefined}
        onConfirm={onConfirm}
        onOpenDirtyLinen={() => undefined}
        onOpenMinibar={() => undefined}
        showMinibar={false}
      />
    </TranslationProvider>,
  );

  return onConfirm;
}

describe('SLNT linen-only completion confirmation', () => {
  it('keeps the dirty-linen confirmation and removes minibar in English', () => {
    const onConfirm = renderLinenOnly('en');

    expect(screen.getByText('All dirty linen added')).toBeInTheDocument();
    expect(screen.queryByText('Minibar consumption recorded')).not.toBeInTheDocument();

    const complete = screen.getByRole('button', { name: 'Complete room' });
    expect(complete).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(complete).toBeEnabled();

    fireEvent.click(complete);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('uses the selected language for the remaining confirmation', () => {
    renderLinenOnly('hu');

    expect(screen.getByText('Az összes koszos ágynemű hozzáadva')).toBeInTheDocument();
    expect(screen.queryByText('Minibár fogyasztás rögzítve')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Szoba befejezése' })).toBeInTheDocument();
  });
});
