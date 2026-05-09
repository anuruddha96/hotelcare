import React, { createContext, useContext, useState, useEffect } from 'react';
import { Language, Translation, translations, LANGUAGES } from '@/data/websiteTranslations';

interface WebsiteLanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translation;
  languages: typeof LANGUAGES;
}

const WebsiteLanguageContext = createContext<WebsiteLanguageContextType | null>(null);

export const WebsiteLanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem('rd-website-lang');
    if (stored && stored in translations) return stored as Language;
    const browser = navigator.language.slice(0, 2).toLowerCase();
    if (browser in translations) return browser as Language;
    return 'en';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('rd-website-lang', lang);
    document.documentElement.lang = lang;
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <WebsiteLanguageContext.Provider value={{ language, setLanguage, t: translations[language], languages: LANGUAGES }}>
      {children}
    </WebsiteLanguageContext.Provider>
  );
};

export const useWebsiteLang = () => {
  const ctx = useContext(WebsiteLanguageContext);
  if (!ctx) throw new Error('useWebsiteLang must be used within WebsiteLanguageProvider');
  return ctx;
};
