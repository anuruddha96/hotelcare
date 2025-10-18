import { useBranding } from '@/contexts/BrandingContext';

interface LogoSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
}

export const LogoSpinner = ({ size = 'md', message }: LogoSpinnerProps) => {
  const { branding } = useBranding();
  const sizeClasses = {
    sm: 'h-16 w-auto',
    md: 'h-24 w-auto',
    lg: 'h-32 w-auto',
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-3">
      <img
        src={branding.logoUrl}
        alt={branding.appName}
        className={`${sizeClasses[size]} animate-logo-pulse`}
      />
      {message && (
        <p className="text-sm text-muted-foreground animate-fade-in">
          {message}
        </p>
      )}
    </div>
  );
};
