// Small building blocks for the guest-facing booking engine. Styled with the
// hotel's brand colour through CSS variables set on the page root:
// --be-primary, --be-on-primary, --be-soft.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BrandButton({ className, children, variant = 'solid', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'outline' | 'ghost' }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--be-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'solid' && 'bg-[var(--be-primary)] text-[var(--be-on-primary)] shadow-sm hover:brightness-110 active:brightness-95',
        variant === 'outline' && 'border border-[var(--be-primary)] text-[var(--be-primary)] bg-white hover:bg-[var(--be-soft)]',
        variant === 'ghost' && 'text-[var(--be-primary)] hover:bg-[var(--be-soft)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Counter({ label, hint, value, min, max, onChange, id }: {
  label: string; hint?: string; value: number; min: number; max: number; onChange: (value: number) => void; id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div>
        <div id={`${id}-label`} className="text-sm font-medium text-stone-900">{label}</div>
        {hint && <div className="text-xs text-stone-500">{hint}</div>}
      </div>
      <div className="flex items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
        <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}
          className="grid h-9 w-9 place-items-center rounded-full border border-stone-300 text-stone-700 transition hover:border-[var(--be-primary)] hover:text-[var(--be-primary)] disabled:opacity-35 disabled:hover:border-stone-300 disabled:hover:text-stone-700">
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-base font-semibold tabular-nums" aria-live="polite">{value}</span>
        <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}
          className="grid h-9 w-9 place-items-center rounded-full border border-stone-300 text-stone-700 transition hover:border-[var(--be-primary)] hover:text-[var(--be-primary)] disabled:opacity-35 disabled:hover:border-stone-300 disabled:hover:text-stone-700">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1.5 sm:gap-3 text-xs sm:text-sm" aria-label="Booking steps">
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={label} className="flex items-center gap-1.5 sm:gap-3 min-w-0" aria-current={active ? 'step' : undefined}>
            <span className={cn(
              'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition',
              done && 'bg-[var(--be-primary)] text-[var(--be-on-primary)]',
              active && 'border-2 border-[var(--be-primary)] text-[var(--be-primary)]',
              !done && !active && 'border border-stone-300 text-stone-400',
            )}>{done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
            <span className={cn('truncate', active ? 'font-semibold text-stone-900' : 'text-stone-500', !active && 'hidden sm:inline')}>{label}</span>
            {index < steps.length - 1 && <span className="h-px w-4 sm:w-8 bg-stone-300" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn(
      'rounded-lg border px-4 py-3 text-sm',
      tone === 'info' && 'border-stone-200 bg-stone-50 text-stone-700',
      tone === 'error' && 'border-red-200 bg-red-50 text-red-800',
      tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
    )}>{children}</div>
  );
}
