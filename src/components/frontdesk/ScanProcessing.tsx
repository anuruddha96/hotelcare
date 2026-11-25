import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export type ScanStep = 'reading' | 'checking' | 'details';

const STEP_LABEL: Record<ScanStep, string> = {
  reading: 'pms.scan.reading',
  checking: 'pms.scan.checking',
  details: 'pms.scan.readingPrintedFields',
};

const STEP_PROGRESS: Record<ScanStep, number> = { reading: 34, checking: 67, details: 90 };

/** How far each placeholder row of the card outline has filled at each step. */
const ROW_FILL: Record<ScanStep, readonly number[]> = {
  reading: [46, 22, 0, 0],
  checking: [100, 100, 62, 30],
  details: [100, 100, 100, 100],
};

const ROW_WIDTH = [86, 64, 76, 52] as const;

/** The ≤40 px capture copy, scaled up and blurred: colour only, nothing readable. */
function BlurredBackdrop({ image }: { image: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    target.width = image.width;
    target.height = image.height;
    target.getContext('2d')?.drawImage(image, 0, 0);
    return () => {
      target.getContext('2d')?.clearRect(0, 0, target.width, target.height);
      target.width = 0;
      target.height = 0;
    };
  }, [image]);
  return <canvas ref={ref} data-scan-backdrop="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-xl" />;
}

/**
 * Shown from the moment a capture starts until the details are ready: the
 * camera picture is replaced by a blurred colour field and an animated card
 * outline that fills in as the reading progresses.
 */
export function ScanProcessing({ backdrop, step }: { backdrop: HTMLCanvasElement | null; step: ScanStep }) {
  const { t } = useTranslation();
  const fills = ROW_FILL[step];
  const codeLinesDone = step !== 'reading';
  return (
    <div className="space-y-3" data-scan-processing={step}>
      <div className="relative mx-auto w-full max-h-[34dvh] overflow-hidden rounded-lg bg-slate-950 aspect-[1.58/1]" aria-hidden="true">
        {backdrop && <BlurredBackdrop image={backdrop} />}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-slate-950/55 to-slate-950/75" />
        <div className="absolute inset-[9%] flex flex-col rounded-xl border border-white/30 bg-white/[0.06] p-[4%] shadow-[0_0_40px_rgba(16,185,129,0.15)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300">
          <div className="flex min-h-0 flex-1 gap-[5%]">
            <div className="relative w-[24%] overflow-hidden rounded-md bg-white/10">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent motion-safe:animate-scan-shimmer" />
            </div>
            <div className="flex flex-1 flex-col justify-center gap-[10%]">
              {ROW_WIDTH.map((width, index) => (
                <div key={width} className="relative h-2 overflow-hidden rounded-full bg-white/15 sm:h-2.5" style={{ width: `${width}%` }}>
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-sky-300 transition-[width] duration-700 ease-out" style={{ width: `${fills[index]}%` }} />
                  {fills[index] < 100 && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent motion-safe:animate-scan-shimmer" />}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-[5%] space-y-1.5">
            {[0, 1].map((line) => (
              <div key={line} className="relative h-1.5 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-emerald-300/90 transition-[width] duration-700 ease-out" style={{ width: codeLinesDone ? '100%' : `${line === 0 ? 38 : 12}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-transparent via-emerald-300/30 to-transparent motion-safe:animate-scan-sweep" />
      </div>
      <div role="status" aria-live="polite" className="space-y-2">
        <div className="flex items-center justify-center gap-2 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" /> {t(STEP_LABEL[step])}
        </div>
        <div className="mx-auto h-1.5 w-2/3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${STEP_PROGRESS[step]}%` }} />
        </div>
      </div>
    </div>
  );
}
