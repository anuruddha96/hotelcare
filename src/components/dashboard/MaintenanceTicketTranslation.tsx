import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Languages, Loader2, X } from 'lucide-react';

type Props = {
  ticketId: string;
  title: string;
  description: string;
};

const LANGUAGES = [
  ['en', 'English'], ['hu', 'Magyar'], ['es', 'Español'], ['vi', 'Tiếng Việt'],
  ['mn', 'Монгол'], ['az', 'Azərbaycanca'], ['tl', 'Filipino'],
  ['uk', 'Українська'], ['ru', 'Русский'],
] as const;

/** Read-only translation: the original reported fault is never overwritten. */
export function MaintenanceTicketTranslation({ ticketId, title, description }: Props) {
  const { language } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState(language || 'en');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ title: string; description: string } | null>(null);
  const [error, setError] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    requestSequence.current += 1;
    setResult(null);
    setError(false);
    setBusy(false);
    setExpanded(false);
    setTargetLanguage(LANGUAGES.some(([code]) => code === language) ? language : 'en');
  }, [ticketId, title, description, language]);

  const changeTargetLanguage = (value: string) => {
    requestSequence.current += 1;
    setTargetLanguage(value as typeof targetLanguage);
    setResult(null);
    setError(false);
    setBusy(false);
  };

  const translate = async () => {
    if (!title.trim() && !description.trim()) return;
    const requestId = ++requestSequence.current;
    const requestedLanguage = targetLanguage;
    setBusy(true);
    setError(false);
    setResult(null);
    try {
      const [translatedTitle, translatedDescription] = await Promise.all(
        [title, description].map(async text => {
          if (!text.trim()) return '';
          const { data, error: invokeError } = await supabase.functions.invoke('translate-note', {
            body: { text: text.slice(0, 4000), targetLanguage: requestedLanguage },
          });
          if (invokeError || !data?.translatedText) throw invokeError || new Error('Translation unavailable');
          return String(data.translatedText);
        }),
      );
      if (requestId !== requestSequence.current) return;
      setResult({ title: translatedTitle, description: translatedDescription });
    } catch (translationError) {
      if (requestId !== requestSequence.current) return;
      console.error('Maintenance ticket translation unavailable:', translationError);
      setError(true);
    } finally {
      if (requestId === requestSequence.current) setBusy(false);
    }
  };

  if (!expanded) {
    return <div onClick={event => event.stopPropagation()}>
      <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground"
        onClick={() => setExpanded(true)}>
        <Languages className="mr-1 h-3.5 w-3.5" />{language === 'hu' ? 'Fordítás' : 'Translate'}
      </Button>
    </div>;
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5" onClick={event => event.stopPropagation()}>
      <div className="flex items-center gap-2">
        <Languages className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Select value={targetLanguage} onValueChange={changeTargetLanguage}>
          <SelectTrigger className="h-9 min-w-0 flex-1" aria-label="Translation language"><SelectValue /></SelectTrigger>
          <SelectContent>{LANGUAGES.map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" size="sm" variant="outline" onClick={() => void translate()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
          <span className="ml-1">{language === 'hu' ? 'Fordítás' : 'Translate'}</span>
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0"
          aria-label={language === 'hu' ? 'Fordítás bezárása' : 'Close translation'}
          onClick={() => { requestSequence.current += 1; setBusy(false); setExpanded(false); }}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{language === 'hu' ? 'A fordítás nem sikerült. Az eredeti szöveg továbbra is látható.' : 'Translation failed. The original text is still available.'}</p>}
      {result && <div aria-live="polite" className="space-y-1 text-sm">
        <p className="font-semibold whitespace-pre-wrap">{result.title}</p>
        <p className="whitespace-pre-wrap text-muted-foreground">{result.description}</p>
        <p className="text-[11px] text-muted-foreground">{language === 'hu' ? 'Automatikus fordítás · az eredeti jegy változatlan' : 'Automatic translation · original ticket unchanged'}</p>
      </div>}
    </div>
  );
}
