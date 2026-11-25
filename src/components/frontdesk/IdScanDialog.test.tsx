import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdScanDialog } from './IdScanDialog';

const mocks = vi.hoisted(() => ({
  profile: { role: 'reception', organization_slug: 'rdhotels' } as { role: string; organization_slug: string },
  torch: false,
  torchOn: false,
  acquireCamera: vi.fn(),
  releaseCamera: vi.fn(),
  holdCamera: vi.fn(),
  setTorch: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ profile: mocks.profile }) }));
vi.mock('@/lib/idScan/ocrSession', () => ({
  OcrSession: class {
    warm = vi.fn(async () => ({}));
    reset = vi.fn();
  },
}));
vi.mock('@/lib/idScan/cameraSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/idScan/cameraSession')>();
  return {
    ...actual,
    acquireCamera: mocks.acquireCamera,
    releaseCamera: mocks.releaseCamera,
    holdCamera: mocks.holdCamera,
    setTorch: mocks.setTorch,
    torchAvailable: () => mocks.torch,
    torchIsOn: () => mocks.torchOn,
    cameraWasAsked: () => false,
  };
});

const fakeStream = { getVideoTracks: () => [], getTracks: () => [] } as unknown as MediaStream;

beforeEach(() => {
  localStorage.clear();
  mocks.profile = { role: 'reception', organization_slug: 'rdhotels' };
  mocks.torch = false;
  mocks.torchOn = false;
  mocks.acquireCamera.mockReset().mockResolvedValue(fakeStream);
  mocks.releaseCamera.mockReset();
  mocks.holdCamera.mockReset();
  mocks.setTorch.mockReset().mockImplementation(async (on: boolean) => { mocks.torchOn = on; return true; });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  // No 2D canvas in jsdom: the live check just reports "move closer".
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('IdScanDialog at the desk', () => {
  it('shows the live camera while aiming, with no photo buttons and no image notice', async () => {
    render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    await waitFor(() => expect(mocks.acquireCamera).toHaveBeenCalled());
    expect(document.querySelector('video')).not.toBeNull();
    expect(await screen.findByRole('button', { name: /pms.scan.captureFirst/ })).toBeTruthy();
    expect(screen.queryByText('pms.scan.choosePhoto')).toBeNull();
    expect(screen.queryByText('pms.scan.takeNewPhoto')).toBeNull();
    expect(screen.queryByText('pms.scan.privacy')).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it.each([
    ['the sandbox test hotel', { role: 'reception', organization_slug: 'channex' }],
    ['an administrator', { role: 'admin', organization_slug: 'rdhotels' }],
  ])('lets %s load a specimen photo for validation tests', async (_who, profile) => {
    mocks.profile = profile;
    render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    expect(await screen.findByText('pms.scan.choosePhoto')).toBeTruthy();
    expect(document.querySelector('input[type="file"]')?.hasAttribute('capture')).toBe(false);
  });

  it('offers the flashlight only when the camera has one, cycling automatic → on → off', async () => {
    mocks.torch = true;
    render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    const auto = await screen.findByRole('button', { name: 'pms.scan.light.auto' });
    fireEvent.click(auto);
    expect(await screen.findByRole('button', { name: 'pms.scan.light.on' })).toBeTruthy();
    expect(mocks.setTorch).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'pms.scan.light.on' }));
    expect(await screen.findByRole('button', { name: 'pms.scan.light.off' })).toBeTruthy();
    expect(mocks.setTorch).toHaveBeenLastCalledWith(false);
    expect(JSON.parse(localStorage.getItem('hotelcare.reception.camera.v1') ?? '{}').torch).toBe('off');
  });

  it('has no flashlight button on cameras without a light', async () => {
    render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    await screen.findByRole('button', { name: /pms.scan.captureFirst/ });
    expect(screen.queryByRole('button', { name: /pms.scan.light/ })).toBeNull();
  });

  it('keeps the camera ready for the next guest when the dialog closes', async () => {
    const { rerender } = render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    await waitFor(() => expect(mocks.acquireCamera).toHaveBeenCalled());
    mocks.releaseCamera.mockClear();
    rerender(<IdScanDialog open={false} onOpenChange={() => undefined} onApply={() => 'applied'} />);
    expect(mocks.releaseCamera).toHaveBeenCalled();
  });

  it('offers a retry when the camera cannot be opened', async () => {
    mocks.acquireCamera.mockRejectedValueOnce(new Error('NotAllowedError')).mockResolvedValue(fakeStream);
    render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    expect(await screen.findByText('pms.scan.noCamera')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'pms.scan.retry' }));
    await waitFor(() => expect(mocks.acquireCamera).toHaveBeenCalledTimes(2));
  });
});
