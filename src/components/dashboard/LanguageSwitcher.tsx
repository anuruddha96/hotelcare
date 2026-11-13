import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useLanguagePreference } from '@/hooks/useLanguagePreference';
import { useTranslation } from '@/hooks/useTranslation';

const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'mn', name: 'Монгол', flag: '🇲🇳' },
  { code: 'az', name: 'Azərbaycanca', flag: '🇦🇿' },
  { code: 'tl', name: 'Filipino', flag: '🇵🇭' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
];

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();
  const { saveLanguagePreference } = useLanguagePreference();
  const current = languages.find(l => l.code === language) || languages[0];

  const handleLanguageChange = async (langCode: string) => {
    setLanguage(langCode as any);
    await saveLanguagePreference(langCode);
    
    // Show confirmation toast
    const selectedLang = languages.find(lang => lang.code === langCode);
    toast({
      title: t('language.changed'),
      description: `${t('language.switchedTo')} ${selectedLang?.name}`,
    });
  };

  return (
    <div className="flex shrink-0 items-center" data-training="language-switch">
    <Select value={language} onValueChange={handleLanguageChange}>
      <SelectTrigger aria-label={`Language: ${current.name}`} className="h-9 w-[68px] shrink-0 gap-1.5 rounded-lg border-border/60 bg-background px-2.5 transition-colors hover:bg-secondary/60 sm:w-auto sm:gap-2 sm:px-3 [&>span]:flex [&>span]:items-center [&>span]:gap-2 [&>span]:whitespace-nowrap">
        <SelectValue>
          <span className="text-base leading-none">{current.flag}</span>
          <span className="font-medium hidden sm:inline whitespace-nowrap">{current.name}</span>
        </SelectValue>
      </SelectTrigger>
        <SelectContent>
          {languages.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              <span className="flex items-center gap-2">
                <span>{lang.flag}</span>
                <span>{lang.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}