import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useTranslation } from './useTranslation';

export function useLanguagePreference() {
  const { user } = useAuth();
  const { language, setLanguage } = useTranslation();

  // Load user's preferred language on login
  useEffect(() => {
    const loadUserLanguagePreference = async () => {
      if (user?.id) {
        const { data } = await supabase
          .from('profiles')
          .select('preferred_language')
          .eq('id', user.id)
          .single();

        if (data?.preferred_language && data.preferred_language !== language) {
          setLanguage(data.preferred_language as any);
        }
      }
    };

    loadUserLanguagePreference();
  }, [user?.id]);

  // Save language preference when changed
  const saveLanguagePreference = async (newLanguage: string) => {
    if (user?.id) {
      await supabase
        .from('profiles')
        .update({ preferred_language: newLanguage })
        .eq('id', user.id);
    }
    
    // Also save to localStorage for non-authenticated users
    localStorage.setItem('preferred_language', newLanguage);
  };

  return {
    saveLanguagePreference
  };
}