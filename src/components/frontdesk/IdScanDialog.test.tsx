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
  recognizeDetailed: vi.fn(),
  recognizeWithConfidence: vi.fn(),
  ready: false,
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ profile: mocks.profile }) }));
vi.mock('@/lib/idScan/ocrSession', () => ({
  OcrSession: class {
    warm = vi.fn(async () => ({}));
    reset = vi.fn();
    recognizeDetailed = mocks.recognizeDetailed;
    recognizeWithConfidence = mocks.recognizeWithConfidence;
  },
}));
vi.mock('@/lib/idScan/autoCapture', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/idScan/autoCapture')>(),
  assessReadiness: () => mocks.ready ? 'ready' : 'moveCloser',
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
  mocks.ready = false;
  mocks.recognizeDetailed.mockReset().mockResolvedValue({text:'',confidence:30,lines:[]});
  mocks.recognizeWithConfidence.mockReset().mockResolvedValue({text:'',confidence:30});
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
  it('requires an explicit document choice before requesting the camera', async () => {
    render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    expect(screen.getByText('pms.scan.selectDocument')).toBeTruthy();
    expect(mocks.acquireCamera).not.toHaveBeenCalled();
    expect(document.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docPassport/ }));
    await waitFor(() => expect(mocks.acquireCamera).toHaveBeenCalled());
    expect(screen.getByText('pms.scan.passportPhotoOnly')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'pms.scan.changeDocument' }));
    expect(screen.getByText('pms.scan.selectDocument')).toBeTruthy();
    expect(document.querySelector('video')).toBeNull();
  });
  it('shows the live camera while aiming, with no photo buttons and no image notice', async () => {
    render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docPassport/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docPassport/ }));
    expect(await screen.findByText('pms.scan.choosePhoto')).toBeTruthy();
    expect(document.querySelector('input[type="file"]')?.hasAttribute('capture')).toBe(false);
  });

  it('offers the flashlight only when the camera has one, cycling automatic → on → off', async () => {
    mocks.torch = true;
    render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docPassport/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docPassport/ }));
    await screen.findByRole('button', { name: /pms.scan.captureFirst/ });
    expect(screen.queryByRole('button', { name: /pms.scan.light/ })).toBeNull();
  });

  it('keeps the camera ready for the next guest when the dialog closes', async () => {
    const { rerender } = render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docPassport/ }));
    await waitFor(() => expect(mocks.acquireCamera).toHaveBeenCalled());
    mocks.releaseCamera.mockClear();
    rerender(<IdScanDialog open={false} onOpenChange={() => undefined} onApply={() => 'applied'} />);
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docPassport/ }));
    expect(mocks.releaseCamera).toHaveBeenCalled();
  });

  it('offers a retry when the camera cannot be opened', async () => {
    mocks.acquireCamera.mockRejectedValueOnce(new Error('NotAllowedError')).mockResolvedValue(fakeStream);
    render(<IdScanDialog open onOpenChange={() => undefined} onApply={() => 'applied'} />);
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docPassport/ }));
    expect(await screen.findByText('pms.scan.noCamera')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'pms.scan.retry' }));
    await waitFor(() => expect(mocks.acquireCamera).toHaveBeenCalledTimes(2));
  });
});


async function captureSyntheticDocument() {
  mocks.ready = true;
  const capture = await screen.findByRole('button', { name: /pms.scan.captureFirst/ });
  const video = document.querySelector('video')!;
  Object.defineProperties(video, { videoWidth: { value: 320, configurable:true }, videoHeight: { value: 220, configurable:true } });
  vi.spyOn(video,'getBoundingClientRect').mockReturnValue({width:320,height:220,x:0,y:0,top:0,left:0,right:320,bottom:220,toJSON:()=>({})});
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => {
    return {drawImage:vi.fn(), clearRect:vi.fn(), putImageData:vi.fn(),
      getImageData: (_x:number,_y:number,w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)})} as unknown as CanvasRenderingContext2D;
  });
  fireEvent.click(capture);
}

describe('document-specific retry controls', () => {
  it('does not ask for the back when passport text is detected but code lines cannot be read', async () => {
    mocks.recognizeWithConfidence.mockResolvedValue({text:'PASSPORT / PASSEPORT',confidence:78});
    render(<IdScanDialog open onOpenChange={()=>undefined} onApply={()=> 'applied'}/>);
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docPassport/ }));
    await captureSyntheticDocument();
    expect(await screen.findByText('pms.scan.passportSelectedRetry')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'pms.scan.nextSide'})).toBeNull();
    expect(screen.queryByRole('button',{name:'pms.scan.confirmIdType'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'pms.scan.retry'}));
    expect(await screen.findByText('pms.scan.passportPhotoOnly')).toBeTruthy();
    expect(screen.queryByRole('button',{name:/pms.scan.captureBack/})).toBeNull();
  });
  it('uses the existing passport type when the re-scan is unreadable', async () => {
    render(<IdScanDialog open previousDocumentType="passport" onOpenChange={()=>undefined} onApply={()=> 'applied'}/>);
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docPassport/ }));
    await captureSyntheticDocument();
    expect(await screen.findByText('pms.scan.passportSelectedRetry')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'pms.scan.nextSide'})).toBeNull();
    expect(screen.queryByRole('button',{name:'pms.scan.confirmIdType'})).toBeNull();
  });
  it('uses the selected ID type when front classification is inconclusive', async () => {
    render(<IdScanDialog open onOpenChange={()=>undefined} onApply={()=> 'applied'}/>);
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docIdCard/ }));
    await captureSyntheticDocument();
    expect(await screen.findByText('pms.scan.idFrontReady')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'pms.scan.confirmIdType'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'pms.scan.nextSide'}));
    expect((await screen.findAllByText('pms.scan.flipCard')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: /pms.scan.captureBack/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pms.scan.captureFirst/ })).toBeNull();
  });
  it('continues to request both sides when an actual ID front is recognized', async () => {
    mocks.recognizeWithConfidence.mockResolvedValue({text:'NATIONAL IDENTITY CARD EXAMPLE NAME NUMBER',confidence:95});
    render(<IdScanDialog open onOpenChange={()=>undefined} onApply={()=> 'applied'}/>);
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.docIdCard/ }));
    await captureSyntheticDocument();
    expect((await screen.findAllByText('pms.scan.flipCard')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: /pms.scan.captureBack/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pms.scan.captureFirst/ })).toBeNull();
  });
});
