import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Clock3, Languages, MessageSquare, RotateCw, User } from 'lucide-react';
import { isSupportedMaintenanceLanguage, localizedMaintenanceText, maintenanceTranslationCacheKey, type MaintenanceTranslationResponse } from '@/lib/maintenanceTicketLocalization';

interface TicketContent {
  id: string;
  title: string;
  description: string;
  resolution_text?: string | null;
  hold_reason?: string | null;
  updated_at: string;
}
interface Props { ticket: TicketContent; language: string; reporterFallback?: string | null; revision?: number }

// Session-memory only. Never persist confidential maintenance notes to localStorage.
// Every key includes an authenticated identity and ticket revision; clear on account switch.
const cache = new Map<string, { response: MaintenanceTranslationResponse; expires: number }>();
let cacheUser: string | null = null;
const CACHE_LIMIT = 80;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Only mounted for a worker's assigned tickets. The endpoint independently
 * authorizes ticket access with the worker's own JWT and database RLS. */
export function MaintenanceTicketLanguagePanel({ ticket, language, reporterFallback, revision = 0 }: Props) {
  const { user } = useAuth();
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [response, setResponse] = useState<MaintenanceTranslationResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const key = `${user?.id || 'signed-out'}:${maintenanceTranslationCacheKey(ticket.id, `${ticket.updated_at}:${revision}`, language)}`;

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: '350px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResponse(null);
    setLoadedKey('');
    setShowOriginal(false);
    if (cacheUser !== (user?.id || null)) { cache.clear(); cacheUser = user?.id || null; }
    if (!visible || !user?.id || !isSupportedMaintenanceLanguage(language)) return;
    if (reload > 0) cache.delete(key);
    const entry = cache.get(key);
    if (entry && entry.expires > Date.now() && !entry.response.translationUnavailable) {
      setResponse(entry.response);
      setLoadedKey(key);
      setLoading(false);
      return;
    }
    cache.delete(key);
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('maintenance-ticket-context', {
          body: { ticketId: ticket.id, action: 'translate', language },
        });
        if (error || !data || data.ticketId !== ticket.id || !Array.isArray(data.history)) throw error || new Error('Invalid response');
        if (!cancelled) {
          const result = data as MaintenanceTranslationResponse;
          setResponse(result);
          setLoadedKey(key);
          if (!result.translationUnavailable) {
            cache.set(key, { response: result, expires: Date.now() + CACHE_TTL_MS });
            if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
          }
        }
      } catch (error) {
        // Keep original issue text readable during outages or missing credentials.
        console.error('Maintenance context unavailable:', error);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [visible, user?.id, ticket.id, language, key, reload]);

  const context = loadedKey === key ? response : null;
  const translated = (original: string | null | undefined, field: string) =>
    localizedMaintenanceText(original, field, context, showOriginal);
  const label = language === 'hu' ? {
    reporter: 'Jelentette', issue: 'Hiba', resolution: 'Elvégzett javítás', history: 'Jegy előzményei',
    original: 'Eredeti szöveg', translated: 'Fordítás', unavailable: 'A fordítás jelenleg nem érhető el; az eredeti szöveg látható.',
    retry: 'Újrapróbálás', loading: 'Fordítás…',
  } : {
    reporter: 'Reported by', issue: 'Issue', resolution: 'Repair details', history: 'Ticket history',
    original: 'Show original', translated: 'Show translation', unavailable: 'Translation unavailable; original text shown.',
    retry: 'Retry', loading: 'Translating…',
  };

  return (
    <div ref={host} className="space-y-2">
      <div className="rounded-lg bg-muted/50 p-2 text-xs">
        <div className="text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" />{label.reporter}</div>
        <div className="font-semibold break-words">{context?.reporter || reporterFallback || '—'}</div>
      </div>
      <div className="rounded-lg border p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground font-semibold flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{label.issue}</span>
          <div className="flex gap-1">
            {context && Object.keys(context.translations || {}).length > 0 &&
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowOriginal(!showOriginal)}>
                <Languages className="mr-1 h-3.5 w-3.5" />{showOriginal ? label.translated : label.original}
              </Button>}
            {(!context || context.translationUnavailable) && !loading &&
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setReload(n => n + 1)}>
                <RotateCw className="mr-1 h-3.5 w-3.5" />{label.retry}
              </Button>}
          </div>
        </div>
        <p className="text-sm whitespace-pre-wrap break-words font-medium">{translated(ticket.title, 'title')}</p>
        <p className="text-sm whitespace-pre-wrap break-words">{translated(ticket.description, 'description')}</p>
        {loading && <p className="text-xs text-muted-foreground" role="status">{label.loading}</p>}
        {context?.translationUnavailable && <p className="text-xs text-amber-700" role="status">{label.unavailable}</p>}
      </div>
      {ticket.resolution_text && <div className="rounded-lg bg-green-50 border border-green-200 p-2.5 text-xs text-green-800">
        <strong>{label.resolution}:</strong> <span className="whitespace-pre-wrap">{translated(ticket.resolution_text, 'resolution')}</span>
      </div>}
      {context && context.history.length > 0 && <details className="rounded-lg border p-2.5">
        <summary className="cursor-pointer text-xs font-semibold flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{label.history} ({context.history.length})</summary>
        <div className="mt-2 space-y-2">
          {context.history.map(entry => <div key={entry.id} className="rounded-md bg-muted/50 p-2 text-xs">
            <div className="flex flex-wrap justify-between gap-1 text-muted-foreground mb-1"><strong>{entry.sender}</strong><span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{new Date(entry.created_at).toLocaleString()}</span></div>
            <p className="whitespace-pre-wrap break-words">{translated(entry.content, `comment:${entry.id}`)}</p>
          </div>)}
        </div>
      </details>}
    </div>
  );
}
