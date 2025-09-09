import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useLanguagePreference } from '@/hooks/useLanguagePreference';
import { useTranslation } from '@/hooks/useTranslation';

const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'mn', name: 'Монгол', flag: '🇲🇳' },
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
    <div className="flex items-center gap-2">
      <Select value={language} onValueChange={handleLanguageChange}>
        <SelectTrigger aria-label="Language" className="w-12 sm:w-[200px] h-10">
          <div className="flex items-center gap-2 truncate">
            <span className="text-lg">{current.flag}</span>
            <span className="truncate hidden sm:inline">{current.name}</span>
          </div>
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