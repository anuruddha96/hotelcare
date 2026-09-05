import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

type RoomMessage = {
  id: string;
  content: string;
  created_by: string;
  created_at: string;
  note_type: string;
};

type MessageAuthor = {
  id: string;
  full_name?: string | null;
  nickname?: string | null;
  role?: string | null;
};

interface RoomCommunicationPanelProps {
  assignmentId: string;
  roomId: string;
  roomNumber: string;
  /** Manager views can pass the selected work date; housekeeper views default to today. */
  dateLabel?: string;
  /** Hide an empty panel on compact/optional room cards until someone writes. */
  hideWhenEmpty?: boolean;
}

/**
 * Assignment-scoped room conversation.
 *
 * A new room assignment is created for each work date, so the thread naturally
 * starts empty on the next day without deleting audit history from the database.
 */
export function RoomCommunicationPanel({
  assignmentId,
  roomId,
  roomNumber,
  dateLabel,
  hideWhenEmpty = false,
}: RoomCommunicationPanelProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [authors, setAuthors] = useState<Record<string, MessageAuthor>>({});
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const highlightedMessageId = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('hkMessage');
  }, []);

  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('housekeeping_notes')
      .select('id, content, created_by, created_at, note_type')
      .eq('room_id', roomId)
      .eq('assignment_id', assignmentId)
      .eq('note_type', 'message')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to load room communication:', error);
      return;
    }

    const rows = (data || []) as RoomMessage[];
    setMessages(rows);

    const authorIds = Array.from(new Set(rows.map((row) => row.created_by).filter(Boolean)));
    if (authorIds.length === 0) {
      setAuthors({});
      return;
    }

    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, nickname, role')
      .in('id', authorIds);

    if (profileError) {
      console.error('Failed to load room message authors:', profileError);
      return;
    }

    const nextAuthors: Record<string, MessageAuthor> = {};
    for (const author of (profileRows || []) as MessageAuthor[]) nextAuthors[author.id] = author;
    setAuthors(nextAuthors);
  }, [assignmentId, roomId]);

  useEffect(() => {
    void fetchMessages();

    const channel = supabase
      .channel(`room-communication-${assignmentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'housekeeping_notes',
          filter: `assignment_id=eq.${assignmentId}`,
        },
        () => void fetchMessages(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [assignmentId, fetchMessages]);

  const sendReply = async () => {
    const content = draft.trim();
    if (!content || !user?.id || sending) return;

    setSending(true);
    try {
      const { error } = await supabase.from('housekeeping_notes').insert({
        room_id: roomId,
        assignment_id: assignmentId,
        note_type: 'message',
        content,
        created_by: user.id,
      } as any);

      if (error) throw error;
      setDraft('');
      await fetchMessages();
    } catch (error) {
      console.error('Failed to send room message:', error);
      toast.error('Could not send the room message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const authorLabel = (message: RoomMessage) => {
    if (message.created_by === user?.id) return 'You';
    const author = authors[message.created_by];
    if (!author) return 'Team member';

    const name = String(author.nickname || author.full_name || '').trim();
    const role = String(author.role || '').toLowerCase();
    const roleLabel = role === 'housekeeping'
      ? 'Housekeeper'
      : role === 'reception'
        ? 'Reception'
        : ['manager', 'housekeeping_manager', 'admin', 'top_management', 'top_management_manager', 'supervisor'].includes(role)
          ? 'Manager'
          : 'Team member';

    return name ? `${roleLabel} · ${name}` : roleLabel;
  };

  if (hideWhenEmpty && messages.length === 0) return null;

  const threadDate = dateLabel?.trim() || 'today';

  return (
    <section className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-4 w-4 text-blue-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Room messages · {threadDate}</p>
            <p className="text-[11px] text-muted-foreground">Room {roomNumber} · this conversation belongs to this work-date assignment only</p>
          </div>
        </div>
        {messages.length > 0 && (
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-blue-600 text-white shrink-0">
            {messages.length}
          </span>
        )}
      </div>

      {messages.length > 0 ? (
        <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
          {messages.map((message) => {
            const mine = message.created_by === user?.id;
            const highlighted = message.id === highlightedMessageId;
            return (
              <div
                key={message.id}
                className={`rounded-lg border p-2 ${
                  highlighted
                    ? 'border-blue-600 bg-blue-100 dark:bg-blue-900/40 ring-2 ring-blue-500/40'
                    : mine
                      ? 'border-border bg-background/90'
                      : 'border-blue-200 dark:border-blue-800 bg-background/90'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
                    {authorLabel(message)}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm leading-snug whitespace-pre-wrap break-words">{message.content}</p>
                {highlighted && (
                  <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 mt-1">New message</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No room messages for this work date yet.</p>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a message about this room…"
          rows={2}
          className="min-h-[56px] text-sm bg-background"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendReply();
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          className="h-10 w-10 shrink-0"
          disabled={sending || !draft.trim()}
          onClick={() => void sendReply()}
          aria-label="Send room message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}
