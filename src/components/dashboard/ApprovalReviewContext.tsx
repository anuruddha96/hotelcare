import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  BedDouble,
  DoorClosed,
  FileText,
  Globe,
  Loader2,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { resolveApprovalInstructionContext } from '@/lib/approval-instruction-context';

interface ApprovalReviewContextProps {
  assignment: any;
  guestDeclined?: boolean;
}

interface ApprovalMessage {
  id: string;
  content: string;
  created_by: string | null;
  created_at: string;
  assignment_id: string | null;
  room_id: string;
  senderName: string;
  senderRole: string | null;
}

function assignmentTypeLabel(type: string): string {
  switch (type) {
    case 'checkout_cleaning': return 'Checkout Clean';
    case 'daily_cleaning': return 'Daily Room';
    case 'deep_cleaning': return 'Deep Clean';
    case 'maintenance': return 'Maintenance';
    default: return type || 'Housekeeping';
  }
}

function senderRoleLabel(role: string | null): string {
  const normalized = (role || '').toLowerCase();
  if (normalized === 'housekeeper') return 'Housekeeper';
  if (normalized === 'manager' || normalized === 'admin' || normalized === 'supervisor') return 'Manager';
  if (normalized === 'reception' || normalized === 'front_desk') return 'Reception';
  if (!normalized) return 'Hotel team';
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

export function ApprovalReviewContext({ assignment, guestDeclined = false }: ApprovalReviewContextProps) {
  const { language } = useTranslation();
  const context = useMemo(() => resolveApprovalInstructionContext(assignment), [assignment]);
  const [messages, setMessages] = useState<ApprovalMessage[]>([]);
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, string>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadConversation = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('housekeeping_notes')
          .select('id, content, note_type, created_by, created_at, room_id, assignment_id')
          .eq('room_id', assignment.room_id)
          .eq('note_type', 'message')
          .order('created_at', { ascending: true });

        if (error) throw error;

        const matching = (data || []).filter((message: any) => {
          if (message.assignment_id) return message.assignment_id === assignment.id;
          if (!message.created_at || !assignment.assignment_date) return false;
          const createdDate = new Date(message.created_at).toISOString().slice(0, 10);
          return createdDate === assignment.assignment_date;
        });

        const creatorIds = Array.from(new Set(
          matching.map((message: any) => message.created_by).filter(Boolean),
        )) as string[];

        const profileByKey = new Map<string, any>();
        if (creatorIds.length > 0) {
          const [byUserId, byProfileId] = await Promise.all([
            (supabase as any)
              .from('profiles')
              .select('id, user_id, full_name, nickname, role')
              .in('user_id', creatorIds),
            (supabase as any)
              .from('profiles')
              .select('id, user_id, full_name, nickname, role')
              .in('id', creatorIds),
          ]);

          for (const profile of [...(byUserId.data || []), ...(byProfileId.data || [])]) {
            if (profile.id) profileByKey.set(profile.id, profile);
            if (profile.user_id) profileByKey.set(profile.user_id, profile);
          }
        }

        const enriched = matching.map((message: any) => {
          const sender = message.created_by ? profileByKey.get(message.created_by) : null;
          const fallbackHousekeeper = assignment.profiles?.nickname || assignment.profiles?.full_name;
          const isAssignedHousekeeper = Boolean(
            message.created_by && (
              message.created_by === assignment.assigned_to ||
              sender?.id === assignment.assigned_to ||
              sender?.user_id === assignment.assigned_to
            )
          );

          return {
            ...message,
            senderName: sender?.nickname || sender?.full_name || (isAssignedHousekeeper ? fallbackHousekeeper : null) || 'Hotel team',
            senderRole: sender?.role || (isAssignedHousekeeper ? 'housekeeper' : null),
          } as ApprovalMessage;
        });

        if (!cancelled) setMessages(enriched);
      } catch (error) {
        console.error('Error loading approval conversation:', error);
      }
    };

    loadConversation();
    return () => { cancelled = true; };
  }, [assignment.id, assignment.room_id, assignment.assignment_date, assignment.assigned_to, assignment.profiles]);

  const translateMessage = async (message: ApprovalMessage) => {
    setTranslatingId(message.id);
    try {
      const { data, error } = await supabase.functions.invoke('translate-note', {
        body: { text: message.content, targetLanguage: language },
      });
      if (error) throw error;
      setTranslatedMessages(prev => ({ ...prev, [message.id]: data.translatedText }));
    } catch (error) {
      console.error('Approval conversation translation failed:', error);
      toast.error('Translation failed');
    } finally {
      setTranslatingId(null);
    }
  };

  const hasSpecialRequirements = Boolean(
    context.towelChangeRequired ||
    context.linenChangeRequired ||
    context.collectExtraTowels ||
    context.roomCleaningRequested ||
    context.greenBoardRequested ||
    context.bedInstruction ||
    context.isDnd ||
    context.managerInstruction ||
    context.assignmentInstruction
  );

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20 p-2.5 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <FileText className="h-3.5 w-3.5 text-blue-700 dark:text-blue-300 shrink-0" />
            <span className="text-xs font-bold text-blue-950 dark:text-blue-100">Original Cleaning Brief</span>
          </div>
          <div className="text-[9px] text-blue-700/70 dark:text-blue-300/70 shrink-0">
            {context.snapshotAvailable ? 'Captured for this assignment' : 'Legacy live fallback'}
          </div>
        </div>

        {guestDeclined && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-3 w-3" />
            Original request shown for review — cleaning was not performed.
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px] bg-white/80 dark:bg-background px-1.5 py-0">
            {assignmentTypeLabel(context.assignmentType)}
          </Badge>
          {context.priority >= 3 && (
            <Badge className="text-[10px] bg-red-600 text-white px-1.5 py-0.5">High Priority</Badge>
          )}
          {context.towelChangeRequired && (
            <Badge className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5">🧺 Towel Change</Badge>
          )}
          {context.linenChangeRequired && (
            <Badge className="text-[10px] bg-purple-600 text-white px-1.5 py-0.5">🛏️ Linen Change</Badge>
          )}
          {context.roomCleaningRequested && (
            <Badge className="text-[10px] bg-green-600 text-white px-1.5 py-0.5">✓ Clean Room Request</Badge>
          )}
          {context.greenBoardRequested && (
            <Badge className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5">🟢 Green Board</Badge>
          )}
          {context.collectExtraTowels && (
            <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-800 dark:text-blue-200 px-1.5 py-0">Collect Extra Towels</Badge>
          )}
          {context.isDnd && (
            <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-800 dark:text-orange-200 px-1.5 py-0">
              <DoorClosed className="h-3 w-3 mr-0.5" /> DND
            </Badge>
          )}
          {context.bedInstruction && (
            <Badge variant="outline" className="text-[10px] border-indigo-300 text-indigo-800 dark:text-indigo-200 px-1.5 py-0">
              <BedDouble className="h-3 w-3 mr-0.5" /> {context.bedInstruction}
            </Badge>
          )}
          {context.guestNightsStayed != null && context.assignmentType === 'daily_cleaning' && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">Night {context.guestNightsStayed}</Badge>
          )}
        </div>

        {!hasSpecialRequirements && (
          <div className="text-[10px] text-blue-800/70 dark:text-blue-200/70">No additional special request was recorded.</div>
        )}

        {context.managerInstruction && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 p-2">
            <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-900 dark:text-amber-100 uppercase tracking-wide">
              <Sparkles className="h-3 w-3" /> Manager Instructions
            </div>
            <p className="mt-0.5 text-xs text-amber-950 dark:text-amber-50 whitespace-pre-wrap break-words">
              {context.managerInstruction}
            </p>
          </div>
        )}

        {context.assignmentInstruction && context.assignmentInstruction !== context.managerInstruction && (
          <div className="rounded-md border border-blue-200 bg-white/70 dark:bg-background/50 p-2">
            <div className="text-[10px] font-semibold text-blue-900 dark:text-blue-100 uppercase tracking-wide">Assignment Instruction</div>
            <p className="mt-0.5 text-xs text-foreground whitespace-pre-wrap break-words">
              {context.assignmentInstruction}
            </p>
          </div>
        )}
      </div>

      {messages.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
            <MessageSquare className="h-3.5 w-3.5" /> Conversation
            <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[9px]">{messages.length}</Badge>
          </div>
          {messages.map(message => (
            <div key={message.id} className="rounded-md border border-border bg-background p-2">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-semibold text-foreground truncate">{message.senderName}</span>
                  <Badge variant="outline" className="h-4 px-1 text-[8px] font-medium">
                    {senderRoleLabel(message.senderRole)}
                  </Badge>
                </div>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-xs text-foreground whitespace-pre-wrap break-words">
                {translatedMessages[message.id] || message.content}
              </p>
              {!translatedMessages[message.id] && (
                <button
                  type="button"
                  className="mt-1 text-[9px] text-primary hover:underline inline-flex items-center gap-0.5"
                  onClick={() => translateMessage(message)}
                  disabled={translatingId === message.id}
                >
                  {translatingId === message.id
                    ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    : <Globe className="h-2.5 w-2.5" />}
                  Translate
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
