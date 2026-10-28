import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PausableTimerComponent } from './PausableTimerComponent';

const mock = vi.hoisted(() => ({
  write: vi.fn(),
  removeChannel: vi.fn(),
  listener: null as null | ((payload: { new: Record<string, string> }) => void),
  subscriptions: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'staff_attendance') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { status: 'on_break', break_started_at: '2026-10-28T11:00:00.000Z' },
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'room_assignments') {
        return {
          update: (payload: unknown) => {
            mock.write(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    channel: () => {
      const channel = {
        on: (_event: string, _filter: unknown, listener: (payload: { new: Record<string, string> }) => void) => {
          mock.listener = listener;
          return channel;
        },
        subscribe: () => {
          mock.subscriptions();
          return channel;
        },
      };
      return channel;
    },
    removeChannel: mock.removeChannel,
  },
}));

describe('PausableTimerComponent database write frequency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T11:01:00.000Z'));
    mock.write.mockClear();
    mock.removeChannel.mockClear();
    mock.subscriptions.mockClear();
    mock.listener = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('updates the display without writing to Postgres every second', async () => {
    render(
      <PausableTimerComponent
        assignmentId="assignment-1"
        startedAt="2026-10-28T10:59:00.000Z"
        userId="housekeeper-1"
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mock.write).toHaveBeenCalledTimes(1);
    expect(mock.subscriptions).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75_000);
    });
    expect(mock.write).toHaveBeenCalledTimes(1);
    expect(mock.subscriptions).toHaveBeenCalledTimes(1);
  });

  it('deduplicates attendance events and persists the final break duration', async () => {
    render(
      <PausableTimerComponent
        assignmentId="assignment-1"
        startedAt="2026-10-28T10:59:00.000Z"
        userId="housekeeper-1"
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mock.write).toHaveBeenCalledTimes(1);

    await act(async () => {
      mock.listener?.({ new: { status: 'on_break', break_started_at: '2026-10-28T11:00:00.000Z' } });
    });
    expect(mock.write).toHaveBeenCalledTimes(1);

    await act(async () => {
      mock.listener?.({ new: { status: 'checked_in', break_ended_at: '2026-10-28T11:02:10.000Z' } });
    });
    expect(mock.write).toHaveBeenCalledTimes(2);
    expect(mock.write.mock.calls[1][0]).toMatchObject({
      total_break_time_minutes: 2,
    });
    expect(mock.subscriptions).toHaveBeenCalledTimes(1);
  });
});
