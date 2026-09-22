import { useEffect, useRef, useState } from 'react';
import { Languages, Loader2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';

type Fields = { title: string; description: string; resolution?: string | null; hold?: string | null };
type Props = { ticketId: string; revision: string; fields: Fields };
const supported = new Set(['en', 'hu', 'es', 'mn', 'vi', 'uk', 'az', 'tl', 'ru', 'si']);
const cache = new Map<string, { fields: Fields; expires: number }>();
let cacheIdentity = '';

/** Translates only tickets already visible through the caller's scoped tickets query.
 * This is display-only: never writes translated text over the original issue.
 * OPENAI_API_KEY is read by the existing JWT-protected translate-note Edge Function.
 */
export function MaintenanceAutoTranslation({ ticketId, revision, fields }: Props) {
  const { user } = useAuth();
  const { language } = useTranslation();
  const target = supported.has(language) ? language : 'en';
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [original, setOriginal] = useState(false);
  const [translated, setTranslated] = useState<Fields | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = `${user?.id || ''}:${ticketId}:${revision}:${target}:${fields.title}:${fields.description}:${fields.hold || ''}:${fields.resolution || ''}`;

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: '250px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTranslated(null);
    setOriginal(false);
    setError(false);
    setLoading(false);
    if (cacheIdentity !== (user?.id || '')) { cache.clear(); cacheIdentity = user?.id || ''; }
    if (!visible || !user?.id) return;
    if (retry) cache.delete(key);
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) { setTranslated(saved.fields); return; }
    cache.delete(key);
    setLoading(true);
    void (async () => {
      try {
        const entries = Object.entries(fields).filter(([, text]) => typeof text === 'string' && text.trim()) as [keyof Fields, string][];
        const result = await Promise.all(entries.map(async ([field, text]) => {
          const { data, error: translationError } = await supabase.functions.invoke('translate-note', {
            body: { text: text.slice(0, 6000), targetLanguage: target },
          });
          if (translationError || typeof data?.translatedText !== 'string' || !data.translatedText.trim()) {
            throw translationError || new Error('Translation unavailable');
          }
          return [field, data.translatedText] as const;
        }));
        if (cancelled) return;
        const values = { ...fields, ...Object.fromEntries(result) };
        setTranslated(values);
        cache.set(key, { fields: values, expires: Date.now() + 5 * 60_000 });
        if (cache.size > 80) cache.delete(cache.keys().next().value!);
      } catch (err) {
        if (!cancelled) { console.error('Maintenance translation failed', err); setError(true); }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [key, visible, retry, user?.id, target, fields.title, fields.description, fields.hold, fields.resolution]);

  const value = translated && !original ? translated : fields;
  const hu = language === 'hu';
  return <div ref={host} className="space-y-2 rounded-lg bg-muted/50 p-3" aria-live="polite">
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-muted-foreground"><Languages className="h-3.5 w-3.5 shrink-0" />{hu ? 'Hiba leírása' : 'Issue report'}</span>
      <div className="flex shrink-0 gap-1">
        {translated && <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setOriginal(v => !v)}>
          {original ? (hu ? 'Fordítás' : 'Translation') : (hu ? 'Eredeti' : 'Original')}
        </Button>}
        {error && <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setRetry(n => n + 1)}><RotateCw className="mr-1 h-3 w-3" />{hu ? 'Újra' : 'Retry'}</Button>}
      </div>
    </div>
    <p className="text-sm font-semibold whitespace-pre-wrap break-words">{value.title}</p>
    <p className="text-sm whitespace-pre-wrap break-words">{value.description}</p>
    {value.hold && <p className="text-xs whitespace-pre-wrap break-words">{hu ? 'Várakozás oka' : 'On-hold reason'}: {value.hold}</p>}
    {value.resolution && <p className="text-xs whitespace-pre-wrap break-words">{hu ? 'Javítás' : 'Repair'}: {value.resolution}</p>}
    {loading && <p role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{hu ? 'Fordítás…' : 'Translating…'}</p>}
    {error && <p role="status" className="text-xs text-amber-700">{hu ? 'Fordítás nem érhető el; az eredeti szöveg látható.' : 'Translation unavailable; original text shown.'}</p>}
    {translated && !original && <p className="text-[11px] text-muted-foreground">{hu ? 'Automatikus fordítás · az eredeti jelentés változatlan' : 'Automatic translation · original report unchanged'}</p>}
  </div>;
}
