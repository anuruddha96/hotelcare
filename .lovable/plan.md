

## Plan: Auto-detect Browser Language on First Visit

### Problem
Currently the app defaults to English (`'en'`) when no `preferred-language` is stored in localStorage. Users with Hungarian (or other supported) browsers must manually switch.

### Solution
In the `TranslationProvider` initializer, detect the browser language via `navigator.language` and match it against supported languages (`en`, `hu`, `es`, `vi`, `mn`) before falling back to English. Only apply this when no `preferred-language` exists in localStorage (i.e., first visit or cleared storage).

### File to Edit

**`src/hooks/useTranslation.tsx`** — Update the `useState` initializer (~line 2085-2086):

```typescript
// Before
const [language, setLanguage] = useState<Language>(() => {
  return (localStorage.getItem('preferred-language') as Language) || 'en';
});

// After
const [language, setLanguage] = useState<Language>(() => {
  const stored = localStorage.getItem('preferred-language') as Language;
  if (stored) return stored;
  
  const supportedLanguages: Language[] = ['en', 'hu', 'es', 'vi', 'mn'];
  const browserLang = navigator.language?.split('-')[0]?.toLowerCase();
  const detected = supportedLanguages.find(l => l === browserLang);
  return detected || 'en';
});
```

One file, ~5 lines changed. No other files affected — the `useLanguagePreference` hook will still override with the user's saved DB preference after login.

