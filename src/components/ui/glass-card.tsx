import { cn } from '@/lib/utils';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
}

export const GlassCard = ({ children, className = '', hoverable = false }: GlassCardProps) => {
  return (
    <div
      className={cn(
        'backdrop-blur-2xl bg-white/70 dark:bg-gray-900/70',
        'border border-white/20 dark:border-gray-700/20',
        'rounded-2xl shadow-2xl',
        hoverable && 'transition-all duration-300 hover:shadow-3xl hover:scale-[1.02]',
        className
      )}
    >
      {children}
    </div>
  );
};
