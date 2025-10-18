interface LogoSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
}

export const LogoSpinner = ({ size = 'md', message }: LogoSpinnerProps) => {
  const sizeClasses = {
    sm: 'h-12 w-auto',
    md: 'h-16 w-auto',
    lg: 'h-24 w-auto',
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-3">
      <img
        src="/logo.png"
        alt="HotelCare.app"
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
