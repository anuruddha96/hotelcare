import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock3, History, UserRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  formatBudapestNoteTimestamp,
  isNoteFromBudapestToday,
  matchingRoomNoteHistory,
  type RoomNoteHistoryEntry,
} from '@/lib/roomNoteProvenance';

type Props = {
  roomId: string | null | undefined;
  /** The exact saved rooms.notes value; never the unsaved editor draft. */
  roomNotes: string | null | undefined;
  language?: string;
  draftChanged?: boolean;
  showHistory?: boolean;
};

/**
 * Shared for manager/housekeeper views across every hotel.
 * Queries only when the note is on screen to avoid waking dozens of hidden
 * room cards or increasing overnight load.
 */
export function RoomNoteProvenance({
  roomId, roomNotes, language = 'en', draftChanged = false, showHistory = false,
}: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const hu = language === 'hu';

  useEffect(() => {
    setVisible(false);
    setExpanded(false);
    const el = holderRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [roomId]);

  const { data = [], isPending, isError } = useQuery({
    queryKey: ['room-note-provenance', roomId, roomNotes],
    queryFn: async (): Promise<RoomNoteHistoryEntry[]> => {
      const { data: rows, error } = await (supabase as any).rpc('get_room_note_history', {
        p_room_id: roomId,
        p_limit: 5,
      });
      if (error) throw error;
      return (rows || []) as RoomNoteHistoryEntry[];
    },
    enabled: visible && !!roomId && !!roomNotes?.trim(),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!roomId || !roomNotes?.trim()) {
    if (!draftChanged) return null;
    return <p className="mt-2 text-xs text-amber-700">{hu ? 'Még nem mentett megjegyzés.' : 'Note not saved yet.'}</p>;
  }

  const current = matchingRoomNoteHistory(roomNotes, data);
  const currentTimestamp = current ? formatBudapestNoteTimestamp(current.created_at, language) : '';
  const author = current?.created_by_name?.trim() || (hu ? 'Ismeretlen szerző' : 'Unknown author');
  const isOlder = current && !isNoteFromBudapestToday(current.created_at);
  const statusText = draftChanged
    ? (hu ? 'Nem mentett módosítások · az időpont a legutóbb mentett megjegyzéshez tartozik' : 'Unsaved changes · time refers to the last saved note')
    : !visible || isPending
      ? (hu ? 'A megjegyzés időpontjának lekérése…' : 'Checking note date…')
      : isError
        ? (hu ? 'A megjegyzés előzményei nem érhetők el' : 'Note history unavailable')
        : !current || !currentTimestamp
          ? (hu ? 'A megjegyzés pontos időpontja nem ismert' : 'Note date/time not recorded')
          : (hu ? 'Rögzítve: ' : 'Entered: ') + currentTimestamp + ' · ' + author;

  return (
    <div ref={holderRef} className="mt-2 text-xs text-slate-600 dark:text-slate-300" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className={isOlder ? 'font-semibold text-amber-800 dark:text-amber-300' : 'font-medium'}>
          {statusText}
        </span>
        {current && !draftChanged && currentTimestamp && (
          <span className="inline-flex items-center gap-1 text-[10px]">
            <UserRound className="h-3 w-3" aria-hidden="true" />
            {hu ? 'Budapesti idő' : 'Budapest time'}
          </span>
        )}
      </div>
      {showHistory && data.length > 0 && (
        <div className="mt-2">
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}>
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            {hu ? 'Korábbi módosítások (legutóbbi 5)' : 'Note history (last 5 changes)'}
          </button>
          {expanded && (
            <ol className="mt-2 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white/80 p-2 dark:bg-slate-900">
              {data.map((entry) => (
                <li key={entry.id} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                  <p className="font-semibold">
                    {formatBudapestNoteTimestamp(entry.created_at, language) || (hu ? 'Ismeretlen időpont' : 'Unknown date')}
                    {' · '}{entry.created_by_name || (hu ? 'Ismeretlen szerző' : 'Unknown author')}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{entry.content}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
