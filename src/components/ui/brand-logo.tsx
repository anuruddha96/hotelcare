import { useBranding } from '@/contexts/BrandingContext';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  animated?: boolean;
}

const sizeClasses = {
  sm: 'h-8 w-auto',
  md: 'h-12 w-auto',
  lg: 'h-16 w-auto',
  xl: 'h-24 w-auto',
  '2xl': 'h-32 w-auto',
};

export const BrandLogo = ({ size = 'md', className = '', animated = false }: BrandLogoProps) => {
  const { branding, loading } = useBranding();

  if (loading) {
    return <div className={`${sizeClasses[size]} bg-muted animate-pulse rounded ${className}`} />;
  }

  return (
    <img
      src={branding.logoUrl}
      alt={branding.appName}
      className={`${sizeClasses[size]} ${animated ? 'animate-logo-entrance' : ''} ${className}`}
    />
  );
};
