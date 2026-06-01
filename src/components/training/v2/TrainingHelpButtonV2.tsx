import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTrainingV2, txt } from './TrainingV2Provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { HelpCircle, Play, CheckCircle2, Sparkles, GraduationCap } from 'lucide-react';

const HEADER = {
  en: 'Help & Training',
  hu: 'Súgó és képzés',
  es: 'Ayuda y entrenamiento',
  vi: 'Trợ giúp & Đào tạo',
  mn: 'Тусламж ба сургалт',
};

export function TrainingHelpButtonV2() {
  const { availableCurricula, completion, start, lang, registerLauncher } = useTrainingV2();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    registerLauncher(btnRef.current);
  }, [registerLauncher]);

  if (availableCurricula.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={btnRef}
          variant="ghost"
          size="icon"
          className="relative min-h-11 min-w-11"
          aria-label="Help and training"
          data-training="help-button"
        >
          <HelpCircle className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{txt(HEADER, lang)}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigate(organizationSlug ? `/${organizationSlug}/training` : '/training')}
          className="flex items-center gap-2 cursor-pointer"
        >
          <GraduationCap className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Open Training Center</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {availableCurricula.map((c) => {
          const status = completion[c.slug] || 'available';
          return (
            <DropdownMenuItem
              key={c.slug}
              onClick={() => start(c.slug)}
              className="flex items-start gap-3 p-3 cursor-pointer"
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
                  {c.steps.length} steps · {status === 'done' ? 'Completed' : status === 'in_progress' ? 'Resume' : 'Start'}
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
