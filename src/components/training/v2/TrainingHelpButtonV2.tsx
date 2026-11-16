import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTrainingV2Optional, txt } from './TrainingV2Provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { HelpCircle, Play, CheckCircle2, Sparkles, GraduationCap, MapPin, RotateCcw } from 'lucide-react';
import type { I18nText, TrainingCurriculum } from './types';
import type { ScreenMatch } from './screenContext';

const TXT: Record<string, I18nText> = {
  header: {
    en: 'Help & Training',
    hu: 'Súgó és képzés',
    es: 'Ayuda y entrenamiento',
    vi: 'Trợ giúp & Đào tạo',
    mn: 'Тусламж ба сургалт',
    uk: 'Довідка та навчання',
  },
  onThisScreen: {
    en: 'On this screen',
    hu: 'Ezen a képernyőn',
    es: 'En esta pantalla',
    vi: 'Trên màn hình này',
    mn: 'Энэ дэлгэц дээр',
    uk: 'На цьому екрані',
  },
  allGuides: {
    en: 'All guides',
    hu: 'Minden útmutató',
    es: 'Todas las guías',
    vi: 'Tất cả hướng dẫn',
    mn: 'Бүх заавар',
    uk: 'Усі посібники',
  },
  openCenter: {
    en: 'Open Training Center',
    hu: 'Képzési központ megnyitása',
    es: 'Abrir Centro de formación',
    vi: 'Mở Trung tâm đào tạo',
    mn: 'Сургалтын төв нээх',
    uk: 'Відкрити Центр навчання',
  },
  showMe: { en: 'Show me', hu: 'Mutasd', es: 'Muéstrame', vi: 'Hướng dẫn tôi', mn: 'Харуул', uk: 'Показати' },
  continue: { en: 'Continue', hu: 'Folytatás', es: 'Continuar', vi: 'Tiếp tục', mn: 'Үргэлжлүүлэх', uk: 'Продовжити' },
  review: { en: 'Review again', hu: 'Újranézés', es: 'Repasar', vi: 'Xem lại', mn: 'Дахин үзэх', uk: 'Переглянути ще раз' },
  start: { en: 'Start', hu: 'Indítás', es: 'Iniciar', vi: 'Bắt đầu', mn: 'Эхлэх', uk: 'Почати' },
  resume: { en: 'Resume', hu: 'Folytatás', es: 'Continuar', vi: 'Tiếp tục', mn: 'Үргэлжлүүлэх', uk: 'Продовжити' },
  completed: { en: 'Completed', hu: 'Befejezve', es: 'Completado', vi: 'Hoàn thành', mn: 'Дууссан', uk: 'Завершено' },
  steps: { en: 'steps', hu: 'lépés', es: 'pasos', vi: 'bước', mn: 'алхам', uk: 'кроків' },
  min: { en: 'min', hu: 'perc', es: 'min', vi: 'phút', mn: 'мин', uk: 'хв' },
  ariaLabel: {
    en: 'Help and training',
    hu: 'Súgó és képzés',
    es: 'Ayuda y formación',
    vi: 'Trợ giúp và đào tạo',
    mn: 'Тусламж ба сургалт',
    uk: 'Довідка та навчання',
  },
};

const EMPTY_CURRICULA: TrainingCurriculum[] = [];
const EMPTY_MATCHES: ScreenMatch[] = [];
const EMPTY_COMPLETION: Record<string, 'done' | 'in_progress' | 'available'> = {};

export function TrainingHelpButtonV2() {
  const ctx = useTrainingV2Optional();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const btnRef = useRef<HTMLButtonElement>(null);
  const registerLauncher = ctx?.registerLauncher;

  useEffect(() => {
    registerLauncher?.(btnRef.current);
  }, [registerLauncher]);

  const availableCurricula = ctx?.availableCurricula ?? EMPTY_CURRICULA;
  const onThisScreen = ctx?.onThisScreen ?? EMPTY_MATCHES;
  const completion = ctx?.completion ?? EMPTY_COMPLETION;

  const { contextual, others, unfinishedHere } = useMemo(() => {
    const contextualSlugs = new Set(onThisScreen.map((m) => m.curriculum.slug));
    return {
      contextual: onThisScreen,
      others: availableCurricula.filter((c) => !contextualSlugs.has(c.slug)),
      unfinishedHere: onThisScreen.some((m) => completion[m.curriculum.slug] !== 'done'),
    };
  }, [onThisScreen, availableCurricula, completion]);

  if (!ctx) return null;
  const { start, startForScreen, lang, nudge } = ctx;

  if (availableCurricula.length === 0) return null;

  const minutesFor = (steps: number, est?: number) => est ?? Math.max(1, Math.round(steps * 0.35));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={btnRef}
          variant="ghost"
          size="icon"
          className="relative min-h-11 min-w-11"
          aria-label={txt(TXT.ariaLabel, lang)}
          data-training="help-button"
          data-training-has-guide={unfinishedHere ? 'true' : undefined}
        >
          <HelpCircle className="h-5 w-5" />
          {unfinishedHere && (
            <span
              aria-hidden="true"
              className={`absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background ${nudge ? 'animate-pulse' : ''}`}
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-[min(80dvh,560px)] overflow-y-auto">
        <DropdownMenuLabel>{txt(TXT.header, lang)}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {contextual.length > 0 && (
          <>
            <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {txt(TXT.onThisScreen, lang)}
            </DropdownMenuLabel>
            {contextual.map(({ curriculum: c }) => {
              const status = completion[c.slug] || 'available';
              const action = status === 'done' ? TXT.review : status === 'in_progress' ? TXT.continue : TXT.showMe;
              return (
                <DropdownMenuItem
                  key={`ctx-${c.slug}`}
                  onClick={() => void startForScreen(c.slug)}
                  className="flex items-start gap-3 p-3 cursor-pointer bg-primary/5 focus:bg-primary/10"
                  data-training-guide={c.slug}
                >
                  <div className="mt-0.5">
                    {status === 'done' ? (
                      <RotateCcw className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Play className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{txt(c.name, lang)}</div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{txt(c.description, lang)}</p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <span>
                        {c.steps.length} {txt(TXT.steps, lang)} · ~{minutesFor(c.steps.length, c.estMinutes)} {txt(TXT.min, lang)}
                      </span>
                      <span className="font-semibold text-primary">{txt(action, lang)} →</span>
                    </div>
                  </div>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem
          onClick={() => navigate(organizationSlug ? `/${organizationSlug}/training` : '/training')}
          className="flex items-center gap-2 cursor-pointer"
        >
          <GraduationCap className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{txt(TXT.openCenter, lang)}</span>
        </DropdownMenuItem>

        {others.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {contextual.length > 0 && (
              <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {txt(TXT.allGuides, lang)}
              </DropdownMenuLabel>
            )}
            {others.map((c) => {
              const status = completion[c.slug] || 'available';
              return (
                <DropdownMenuItem
                  key={c.slug}
                  onClick={() => void start(c.slug, { manual: true })}
                  className="flex items-start gap-3 p-3 cursor-pointer"
                  data-training-guide={c.slug}
                >
                  <div className="mt-0.5">
                    {status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : c.category === 'feature_promo' ? (
                      <Sparkles className="h-4 w-4 text-primary" />
                    ) : (
                      <Play className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{txt(c.name, lang)}</div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {txt(c.description, lang)}
                    </p>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                      {c.steps.length} {txt(TXT.steps, lang)} ·{' '}
                      {status === 'done' ? txt(TXT.completed, lang) : status === 'in_progress' ? txt(TXT.resume, lang) : txt(TXT.start, lang)}
                    </div>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
