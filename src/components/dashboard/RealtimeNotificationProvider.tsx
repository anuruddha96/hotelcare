import React, { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useTranslation } from '@/hooks/useTranslation';

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
  const { showNotification } = useNotifications();
  const { t } = useTranslation();

  useEffect(() => {
    if (!user?.id) return;

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

        const { data: latest, error: assignmentError } = await supabase
          .from('room_assignments')
          .select('id, room_id, assigned_to, manager_instruction_text, manager_instruction_updated_at')
          .eq('id', record.id)
          .maybeSingle();

        if (assignmentError || !latest || latest.assigned_to !== user.id) return;

        const latestVersion = String((latest as any).manager_instruction_updated_at || '');
        const latestText = String((latest as any).manager_instruction_text || '').trim();
        if (!latestVersion || !latestText) return;
        if (deliveredInstructionVersions.get(record.id) === latestVersion) return;

        const { data: room } = await supabase
          .from('rooms')
          .select('room_number')
          .eq('id', latest.room_id)
          .maybeSingle();

        deliveredInstructionVersions.set(record.id, latestVersion);
        showNotification(
          latestText,
          'info',
          room?.room_number ? `Room ${room.room_number} · Manager instruction` : 'Manager instruction'
        );
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

      showNotification(
        String(note.content).trim(),
        'info',
        room?.room_number ? `Room ${room.room_number} · New message` : 'New housekeeping message'
      );
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
  }, [user?.id, profile?.role, showNotification, t]);

  return <>{children}</>;
}
