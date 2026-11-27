import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkforceGrid, type WorkforceGridProps } from '@/components/workforce/WorkforceGrid';
import { DEFAULT_CELL_LABELS, type WorkforceStaff } from '@/lib/workforce/model';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('@/hooks/useWorkforce', () => ({
  entryKey: (id: string, date: string) => `${id}|${date}`,
}));

const makeStaff = (count: number): WorkforceStaff[] => Array.from({ length: count }, (_, i) => ({
  id: String(i), full_name: `Employee ${i + 1}`, nickname: null,
  department_id: null, job_role_id: null, hotel_id: 'ottofiori', profile_id: null,
  employment_type: 'full_time', daily_hours: 8, annual_leave_days: null,
  leave_note: null, start_date: null, end_date: null, is_active: true,
  sort_order: i, notes: null, source_label: null,
}));

function props(count: number, overrides: Partial<WorkforceGridProps> = {}): WorkforceGridProps {
  return {
    staff: makeStaff(count), days: ['2026-11-27'], today: '2026-11-27',
    departments: [], jobRoles: [], entries: new Map(), notes: new Map(), leaveUsed: new Map(),
    codes: [], layout: 'days', canEdit: () => true, onApply: async () => true,
    onOpenDetails: vi.fn(), onEditNote: vi.fn(), cellLabels: DEFAULT_CELL_LABELS,
    zoom: 0.9, ...overrides,
  };
}

describe('responsive monthly workforce grid', () => {
  it('fills the available width with flexible employee columns and fixed edge columns', () => {
    const { container, rerender } = render(<WorkforceGrid {...props(10)} />);
    const table = container.querySelector('table')!;
    expect(table.classList.contains('w-full')).toBe(true);
    expect(table.classList.contains('table-fixed')).toBe(true);
    expect(table.style.minWidth).toBe('1096px');
    const cols = table.querySelectorAll('col');
    expect(cols).toHaveLength(12);
    expect(cols[0].style.width).toBe('104px');
    expect(cols[1].style.width).toBe('');
    expect(cols[11].style.width).toBe('72px');
    expect(container.querySelector('[data-cell="0:0"]')?.className).not.toContain('max-w-[92px]');
    rerender(<WorkforceGrid {...props(2)} />);
    expect(table.style.minWidth).toBe('360px');
    expect(table.querySelectorAll('col')).toHaveLength(4);
  });

  it('retains a scrollable minimum width for larger teams and cell selection', () => {
    const { container, getByRole } = render(<WorkforceGrid {...props(50, { zoom: 1.5 })} />);
    expect(container.querySelector('table')?.style.minWidth).toBe('4776px');
    expect(getByRole('grid').className).toContain('overflow-auto');
    const cell = container.querySelector('[data-cell="0:1"]')!;
    fireEvent.mouseDown(cell, { button: 0 });
    expect(cell.getAttribute('aria-selected')).toBe('true');
  });

  it('preserves the compact transposed layout', () => {
    const { container } = render(<WorkforceGrid {...props(2, { layout: 'staff' })} />);
    expect(container.querySelector('table')?.className).not.toContain('table-fixed');
    expect(container.querySelector('[data-cell="0:0"]')?.className).toContain('max-w-[92px]');
  });
});
