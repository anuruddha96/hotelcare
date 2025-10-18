import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTenant } from './TenantContext';

interface BrandingConfig {
  logoUrl: string;
  faviconUrl: string;
  appName: string;
  primaryColor: string;
  secondaryColor: string;
  loginBackground?: string;
  welcomeMessage?: string;
  logoScale?: number;
  isCustomBranded: boolean;
}

interface BrandingContextType {
  branding: BrandingConfig;
  loading: boolean;
}

const defaultBranding: BrandingConfig = {
  logoUrl: '/logo.png',
  faviconUrl: '/favicon.png',
  appName: 'HotelCare.app',
  primaryColor: 'hsl(200, 76%, 58%)',
  secondaryColor: 'hsl(0, 0%, 42%)',
  isCustomBranded: false,
};

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { organization, loading: orgLoading } = useTenant();
  const [branding, setBranding] = useState<BrandingConfig>(defaultBranding);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orgLoading) {
      setLoading(true);
      return;
    }

    if (!organization) {
      setBranding(defaultBranding);
      setLoading(false);
      return;
    }

    // Check if organization has custom branding enabled (Enterprise tier)
    const hasCustomBranding = organization.settings?.subscription_tier === 'enterprise' || 
                             (organization as any).allow_custom_branding === true;

    if (hasCustomBranding) {
      const customBranding: BrandingConfig = {
        logoUrl: (organization as any).custom_logo_url || defaultBranding.logoUrl,
        faviconUrl: (organization as any).custom_favicon_url || defaultBranding.faviconUrl,
        appName: (organization as any).custom_app_name || organization.name || defaultBranding.appName,
        primaryColor: (organization as any).custom_primary_color || defaultBranding.primaryColor,
        secondaryColor: (organization as any).custom_secondary_color || defaultBranding.secondaryColor,
        loginBackground: (organization as any).custom_login_background,
        welcomeMessage: (organization as any).custom_welcome_message,
        logoScale: (organization as any).logo_scale || undefined,
        isCustomBranded: true,
      };
      setBranding(customBranding);
      
      // Apply branding to DOM
      applyBrandingToDOM(customBranding);
    } else {
      setBranding(defaultBranding);
      applyBrandingToDOM(defaultBranding);
    }

    setLoading(false);
  }, [organization, orgLoading]);

  return (
    <BrandingContext.Provider value={{ branding, loading }}>
      {children}
    </BrandingContext.Provider>
  );
};

export const useBranding = () => {
  const context = useContext(BrandingContext);
  if (context === undefined) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return context;
};

// Apply branding dynamically to the DOM
const applyBrandingToDOM = (branding: BrandingConfig) => {
  const root = document.documentElement;
  
  // Apply CSS custom properties for colors
  root.style.setProperty('--brand-primary', branding.primaryColor);
  root.style.setProperty('--brand-secondary', branding.secondaryColor);
  
  // Update page title
  document.title = branding.appName;
  
  // Update favicon
  const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
  if (favicon && branding.faviconUrl) {
    favicon.href = branding.faviconUrl;
  }
  
  // Update apple touch icon
  const appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement;
  if (appleTouchIcon && branding.faviconUrl) {
    appleTouchIcon.href = branding.faviconUrl;
  }
};
