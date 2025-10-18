import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTenant } from './TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface BrandingConfig {
  logoUrl: string;
  faviconUrl: string;
  appName: string;
  primaryColor: string;
  secondaryColor: string;
  loginBackground?: string;
  welcomeMessage?: string;
  logoScale?: number;
  logoScaleAuth?: number;
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
  const { hotels, loading: orgLoading } = useTenant();
  const { profile } = useAuth();
  const [branding, setBranding] = useState<BrandingConfig>(defaultBranding);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orgLoading || !profile) {
      setLoading(true);
      return;
    }

    loadHotelBranding();
  }, [profile, hotels, orgLoading]);

  const loadHotelBranding = async () => {
    try {
      // Get user's assigned hotel
      const userHotel = profile?.assigned_hotel;
      
      if (!userHotel) {
        // No hotel assigned, use default branding
        setBranding(defaultBranding);
        applyBrandingToDOM(defaultBranding);
        setLoading(false);
        return;
      }

      // Try to find the hotel configuration by hotel_id or hotel_name
      const { data: hotelConfig, error } = await supabase
        .from('hotel_configurations')
        .select('*')
        .or(`hotel_id.eq.${userHotel},hotel_name.eq.${userHotel}`)
        .maybeSingle();

      if (error) {
        console.error('Error loading hotel branding:', error);
        setBranding(defaultBranding);
        applyBrandingToDOM(defaultBranding);
        setLoading(false);
        return;
      }

      // Check if hotel has custom branding enabled
      if (hotelConfig?.custom_branding_enabled) {
        const customBranding: BrandingConfig = {
          logoUrl: hotelConfig.custom_logo_url || defaultBranding.logoUrl,
          faviconUrl: hotelConfig.custom_favicon_url || defaultBranding.faviconUrl,
          appName: hotelConfig.custom_app_name || hotelConfig.hotel_name || defaultBranding.appName,
          primaryColor: hotelConfig.custom_primary_color || defaultBranding.primaryColor,
          secondaryColor: hotelConfig.custom_secondary_color || defaultBranding.secondaryColor,
          loginBackground: hotelConfig.custom_login_background,
          welcomeMessage: hotelConfig.custom_welcome_message,
          logoScale: hotelConfig.logo_scale ? Number(hotelConfig.logo_scale) : undefined,
          logoScaleAuth: hotelConfig.logo_scale_auth ? Number(hotelConfig.logo_scale_auth) : undefined,
          isCustomBranded: true,
        };
        setBranding(customBranding);
        applyBrandingToDOM(customBranding);
      } else {
        // Hotel exists but custom branding is not enabled
        setBranding(defaultBranding);
        applyBrandingToDOM(defaultBranding);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error in loadHotelBranding:', error);
      setBranding(defaultBranding);
      applyBrandingToDOM(defaultBranding);
      setLoading(false);
    }
  };

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
