import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';

interface MobileOptimizedCardProps {
  children: React.ReactNode;
  className?: string;
}

export function MobileOptimizedCard({ children, className = "", onClick }: MobileOptimizedCardProps & { onClick?: () => void }) {
  const isMobile = useIsMobile();

  return (
    <Card 
      className={`
        ${className} 
        ${isMobile ? 'touch-target mobile-padding animate-fade-in' : ''} 
        hover:shadow-lg transition-all duration-200 
        ${isMobile ? 'active:scale-95' : 'hover:scale-[1.02]'}
        ${onClick ? 'cursor-pointer' : ''}
      `}
      onClick={onClick}
    >
      {children}
    </Card>
  );
}

interface MobileButtonProps {
  children: React.ReactNode;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export function MobileOptimizedButton({ 
  children, 
  variant = 'default',
  size = 'default',
  className = "",
  onClick,
  disabled
}: MobileButtonProps) {
  const isMobile = useIsMobile();

  return (
    <Button
      variant={variant}
      size={size}
      className={`
        ${className}
        ${isMobile ? 'mobile-button touch-target' : ''}
        ${isMobile ? 'active:scale-95' : 'hover:scale-105'}
        transition-transform duration-150
      `}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}