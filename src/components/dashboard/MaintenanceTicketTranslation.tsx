import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Languages, Loader2 } from 'lucide-react';

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
  const [targetLanguage, setTargetLanguage] = useState(language || 'en');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ title: string; description: string } | null>(null);
  const [error, setError] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    // Invalidate an in-flight translation when the technician opens another
    // ticket or the source text/language changes. A slower old request must
    // never paint its result onto the new ticket.
    requestSequence.current += 1;
    setResult(null);
    setError(false);
    setBusy(false);
    setTargetLanguage(LANGUAGES.some(([code]) => code === language) ? language : 'en');
  }, [ticketId, title, description, language]);

  const changeTargetLanguage = (value: string) => {
    // Selecting a different language also invalidates any request already in
    // flight, so Hungarian/English technicians cannot see a stale translation
    // labelled as the newly selected language.
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
      // translate-note is a JWT-protected Supabase Edge Function. It reads the
      // existing OPENAI_API_KEY server-side; no API key is sent to the browser.
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
