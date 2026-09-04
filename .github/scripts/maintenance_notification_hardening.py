from pathlib import Path

path = Path('src/components/dashboard/NotificationPermissionBanner.tsx')
text = path.read_text()
start_marker = "\n\n  useEffect(() => {\n    if (!user?.id || !profile?.organization_slug || !profile?.assigned_hotel) return;"
end_marker = "\n  }, [user?.id, profile?.organization_slug, profile?.assigned_hotel, profile?.role, language, showNotification]);\n"
start = text.find(start_marker)
if start < 0:
    raise SystemExit('maintenance notification effect start not found')
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit('maintenance notification effect end not found')
end += len(end_marker)
replacement = r'''

  useEffect(() => {
    if (!user?.id || !profile?.organization_slug || !profile?.assigned_hotel) return;
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const assignedSeen = new Set<string>();
    const pendingSeen = new Set<string>();
    const approvedSeen = new Set<string>();

    const copy: Record<string, { title: string; assigned: string; forwarded: string; approval: string; approved: string; room: string }> = {
      en: { title: 'Maintenance', assigned: 'New maintenance task assigned', forwarded: 'New maintenance request forwarded', approval: 'Repair submitted for supervisor approval', approved: 'Your maintenance repair was approved', room: 'Room' },
      hu: { title: 'Karbantartás', assigned: 'Új karbantartási feladat érkezett', forwarded: 'Új karbantartási kérés továbbítva', approval: 'A javítás felügyelői jóváhagyásra vár', approved: 'A karbantartási javítást jóváhagyták', room: 'Szoba' },
      es: { title: 'Mantenimiento', assigned: 'Nueva tarea de mantenimiento asignada', forwarded: 'Nueva solicitud de mantenimiento reenviada', approval: 'Reparación enviada para aprobación del supervisor', approved: 'Su reparación de mantenimiento fue aprobada', room: 'Habitación' },
      vi: { title: 'Bảo trì', assigned: 'Đã giao công việc bảo trì mới', forwarded: 'Đã chuyển yêu cầu bảo trì mới', approval: 'Công việc sửa chữa đã gửi để giám sát duyệt', approved: 'Công việc sửa chữa của bạn đã được duyệt', room: 'Phòng' },
      mn: { title: 'Засвар үйлчилгээ', assigned: 'Шинэ засварын ажил хуваарилагдлаа', forwarded: 'Шинэ засварын хүсэлт шилжүүлэгдлээ', approval: 'Засварыг хянагчийн зөвшөөрөлд илгээлээ', approved: 'Таны засварын ажил зөвшөөрөгдлөө', room: 'Өрөө' },
      az: { title: 'Texniki xidmət', assigned: 'Yeni texniki xidmət tapşırığı təyin edildi', forwarded: 'Yeni texniki xidmət sorğusu yönləndirildi', approval: 'Təmir nəzarətçi təsdiqinə göndərildi', approved: 'Texniki xidmət təmiriniz təsdiqləndi', room: 'Otaq' },
      tl: { title: 'Maintenance', assigned: 'May bagong maintenance task na naka-assign', forwarded: 'May bagong maintenance request na na-forward', approval: 'Ipinadala ang repair para sa supervisor approval', approved: 'Na-approve ang maintenance repair mo', room: 'Kuwarto' },
      uk: { title: 'Техобслуговування', assigned: 'Вам призначено нове завдання з ремонту', forwarded: 'Передано нову заявку на ремонт', approval: 'Ремонт надіслано на схвалення керівника', approved: 'Ваш ремонт схвалено', room: 'Кімната' },
      ru: { title: 'Техобслуживание', assigned: 'Вам назначена новая задача по ремонту', forwarded: 'Передана новая заявка на ремонт', approval: 'Ремонт отправлен на одобрение руководителя', approved: 'Ваш ремонт одобрен', room: 'Комната' },
    };

    const setup = async () => {
      const keys = await resolveHotelKeys(profile.assigned_hotel);
      const hotelKeys = keys.length ? keys : [profile.assigned_hotel];
      const c = copy[language] || copy.en;
      const supervisorRoles = new Set(['manager', 'housekeeping_manager', 'maintenance_manager', 'supervisor', 'admin', 'top_management', 'top_management_manager']);

      let existingQuery = (supabase as any)
        .from('tickets')
        .select('id, assigned_to, pending_supervisor_approval, supervisor_approved, status')
        .eq('department', 'maintenance')
        .eq('organization_slug', profile.organization_slug)
        .neq('source', 'housekeeping_legacy_backfill');
      if (hotelKeys.length) existingQuery = existingQuery.in('hotel', hotelKeys);
      const { data: existingRows } = await existingQuery;
      for (const row of existingRows || []) {
        if (row.assigned_to === user.id && row.status !== 'completed') assignedSeen.add(row.id);
        if (row.pending_supervisor_approval === true) pendingSeen.add(row.id);
        if (row.assigned_to === user.id && row.supervisor_approved === true) approvedSeen.add(row.id);
      }
      if (disposed) return;

      channel = supabase
        .channel(`maintenance-notifications-${user.id}-${profile.assigned_hotel}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload: any) => {
          const row = payload.new || payload.old;
          if (!row || row.department !== 'maintenance') return;
          if (row.organization_slug !== profile.organization_slug) return;
          if (row.source === 'housekeeping_legacy_backfill') return;
          if (row.hotel && !hotelKeys.includes(row.hotel)) return;

          const suffix = row.room_number ? ` · ${c.room} ${row.room_number}` : '';
          const isMine = row.assigned_to === user.id;
          if (!isMine) assignedSeen.delete(row.id);
          if (row.pending_supervisor_approval !== true) pendingSeen.delete(row.id);
          if (row.supervisor_approved !== true) approvedSeen.delete(row.id);

          if (isMine && row.supervisor_approved === true && !approvedSeen.has(row.id)) {
            approvedSeen.add(row.id);
            void showNotification(`${c.approved}${suffix}`, 'success', c.title);
            return;
          }
          if (isMine && row.supervisor_approved !== true && !assignedSeen.has(row.id)) {
            assignedSeen.add(row.id);
            void showNotification(`${c.assigned}${suffix}`, 'info', c.title);
            return;
          }

          if (!supervisorRoles.has(profile.role || '')) return;
          if (payload.eventType === 'INSERT' && row.created_by !== user.id) {
            void showNotification(`${c.forwarded}${suffix}`, row.priority === 'urgent' ? 'warning' : 'info', c.title);
          }
          if (row.pending_supervisor_approval === true && !pendingSeen.has(row.id)) {
            pendingSeen.add(row.id);
            void showNotification(`${c.approval}${suffix}`, 'warning', c.title);
          }
        })
        .subscribe();
    };

    void setup();
    return () => {
      disposed = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user?.id, profile?.organization_slug, profile?.assigned_hotel, profile?.role, language, showNotification]);
'''
path.write_text(text[:start] + replacement + text[end:])

Path('.github/workflows/maintenance-notification-hardening.yml').unlink(missing_ok=True)
Path('.github/scripts/maintenance_notification_hardening.py').unlink(missing_ok=True)
