import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MaintenanceAutoTranslation } from './MaintenanceAutoTranslation';

const mocks = vi.hoisted(() => ({
  language: 'en',
  userId: 'manager-one',
  invoke: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.userId } }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: mocks.language }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

beforeEach(() => {
  mocks.language = 'en';
  mocks.userId = 'manager-one';
  mocks.invoke.mockReset();
});
afterEach(() => cleanup());

const report = (ticketId: string) => <MaintenanceAutoTranslation ticketId={ticketId}
  revision="2026-10-14T10:00:00Z"
  fields={{ title: `Унитазная крышка шатается ${ticketId}`, description: 'Проверьте крепление.' }} />;

const mockTranslate = () => mocks.invoke.mockImplementation(async (_name: string, { body }: { body: { texts: string[]; targetLanguage: string } }) => ({
  data: { translatedTexts: body.texts.map(text => text ? `${body.targetLanguage}: ${text}` : '') }, error: null,
}));

describe('forwarded maintenance on-demand translation', () => {
  it('does not translate a list card on mount; batches fields when requested', async () => {
    mockTranslate();
    render(report('ticket-on-demand-one'));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.getByText('Унитазная крышка шатается ticket-on-demand-one')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.invoke).toHaveBeenCalledWith('translate-note', {
      body: {
        texts: ['Унитазная крышка шатается ticket-on-demand-one', 'Проверьте крепление.', '', ''],
        targetLanguage: 'en',
      },
    });
    expect(await screen.findByText('en: Унитазная крышка шатается ticket-on-demand-one')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Original' }));
    expect(screen.getByText('Унитазная крышка шатается ticket-on-demand-one')).toBeTruthy();
  });

  it('retains original report and provides retry if translation fails', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('service down'));
    render(report('ticket-on-demand-two'));
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(await screen.findByText('Translation unavailable; original text shown.')).toBeTruthy();
    expect(screen.getByText('Унитазная крышка шатается ticket-on-demand-two')).toBeTruthy();
    mockTranslate();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('en: Унитазная крышка шатается ticket-on-demand-two')).toBeTruthy();
  });

  it('requests the currently selected language after an opted-in card switches locale', async () => {
    mockTranslate();
    const view = render(report('ticket-on-demand-three'));
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(await screen.findByText('en: Унитазная крышка шатается ticket-on-demand-three')).toBeTruthy();
    mocks.language = 'hu';
    view.rerender(report('ticket-on-demand-three'));
    expect(await screen.findByText('hu: Унитазная крышка шатается ticket-on-demand-three')).toBeTruthy();
    expect(screen.queryByText('en: Унитазная крышка шатается ticket-on-demand-three')).toBeNull();
  });
});
