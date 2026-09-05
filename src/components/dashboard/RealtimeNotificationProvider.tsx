import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useTranslation } from '@/hooks/useTranslation';
import { serviceWorkerManager } from '@/lib/serviceWorkerManager';

type HighlightedRoomMessage = {
  element: HTMLElement;
  roomNumber: string;
  content: string;
  kind: 'message' | 'instruction';
};

/**
 * Global notifications that are NOT owned by the housekeeping notification hook.
 *
 * Room assignments, completed-room approvals and break requests are deliberately
 * handled only by useNotifications. Keeping a single owner prevents duplicate
 * alerts and lets that hook enforce the operational-manager audience centrally.
 *
 * Manager-to-housekeeper instructions are handled here because they can arrive
 * through two different paths: room-level instructions and housekeeping messages.
 */
export function RealtimeNotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const {
    showNotification,
    requestNotificationPermission,
    notificationPermission,
  } = useNotifications();
  const { t } = useTranslation();
  const location = useLocation();
  const [highlightedRoomMessage, setHighlightedRoomMessage] = useState<HighlightedRoomMessage | null>(null);
  const [notificationClickNonce, setNotificationClickNonce] = useState(0);

  // The service worker also sends a message after focusing an already-open Hotel
  // Care window. Incrementing this nonce makes an already-open/same-URL room
  // notification scroll and flash again without needing a page reload.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'HOTELCARE_NOTIFICATION_CLICK') {
        setNotificationClickNonce((value) => value + 1);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleWorkerMessage);
  }, []);

  // Resolve room notification deep links after the housekeeping screen renders.
  // We intentionally locate the room by its visible title so this works for both
  // the normal AssignedRoomCard and the Hotel Memories optional daily-room card.
  useEffect(() => {
    if (!user?.id || typeof window === 'undefined') return;

    const params = new URLSearchParams(location.search);
    const assignmentId = params.get('hkAssignment');
    const roomNumber = params.get('hkRoomNumber');
    const messageId = params.get('hkMessage');
    const instructionTarget = params.get('hkInstruction') === '1';

    if (!assignmentId || !roomNumber || (!messageId && !instructionTarget)) return;

    // Move the dashboard to My Tasks/Housekeeping first. Dashboard already
    // understands this event and keeps its own role-specific tab behavior.
    window.dispatchEvent(new CustomEvent('training-navigate', {
      detail: { mainTab: 'housekeeping' },
    }));

    let cancelled = false;
    let ringTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const loadContent = async (): Promise<{ content: string; kind: 'message' | 'instruction' }> => {
      if (messageId) {
        const { data } = await supabase
          .from('housekeeping_notes')
          .select('content')
          .eq('id', messageId)
          .eq('assignment_id', assignmentId)
          .maybeSingle();
        return {
          content: String(data?.content || 'Open the room messages section to see the new message.'),
          kind: 'message',
        };
      }

      const { data } = await (supabase
        .from('room_assignments') as any)
        .select('manager_instruction_text')
        .eq('id', assignmentId)
        .maybeSingle();
      return {
        content: String(data?.manager_instruction_text || 'Open this room to see the updated manager instruction.'),
        kind: 'instruction',
      };
    };

    const findVisibleRoomCard = (): HTMLElement | null => {
      const expected = `Room ${roomNumber}`;
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,span,div'),
      );

      for (const candidate of candidates) {
        if (candidate.children.length > 0) continue;
        if (candidate.textContent?.trim() !== expected) continue;
        if (candidate.getClientRects().length === 0) continue;

        const card = candidate.closest<HTMLElement>('.bg-card');
        if (card && card.getClientRects().length > 0) return card;
      }

      return null;
    };

    const focusRoom = async (attempt = 0) => {
      if (cancelled) return;
      const card = findVisibleRoomCard();

      if (!card) {
        if (attempt < 24) {
          retryTimer = setTimeout(() => void focusRoom(attempt + 1), 350);
        }
        return;
      }

      const { content, kind } = await loadContent();
      if (cancelled) return;

      card.classList.add('ring-4', 'ring-blue-500', 'ring-offset-2');
      card.style.scrollMarginTop = '96px';
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedRoomMessage({ element: card, roomNumber, content, kind });

      ringTimer = setTimeout(() => {
        card.classList.remove('ring-4', 'ring-blue-500', 'ring-offset-2');
      }, 9000);
    };

    // Give Dashboard one paint to switch its active tab before looking for cards.
    retryTimer = setTimeout(() => void focusRoom(), 120);

    return () => {
      cancelled = true;
      if (ringTimer) clearTimeout(ringTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [location.search, notificationClickNonce, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    // Browser/PWA notification for a specific room. The normal notification
    // hook is still used for the audible/in-app toast, but we deliberately send
    // the system notification ourselves so it can carry a room deep link.
    const sendRoomAlert = async ({
      assignmentId,
      roomId,
      roomNumber,
      content,
      messageId,
      instruction,
    }: {
      assignmentId: string;
      roomId: string;
      roomNumber?: string | null;
      content: string;
      messageId?: string | null;
      instruction?: boolean;
    }) => {
      const cleanContent = content.trim();
      if (!cleanContent) return;

      const roomLabel = roomNumber ? `Room ${roomNumber}` : 'Room';
      await showNotification(`${roomLabel}: ${cleanContent}`, 'info');

      if (!('Notification' in window)) return;

      let granted = notificationPermission === 'granted';
      if (!granted && notificationPermission === 'default') {
        granted = await requestNotificationPermission();
      }
      if (!granted) return;

      const targetUrl = new URL(window.location.href);
      targetUrl.searchParams.set('tab', 'housekeeping');
      targetUrl.searchParams.set('hkAssignment', assignmentId);
      targetUrl.searchParams.set('hkRoom', roomId);
      if (roomNumber) targetUrl.searchParams.set('hkRoomNumber', roomNumber);
      if (messageId) targetUrl.searchParams.set('hkMessage', messageId);
      else targetUrl.searchParams.delete('hkMessage');
      if (instruction) targetUrl.searchParams.set('hkInstruction', '1');
      else targetUrl.searchParams.delete('hkInstruction');

      await serviceWorkerManager.sendNotification(
        `Hotel Care · ${roomLabel} · ${instruction ? 'Manager instruction' : 'New message'}`,
        cleanContent,
        {
          url: targetUrl.toString(),
          assignmentId,
          roomId,
          roomNumber,
          messageId: messageId || null,
          kind: instruction ? 'manager_instruction' : 'housekeeping_message',
          tag: `housekeeping-room-${assignmentId}`,
          timestamp: Date.now(),
        },
      );
    };

    // Room notes auto-save while a manager types. Debounce instruction updates
    // per assignment so a housekeeper receives one finished instruction instead
    // of a notification for every autosave.
    const instructionTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const deliveredInstructionVersions = new Map<string, string>();

    const scheduleManagerInstruction = (payload: any) => {
      const record = payload?.new as any;
      if (!record?.id || !record?.manager_instruction_updated_at) return;

      const instructionText = String(record.manager_instruction_text || '').trim();
      if (!instructionText) return;

      // This subscription also sees normal room-assignment updates. Only react
      // when the instruction timestamp was written in the same DB transaction.
      const instructionTime = Date.parse(record.manager_instruction_updated_at);
      const commitTime = Date.parse(payload?.commit_timestamp || '');
      if (!Number.isFinite(instructionTime)) return;
      if (Number.isFinite(commitTime) && Math.abs(commitTime - instructionTime) > 10000) return;

      const version = String(record.manager_instruction_updated_at);
      if (deliveredInstructionVersions.get(record.id) === version) return;

      const existingTimer = instructionTimers.get(record.id);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(async () => {
        instructionTimers.delete(record.id);

        // The new columns are introduced by the paired DB migration. Cast this
        // one query until generated Supabase types are refreshed.
        const { data: latest, error: assignmentError } = await (supabase
          .from('room_assignments') as any)
          .select('id, room_id, assigned_to, manager_instruction_text, manager_instruction_updated_at')
          .eq('id', record.id)
          .maybeSingle();

        if (assignmentError || !latest || latest.assigned_to !== user.id) return;

        const latestVersion = String(latest.manager_instruction_updated_at || '');
        const latestText = String(latest.manager_instruction_text || '').trim();
        if (!latestVersion || !latestText) return;
        if (deliveredInstructionVersions.get(record.id) === latestVersion) return;

        const { data: room } = await supabase
          .from('rooms')
          .select('room_number')
          .eq('id', latest.room_id)
          .maybeSingle();

        deliveredInstructionVersions.set(record.id, latestVersion);
        await sendRoomAlert({
          assignmentId: latest.id,
          roomId: latest.room_id,
          roomNumber: room?.room_number,
          content: latestText,
          instruction: true,
        });
      }, 1500);

      instructionTimers.set(record.id, timer);
    };

    const notifyHousekeepingMessage = async (payload: any) => {
      const note = payload?.new as any;
      if (!note?.assignment_id || !note?.content) return;
      if (note.created_by === user.id) return;

      const { data: assignment, error: assignmentError } = await supabase
        .from('room_assignments')
        .select('id, room_id, assigned_to, status')
        .eq('id', note.assignment_id)
        .maybeSingle();

      if (assignmentError || !assignment || assignment.assigned_to !== user.id) return;
      if (assignment.status === 'cancelled') return;

      const { data: room } = await supabase
        .from('rooms')
        .select('room_number')
        .eq('id', assignment.room_id)
        .maybeSingle();

      await sendRoomAlert({
        assignmentId: assignment.id,
        roomId: assignment.room_id,
        roomNumber: room?.room_number,
        content: String(note.content),
        messageId: note.id,
      });
    };

    // Maintenance approvals remain visible to senior management because they
    // can require management action. Routine housekeeping workflow does not.
    const maintenanceApprovalRoles = new Set([
      'manager',
      'housekeeping_manager',
      'admin',
      'top_management',
      'top_management_manager',
    ]);

    const channels = [
      ...(profile?.role && maintenanceApprovalRoles.has(profile.role) ? [
        supabase
          .channel(`maintenance-pending-approvals-${user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'tickets'
            },
            (payload: any) => {
              if (
                payload.new.pending_supervisor_approval === true &&
                payload.old.pending_supervisor_approval !== true &&
                payload.new.department === 'maintenance'
              ) {
                showNotification(
                  t('notifications.maintenanceReview'),
                  'info',
                  t('notifications.maintenanceApproval')
                );
              }
            }
          )
          .subscribe()
      ] : []),

      // Personal ticket notifications are role-neutral: only the assignee or
      // creator receives them.
      supabase
        .channel(`ticket-notifications-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'tickets',
            filter: `assigned_to=eq.${user.id}`
          },
          () => {
            showNotification(
              t('notifications.newTicketAssigned'),
              'info',
              t('notifications.newTicketLabel')
            );
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'tickets',
            filter: `created_by=eq.${user.id}`
          },
          (payload) => {
            if (payload.new.status !== payload.old.status) {
              showNotification(
                t('notifications.ticketStatusChanged').replace('{status}', payload.new.status),
                'info',
                t('notifications.ticketUpdateLabel')
              );
            }
          }
        )
        .subscribe(),

      // Room-level manager instructions are copied onto the active assignment by
      // a DB trigger. MobileHousekeepingView already listens to assignment updates,
      // so this also forces the visible room card to refresh without an app restart.
      supabase
        .channel(`housekeeping-instructions-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'room_assignments',
            filter: `assigned_to=eq.${user.id}`
          },
          scheduleManagerInstruction
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'housekeeping_notes'
          },
          notifyHousekeepingMessage
        )
        .subscribe()
    ];

    return () => {
      instructionTimers.forEach((timer) => clearTimeout(timer));
      instructionTimers.clear();
      channels.forEach((channel) => {
        if (channel) supabase.removeChannel(channel);
      });
    };
  }, [user?.id, profile?.role, showNotification, requestNotificationPermission, notificationPermission, t]);

  const dismissHighlightedMessage = () => {
    if (highlightedRoomMessage?.element) {
      highlightedRoomMessage.element.classList.remove('ring-4', 'ring-blue-500', 'ring-offset-2');
    }
    setHighlightedRoomMessage(null);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('hkAssignment');
      url.searchParams.delete('hkRoom');
      url.searchParams.delete('hkRoomNumber');
      url.searchParams.delete('hkMessage');
      url.searchParams.delete('hkInstruction');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  };

  return (
    <>
      {children}
      {highlightedRoomMessage && createPortal(
        <div className="m-3 rounded-xl border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/90 p-3 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                {highlightedRoomMessage.kind === 'message' ? '💬 New message' : '💬 New manager instruction'} · Room {highlightedRoomMessage.roomNumber}
              </p>
              <p className="mt-1 text-sm font-semibold leading-snug whitespace-pre-wrap break-words">
                {highlightedRoomMessage.content}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissHighlightedMessage}
              className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-100 dark:text-blue-200 dark:hover:bg-blue-900"
              aria-label="Dismiss new room message"
            >
              ×
            </button>
          </div>
        </div>,
        highlightedRoomMessage.element,
      )}
    </>
  );
}
