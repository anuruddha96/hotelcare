import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
];

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();
  const current = languages.find(l => l.code === language) || languages[0];

  const handleLanguageChange = (langCode: string) => {
    setLanguage(langCode as any);
    
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
        <SelectTrigger aria-label="Language" className="w-[160px] sm:w-[200px]">
          <div className="flex items-center gap-2 truncate">
            <span>{current.flag}</span>
            <span className="truncate">{current.name}</span>
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