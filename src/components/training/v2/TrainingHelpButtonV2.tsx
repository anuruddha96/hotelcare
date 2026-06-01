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
import { HelpCircle, Play, CheckCircle2, Sparkles } from 'lucide-react';

const HEADER = {
  en: 'Help & Training',
  hu: 'Súgó és képzés',
  es: 'Ayuda y entrenamiento',
  vi: 'Trợ giúp & Đào tạo',
  mn: 'Тусламж ба сургалт',
};

export function TrainingHelpButtonV2() {
  const { availableCurricula, completion, start, lang } = useTrainingV2();

  if (availableCurricula.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-training="help-button">
          <HelpCircle className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{txt(HEADER, lang)}</DropdownMenuLabel>
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
