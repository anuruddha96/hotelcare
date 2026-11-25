import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScanProcessing } from './ScanProcessing';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// Unmount while the canvas mock is still in place, then restore it.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ScanProcessing', () => {
  it.each([
    ['reading', 'pms.scan.reading'],
    ['checking', 'pms.scan.checking'],
    ['details', 'pms.scan.readingPrintedFields'],
  ] as const)('announces the %s step', (step, label) => {
    const { container } = render(<ScanProcessing backdrop={null} step={step} />);
    expect(screen.getByRole('status').textContent).toContain(label);
    expect(container.querySelector(`[data-scan-processing="${step}"]`)).not.toBeNull();
    expect(container.querySelector('img, video, canvas')).toBeNull();
  });

  it('shows only the tiny capture copy, blurred', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), clearRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    const tiny = document.createElement('canvas');
    tiny.width = 40; tiny.height = 25;
    const { container } = render(<ScanProcessing backdrop={tiny} step="reading" />);
    const shown = container.querySelectorAll('canvas');
    expect(shown).toHaveLength(1);
    expect(shown[0].width).toBeLessThanOrEqual(40);
    expect(shown[0].className).toContain('blur-xl');
  });
});
