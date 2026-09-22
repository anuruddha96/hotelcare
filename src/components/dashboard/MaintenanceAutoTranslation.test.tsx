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
  vi.stubGlobal('IntersectionObserver', undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const report = (ticketId: string) => <MaintenanceAutoTranslation ticketId={ticketId}
  revision="2026-09-22T10:00:00Z"
  fields={{ title: 'Унитазная крышка шатается', description: 'Проверьте крепление.' }} />;

describe('forwarded maintenance automatic translation', () => {
  it('automatically uses selected language, keeps the original and never writes ticket content', async () => {
    mocks.invoke.mockImplementation(async (_name: string, { body }: { body: { text: string; targetLanguage: string } }) => ({
      data: { translatedText: `English: ${body.text}` }, error: null,
    }));
    render(report('ticket-auto-one'));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke).toHaveBeenCalledWith('translate-note', {
      body: { text: 'Унитазная крышка шатается', targetLanguage: 'en' },
    });
    expect(await screen.findByText('English: Унитазная крышка шатается')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Original' }));
    expect(screen.getByText('Унитазная крышка шатается')).toBeTruthy();
    expect(screen.queryByText('English: Унитазная крышка шатается')).toBeNull();
  });

  it('shows the untouched report and a retry when the translator is unavailable', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('service down'));
    render(report('ticket-auto-two'));
    expect(screen.getByText('Унитазная крышка шатается')).toBeTruthy();
    expect(await screen.findByText('Translation unavailable; original text shown.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('invalidates the previous translation when the selected language changes', async () => {
    mocks.invoke.mockImplementation(async (_name: string, { body }: { body: { text: string; targetLanguage: string } }) => ({
      data: { translatedText: `${body.targetLanguage}: ${body.text}` }, error: null,
    }));
    const view = render(report('ticket-auto-three'));
    expect(await screen.findByText('en: Унитазная крышка шатается')).toBeTruthy();
    mocks.language = 'hu';
    view.rerender(report('ticket-auto-three'));
    expect(await screen.findByText('hu: Унитазная крышка шатается')).toBeTruthy();
    expect(screen.queryByText('en: Унитазная крышка шатается')).toBeNull();
  });
});
