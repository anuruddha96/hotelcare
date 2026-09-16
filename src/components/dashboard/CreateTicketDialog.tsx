import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AttachmentUpload, AttachmentUploadRef } from './AttachmentUpload';
import { toast } from '@/hooks/use-toast';
import { AlertTriangle, Building2, CheckCircle2, Clock3, RefreshCw, UserCheck, Wrench } from 'lucide-react';

type MaintenanceStaff = {
  id: string;
  full_name: string;
  role: string;
  assigned_hotel: string | null;
  is_signed_in: boolean;
  checked_in_at: string | null;
};

type Room = { room_number: string; hotel: string };

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketCreated: () => void;
}

const copy: Record<string, Record<string, string>> = {
  en: {
    create: 'Create maintenance ticket', intro: 'Report an issue for the selected property. Housekeeping and maintenance use the same ticket.',
    hotel: 'Hotel', room: 'Room', title: 'Issue title', description: 'What is wrong?', priority: 'Priority', department: 'Department', assignee: 'Maintenance assignee',
    auto: 'Auto-assign to today’s on-duty maintenance member', onDuty: 'On duty', offDuty: 'Not signed in', none: 'No maintenance staff configured for this hotel',
    noDuty: 'No maintenance member is signed in. Auto-assigned tickets will be picked up when maintenance checks in.',
    cancel: 'Cancel', submit: 'Create ticket', creating: 'Creating…', selectHotel: 'Select hotel', selectRoom: 'Select room', optional: 'Optional', attachments: 'Attachments',
    success: 'Maintenance ticket created', assigned: 'Assigned to', queued: 'Queued — no maintenance staff on duty', error: 'Could not create ticket', required: 'Please complete the required fields',
    roomsLoading: 'Loading rooms…', roomsEmpty: 'No mapped rooms found for this property. Check room mapping, or leave the room empty for a common-area issue.',
    roomsError: 'Room list could not be loaded. Retry before creating a room-specific ticket.', retry: 'Retry', invalidRoom: 'Select a room from this property.',
    permissionError: 'Ticket permissions could not be checked. Please retry.', uploadWarning: 'Ticket saved, but some attachments could not be uploaded.',
  },
  hu: {
    create: 'Karbantartási jegy létrehozása', intro: 'Jelentse a kiválasztott hotel hibáját. A takarítás és a karbantartás ugyanazt a jegyet használja.',
    hotel: 'Hotel', room: 'Szoba', title: 'Hiba címe', description: 'Mi a probléma?', priority: 'Prioritás', department: 'Részleg', assignee: 'Karbantartó',
    auto: 'Automatikus kiosztás a ma szolgálatban lévő karbantartónak', onDuty: 'Szolgálatban', offDuty: 'Nincs bejelentkezve', none: 'Ehhez a hotelhez nincs karbantartó beállítva',
    noDuty: 'Jelenleg nincs bejelentkezett karbantartó. Az automatikus jegyet a bejelentkezéskor osztjuk ki.',
    cancel: 'Mégse', submit: 'Jegy létrehozása', creating: 'Létrehozás…', selectHotel: 'Hotel kiválasztása', selectRoom: 'Szoba kiválasztása', optional: 'Opcionális', attachments: 'Mellékletek',
    success: 'Karbantartási jegy létrehozva', assigned: 'Hozzárendelve', queued: 'Sorban — nincs szolgálatban karbantartó', error: 'A jegy létrehozása sikertelen', required: 'Kérjük, töltse ki a kötelező mezőket',
    roomsLoading: 'Szobák betöltése…', roomsEmpty: 'Ehhez a hotelhez nem található hozzárendelt szoba. Ellenőrizze a szobatérképet, vagy közös területi hiba esetén hagyja üresen.',
    roomsError: 'Nem sikerült betölteni a szobákat. Szobához tartozó jegy előtt próbálja újra.', retry: 'Újra', invalidRoom: 'Válasszon ehhez a hotelhez tartozó szobát.',
    permissionError: 'Nem sikerült ellenőrizni a jegykezelési jogosultságot. Próbálja újra.', uploadWarning: 'A jegy mentve, de néhány melléklet feltöltése sikertelen.',
  },
};

const departments = [
  ['maintenance', 'Maintenance'], ['housekeeping', 'Housekeeping'], ['reception', 'Reception'],
  ['marketing', 'Marketing'], ['back_office', 'Back Office'], ['control', 'Control'],
  ['finance', 'Finance'], ['top_management', 'Top Management'],
] as const;

export function CreateTicketDialog({ open, onOpenChange, onTicketCreated }: CreateTicketDialogProps) {
  const { profile } = useAuth();
  const { hotels: tenantHotels } = useTenant();
  const { language } = useTranslation();
  const c = copy[language] || copy.en;
  const attachmentRef = useRef<AttachmentUploadRef>(null);
  const [loading, setLoading] = useState(false);
  const [canCreateTickets, setCanCreateTickets] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [maintenanceStaff, setMaintenanceStaff] = useState<MaintenanceStaff[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState(false);
  const [roomRetry, setRoomRetry] = useState(0);
  const [selectedMaintenancePerson, setSelectedMaintenancePerson] = useState('auto');
  const [formData, setFormData] = useState({ title: '', description: '', room_number: '', priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent', department: 'maintenance', hotel: '' });

  const canSelectAnyHotel = profile?.role === 'admin' || profile?.role === 'top_management' || profile?.role === 'top_management_manager' || profile?.is_super_admin;
  const availableHotels = useMemo(() => tenantHotels.filter(h => h.hotel_id !== 'all' && (
    canSelectAnyHotel || !profile?.assigned_hotel || h.hotel_id === profile.assigned_hotel || h.hotel_name === profile.assigned_hotel
  )), [tenantHotels, canSelectAnyHotel, profile?.assigned_hotel]);
  const selectedHotel = availableHotels.find(h => h.hotel_id === formData.hotel);
  // Existing rooms/tickets contain a mix of hotel IDs and legacy hotel names.
  // Only aliases from THIS tenant's authorized hotel configuration are used.
  const hotelKeys = selectedHotel ? Array.from(new Set([selectedHotel.hotel_id, selectedHotel.hotel_name].filter(Boolean))) : [];
  const onDutyCount = maintenanceStaff.filter(s => s.is_signed_in).length;

  useEffect(() => {
    if (!open) return;
    const preferred = availableHotels.find(h => h.hotel_id === profile?.assigned_hotel || h.hotel_name === profile?.assigned_hotel);
    setFormData(prev => ({ ...prev, hotel: preferred?.hotel_id || (availableHotels.length === 1 ? availableHotels[0].hotel_id : ''), room_number: '' }));
    setSelectedMaintenancePerson('auto');
  }, [open, profile?.assigned_hotel, availableHotels]);

  useEffect(() => {
    if (!open || !profile?.id) return;
    let cancelled = false;
    setCanCreateTickets(false);
    setPermissionError(false);
    void supabase.rpc('has_ticket_creation_permission', { _user_id: profile.id }).then(({ data, error }) => {
      if (cancelled) return;
      setPermissionError(!!error);
      setCanCreateTickets(!error && data !== false);
    });
    return () => { cancelled = true; };
  }, [open, profile?.id]);

  useEffect(() => {
    let cancelled = false;
    setRooms([]);
    setRoomsError(false);
    if (!open || !selectedHotel || !hotelKeys.length) { setRoomsLoading(false); return; }
    setRoomsLoading(true);
    // Do not use ilike('%hotel%'): a similar hotel name can belong to a different venue.
    void supabase.from('rooms').select('room_number, hotel').in('hotel', hotelKeys).order('room_number').then(({ data, error }) => {
      if (cancelled) return;
      setRoomsLoading(false);
      setRoomsError(!!error);
      if (error) { console.error('Maintenance room lookup failed:', error); return; }
      const unique = new Map<string, Room>();
      (data || []).forEach(room => { if (room.room_number) unique.set(room.room_number, room); });
      setRooms(Array.from(unique.values()));
    });
    return () => { cancelled = true; };
  }, [open, formData.hotel, roomRetry, tenantHotels]);

  useEffect(() => {
    let cancelled = false;
    setMaintenanceStaff([]);
    if (!open || formData.department !== 'maintenance' || !selectedHotel) { setStaffLoading(false); return; }
    setStaffLoading(true);
    void (supabase as any).rpc('get_maintenance_staff_for_hotel', { _hotel: selectedHotel.hotel_name, _signed_in_only: false })
      .then(({ data, error }: { data: MaintenanceStaff[] | null; error: Error | null }) => {
        if (cancelled) return;
        if (error) console.error('Failed to load hotel maintenance staff:', error);
        setMaintenanceStaff(error ? [] : data || []);
        setStaffLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, formData.hotel, formData.department, tenantHotels]);

  const reset = () => {
    setFormData({ title: '', description: '', room_number: '', priority: 'medium', department: 'maintenance', hotel: '' });
    setSelectedMaintenancePerson('auto');
    setRooms([]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    if (!profile?.id || !profile.organization_slug || !canCreateTickets || !selectedHotel || !formData.title.trim() || !formData.description.trim()) {
      toast({ title: c.error, description: c.required, variant: 'destructive' });
      return;
    }
    if (formData.room_number && (roomsLoading || roomsError || !rooms.some(room => room.room_number === formData.room_number))) {
      toast({ title: c.error, description: c.invalidRoom, variant: 'destructive' });
      return;
    }
    if (selectedMaintenancePerson !== 'auto' && !maintenanceStaff.some(person => person.id === selectedMaintenancePerson)) {
      toast({ title: c.error, description: c.required, variant: 'destructive' });
      return;
    }
    setLoading(true);
    let savedTicket: { id: string; assigned_to: string | null; hotel: string; ticket_number: string } | null = null;
    try {
      const manualAssignee = formData.department === 'maintenance' && selectedMaintenancePerson !== 'auto' ? selectedMaintenancePerson : null;
      const { data, error } = await (supabase as any).from('tickets').insert({
        title: formData.title.trim(), description: formData.description.trim(),
        room_number: formData.room_number || 'N/A', priority: formData.priority,
        department: formData.department, hotel: selectedHotel.hotel_name,
        created_by: profile.id, ticket_number: `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        attachment_urls: null, assigned_to: manualAssignee,
        organization_slug: profile.organization_slug, source: 'manual',
        assignment_method: manualAssignee ? 'manual' : null,
      }).select('id, assigned_to, hotel, ticket_number').single();
      if (error) throw error;
      savedTicket = data;

      // The ticket is already committed. Upload failures must not tell users to
      // retry creation and accidentally submit the same fault twice.
      if (attachmentRef.current?.hasAttachments()) {
        try {
          const uploadedPaths = await attachmentRef.current.uploadWithTicketId(data.id);
          if (uploadedPaths.length) {
            const { error: attachError } = await supabase.from('tickets').update({ attachment_urls: uploadedPaths }).eq('id', data.id).eq('organization_slug', profile.organization_slug).eq('hotel', selectedHotel.hotel_name);
            if (attachError) throw attachError;
          }
        } catch (attachmentError) {
          console.error('Ticket created but attachment upload failed:', attachmentError);
          toast({ title: c.uploadWarning, variant: 'destructive' });
        }
      }
      if (data.assigned_to) {
        try {
          await supabase.functions.invoke('send-work-assignment-notification', {
            body: { staff_id: data.assigned_to, assignment_type: 'ticket', assignment_details: {
              id: data.id, title: formData.title.trim(), room_number: formData.room_number || 'N/A', priority: formData.priority,
            }, hotel_name: selectedHotel.hotel_name },
          });
        } catch (notificationError) { console.warn('Ticket saved, assignment notification failed:', notificationError); }
      }
      const assigneeName = maintenanceStaff.find(person => person.id === data.assigned_to)?.full_name;
      toast({ title: c.success, description: data.assigned_to ? `${c.assigned}: ${assigneeName || 'Maintenance'}` : c.queued });
      window.dispatchEvent(new CustomEvent('maintenance-ticket-created', { detail: data }));
      onTicketCreated();
      reset();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Maintenance ticket creation failed:', error);
      if (savedTicket) {
        onTicketCreated();
        reset();
        onOpenChange(false);
        toast({ title: c.success });
      } else {
        toast({ title: c.error, description: error?.message || c.error, variant: 'destructive' });
      }
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[94vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl"><Wrench className="h-5 w-5 text-primary" />{c.create}</DialogTitle>
          <DialogDescription>{c.intro}</DialogDescription>
        </DialogHeader>
        {!canCreateTickets ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground"><AlertTriangle className="h-10 w-10 mx-auto mb-3" />{permissionError ? c.permissionError : c.required}</CardContent></Card>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{c.hotel} *</Label>
                <Select value={formData.hotel} onValueChange={hotel => { setFormData(prev => ({ ...prev, hotel, room_number: '' })); setSelectedMaintenancePerson('auto'); }}>
                  <SelectTrigger className="h-11"><SelectValue placeholder={c.selectHotel} /></SelectTrigger>
                  <SelectContent>{availableHotels.map(h => <SelectItem key={h.hotel_id} value={h.hotel_id}>{h.hotel_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{c.room} <span className="text-muted-foreground text-xs">({c.optional})</span></Label>
                <Select value={formData.room_number || 'none'} disabled={!selectedHotel || roomsLoading || roomsError} onValueChange={value => setFormData(prev => ({ ...prev, room_number: value === 'none' ? '' : value }))}>
                  <SelectTrigger className="h-11"><SelectValue placeholder={roomsLoading ? c.roomsLoading : c.selectRoom} /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem>{rooms.map(room => <SelectItem key={room.room_number} value={room.room_number}>{room.room_number}</SelectItem>)}</SelectContent>
                </Select>
                {selectedHotel && roomsLoading && <p className="text-xs text-muted-foreground">{c.roomsLoading}</p>}
                {selectedHotel && !roomsLoading && roomsError && <div className="text-xs text-destructive flex items-center gap-2">{c.roomsError}<Button type="button" variant="outline" size="sm" onClick={() => setRoomRetry(value => value + 1)}><RefreshCw className="h-3 w-3 mr-1" />{c.retry}</Button></div>}
                {selectedHotel && !roomsLoading && !roomsError && rooms.length === 0 && <p className="text-xs text-amber-700">{c.roomsEmpty}</p>}
              </div>
            </div>
            <div className="space-y-2"><Label>{c.title} *</Label><Input required value={formData.title} onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))} placeholder="e.g. Broken curtain rail" className="h-11" /></div>
            <div className="space-y-2"><Label>{c.description} *</Label><Textarea required value={formData.description} onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))} rows={4} className="text-base" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>{c.department}</Label><Select value={formData.department} onValueChange={department => { setFormData(prev => ({ ...prev, department })); setSelectedMaintenancePerson('auto'); }}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{departments.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>{c.priority}</Label><Select value={formData.priority} onValueChange={(priority: 'low' | 'medium' | 'high' | 'urgent') => setFormData(prev => ({ ...prev, priority }))}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent></Select></div>
            </div>
            {formData.department === 'maintenance' && <Card className="border-primary/20 bg-primary/5"><CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><UserCheck className="h-4 w-4 text-primary" /><Label>{c.assignee}</Label></div><Badge variant="outline">{onDutyCount} {c.onDuty}</Badge></div>
              <Select value={selectedMaintenancePerson} onValueChange={setSelectedMaintenancePerson} disabled={staffLoading || !selectedHotel}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">⚡ {c.auto}</SelectItem>{maintenanceStaff.map(person => <SelectItem key={person.id} value={person.id}>{person.full_name} · {person.is_signed_in ? c.onDuty : c.offDuty}</SelectItem>)}</SelectContent></Select>
              {!staffLoading && maintenanceStaff.length === 0 && <p className="text-xs text-amber-700">{c.none}</p>}
              {!staffLoading && maintenanceStaff.length > 0 && onDutyCount === 0 && <p className="text-xs text-amber-700 flex gap-1.5"><Clock3 className="h-3.5 w-3.5 mt-0.5 shrink-0" />{c.noDuty}</p>}
              <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{selectedHotel?.hotel_name || c.selectHotel}</div>
            </CardContent></Card>}
            <div className="space-y-2"><Label>{c.attachments}</Label><AttachmentUpload ref={attachmentRef} onAttachmentsChange={() => {}} maxFiles={5} /></div>
            <div className="grid grid-cols-2 gap-2 pt-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading} className="h-11">{c.cancel}</Button><Button type="submit" disabled={loading || !selectedHotel || !canCreateTickets} className="h-11">{loading ? c.creating : <><CheckCircle2 className="h-4 w-4 mr-2" />{c.submit}</>}</Button></div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
