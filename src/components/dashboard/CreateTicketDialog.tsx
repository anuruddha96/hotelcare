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
import { AttachmentUpload, type AttachmentUploadRef } from './AttachmentUpload';
import { MaintenanceRoomPicker } from './MaintenanceRoomPicker';
import { MaintenanceTitleAutocomplete } from './MaintenanceTitleAutocomplete';
import { type MaintenanceRoomOption, loadMaintenanceRoomOptions, validateMaintenanceRoomOption } from '@/lib/maintenanceRoomOptions';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { AlertTriangle, Building2, CheckCircle2, Clock3, UserCheck, Wrench } from 'lucide-react';

type MaintenanceStaff = { id: string; full_name: string; role: string; assigned_hotel: string | null; is_signed_in: boolean; checked_in_at: string | null };
interface CreateTicketDialogProps { open: boolean; onOpenChange: (open: boolean) => void; onTicketCreated: () => void; onOpenTicket?: (id: string) => void }
const copy = {
  en: {
    create: 'Report maintenance issue', intro: 'Report one issue for the selected property. Housekeeping and maintenance share the same ticket.',
    hotel: 'Hotel', room: 'Room', location: 'Common-area location', title: 'Issue title', description: 'What is wrong?',
    priority: 'Priority', department: 'Department', assignee: 'Maintenance assignee', auto: 'Auto-assign to on-duty maintenance',
    onDuty: 'On duty', offDuty: 'Not signed in', none: 'No maintenance staff configured for this hotel',
    noDuty: 'No maintenance member signed in. The ticket remains in the triage queue.',
    cancel: 'Cancel', submit: 'Report issue', creating: 'Creating…', selectHotel: 'Select hotel', optional: 'Optional',
    attachments: 'Attachments', success: 'Issue reported', assigned: 'Assigned to', queued: 'Queued for maintenance',
    error: 'Could not report issue', required: 'Complete the required fields', invalidRoom: 'Select an eligible room from this property.',
    permissionError: 'Ticket permissions could not be checked. Retry.', uploadWarning: 'Ticket saved, but attachments could not be uploaded.',
  },
  hu: {
    create: 'Karbantartási hiba jelentése', intro: 'Jelentsen egy hibát a kiválasztott hotelben. A takarítás és a karbantartás ugyanazt a jegyet használja.',
    hotel: 'Hotel', room: 'Szoba', location: 'Közös terület helye', title: 'Hiba címe', description: 'Mi a probléma?',
    priority: 'Prioritás', department: 'Részleg', assignee: 'Karbantartó', auto: 'Automatikus kiosztás a szolgálatban lévő karbantartónak',
    onDuty: 'Szolgálatban', offDuty: 'Nincs bejelentkezve', none: 'Ehhez a hotelhez nincs karbantartó beállítva',
    noDuty: 'Nincs bejelentkezett karbantartó. A jegy az ellenőrzési sorban marad.',
    cancel: 'Mégse', submit: 'Hiba jelentése', creating: 'Létrehozás…', selectHotel: 'Hotel kiválasztása', optional: 'Opcionális',
    attachments: 'Mellékletek', success: 'Hiba bejelentve', assigned: 'Hozzárendelve', queued: 'Karbantartási sorban',
    error: 'A jegy létrehozása sikertelen', required: 'Töltse ki a kötelező mezőket', invalidRoom: 'Válasszon egy elérhető szobát ebből a hotelből.',
    permissionError: 'Nem sikerült ellenőrizni a jegykezelési jogosultságot. Próbálja újra.', uploadWarning: 'A jegy mentve, de a mellékletek feltöltése sikertelen.',
  },
};
const departments = [ ['maintenance', 'Maintenance'], ['housekeeping', 'Housekeeping'], ['reception', 'Reception'], ['marketing', 'Marketing'], ['back_office', 'Back Office'], ['control', 'Control'], ['finance', 'Finance'], ['top_management', 'Top Management'] ] as const;
const initialForm = () => ({ title: '', description: '', location: '', roomId: null as string | null, priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent', department: 'maintenance', hotel: '' });

export function CreateTicketDialog({ open, onOpenChange, onTicketCreated, onOpenTicket }: CreateTicketDialogProps) {
  const { profile } = useAuth();
  const { hotels: tenantHotels } = useTenant();
  const { language } = useTranslation();
  const c = language === 'hu' ? copy.hu : copy.en;
  const attachmentRef = useRef<AttachmentUploadRef>(null);
  const submittingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [canCreateTickets, setCanCreateTickets] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [maintenanceStaff, setMaintenanceStaff] = useState<MaintenanceStaff[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [rooms, setRooms] = useState<MaintenanceRoomOption[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState(false);
  const [roomRetry, setRoomRetry] = useState(0);
  const [selectedMaintenancePerson, setSelectedMaintenancePerson] = useState('auto');
  const [formData, setFormData] = useState(initialForm);
  const canSelectAnyHotel = profile?.role === 'admin' || profile?.role === 'top_management' || profile?.role === 'top_management_manager' || profile?.is_super_admin;
  const availableHotels = useMemo(() => tenantHotels.filter(h => h.hotel_id !== 'all' && (canSelectAnyHotel || !profile?.assigned_hotel || h.hotel_id === profile.assigned_hotel || h.hotel_name === profile.assigned_hotel)), [tenantHotels, canSelectAnyHotel, profile?.assigned_hotel]);
  const selectedHotel = availableHotels.find(h => h.hotel_id === formData.hotel);
  const hotelKeys = selectedHotel ? [...new Set([selectedHotel.hotel_id, selectedHotel.hotel_name].filter(Boolean))] : [];
  const onDutyCount = maintenanceStaff.filter(s => s.is_signed_in).length;

  useEffect(() => {
    if (!open) return;
    const preferred = availableHotels.find(h => h.hotel_id === profile?.assigned_hotel || h.hotel_name === profile?.assigned_hotel);
    setFormData(previous => ({ ...previous, hotel: preferred?.hotel_id || (availableHotels.length === 1 ? availableHotels[0].hotel_id : ''), roomId: null }));
    setSelectedMaintenancePerson('auto');
  }, [open, profile?.assigned_hotel, availableHotels]);
  useEffect(() => {
    if (!open || !profile?.id) return;
    let cancelled = false;
    setCanCreateTickets(false); setPermissionError(false);
    void supabase.rpc('has_ticket_creation_permission', { _user_id: profile.id }).then(({ data, error }) => {
      if (cancelled) return;
      setPermissionError(!!error); setCanCreateTickets(!error && data !== false);
    });
    return () => { cancelled = true; };
  }, [open, profile?.id]);
  useEffect(() => {
    let cancelled = false;
    setRooms([]); setRoomsError(false);
    if (!open || !selectedHotel || !hotelKeys.length || !profile?.organization_slug) { setRoomsLoading(false); return; }
    setRoomsLoading(true);
    void loadMaintenanceRoomOptions(hotelKeys, profile.organization_slug).then(options => { if (!cancelled) setRooms(options); }).catch(error => {
      if (cancelled) return;
      console.error('Maintenance room lookup failed:', error); setRoomsError(true);
    }).finally(() => { if (!cancelled) setRoomsLoading(false); });
    return () => { cancelled = true; };
  }, [open, formData.hotel, roomRetry, profile?.organization_slug, tenantHotels]);
  useEffect(() => {
    let cancelled = false;
    setMaintenanceStaff([]);
    if (!open || formData.department !== 'maintenance' || !selectedHotel) { setStaffLoading(false); return; }
    setStaffLoading(true);
    void (supabase as any).rpc('get_maintenance_staff_for_hotel', { _hotel: selectedHotel.hotel_name, _signed_in_only: false })
      .then(({ data, error }: { data: MaintenanceStaff[] | null; error: Error | null }) => {
        if (cancelled) return;
        if (error) console.error('Failed to load hotel maintenance staff:', error);
        setMaintenanceStaff(error ? [] : data || []); setStaffLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, formData.hotel, formData.department, tenantHotels]);
  const reset = () => { setFormData(initialForm()); setSelectedMaintenancePerson('auto'); setRooms([]); };
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!profile?.id || !profile.organization_slug || !canCreateTickets || !selectedHotel || !formData.title.trim() || !formData.description.trim() || (!formData.roomId && !formData.location.trim())) {
      toast({ title: c.error, description: c.required, variant: 'destructive' }); return;
    }
    if (formData.roomId && (roomsLoading || roomsError || !rooms.some(room => room.id === formData.roomId))) {
      toast({ title: c.error, description: c.invalidRoom, variant: 'destructive' }); return;
    }
    if (selectedMaintenancePerson !== 'auto' && !maintenanceStaff.some(person => person.id === selectedMaintenancePerson)) {
      toast({ title: c.error, description: c.required, variant: 'destructive' }); return;
    }
    submittingRef.current = true; setLoading(true);
    let savedTicket: { id: string; assigned_to: string | null; hotel: string; ticket_number: string } | null = null;
    try {
      const room = formData.roomId ? await validateMaintenanceRoomOption(formData.roomId, hotelKeys, profile.organization_slug) : null;
      const manualAssignee = formData.department === 'maintenance' && selectedMaintenancePerson !== 'auto' ? selectedMaintenancePerson : null;
      const description = room ? formData.description.trim() : `Location: ${formData.location.trim()}\n${formData.description.trim()}`;
      const { data, error } = await (supabase as any).from('tickets').insert({
        title: formData.title.trim(), description, room_number: room?.roomNumber || 'N/A', source_room_id: room?.id || null,
        priority: formData.priority, department: formData.department, hotel: selectedHotel.hotel_name,
        created_by: profile.id, ticket_number: `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        attachment_urls: null, assigned_to: manualAssignee, organization_slug: profile.organization_slug,
        source: 'manual', assignment_method: manualAssignee ? 'manual' : null,
      }).select('id, assigned_to, hotel, ticket_number').single();
      if (error) throw error;
      savedTicket = data;
      if (attachmentRef.current?.hasAttachments()) {
        try {
          const uploadedPaths = await attachmentRef.current.uploadWithTicketId(data.id);
          if (uploadedPaths.length) {
            const { error: attachError } = await supabase.from('tickets').update({ attachment_urls: uploadedPaths }).eq('id', data.id).eq('organization_slug', profile.organization_slug).eq('hotel', selectedHotel.hotel_name);
            if (attachError) throw attachError;
          }
        } catch (attachmentError) {
          console.error('Ticket saved but attachment upload failed:', attachmentError);
          toast({ title: c.uploadWarning, variant: 'destructive' });
        }
      }
      if (data.assigned_to) {
        try {
          await supabase.functions.invoke('send-work-assignment-notification', { body: {
            staff_id: data.assigned_to, assignment_type: 'ticket', assignment_details: {
              id: data.id, title: formData.title.trim(), room_number: room?.roomNumber || formData.location.trim(), priority: formData.priority,
            }, hotel_name: selectedHotel.hotel_name,
          } });
        } catch (notificationError) { console.warn('Ticket saved; notification failed:', notificationError); }
      }
      const assigneeName = maintenanceStaff.find(person => person.id === data.assigned_to)?.full_name;
      toast({ title: `${c.success} · ${data.ticket_number}`, description: data.assigned_to ? `${c.assigned}: ${assigneeName || 'Maintenance'}` : c.queued,
        action: onOpenTicket && formData.department === 'maintenance' ? <ToastAction altText="Open issue" onClick={() => onOpenTicket(data.id)}>{language === 'hu' ? 'Hiba megnyitása' : 'Open issue'}</ToastAction> : undefined,
      });
      window.dispatchEvent(new CustomEvent('maintenance-ticket-created', { detail: data }));
      onTicketCreated(); reset(); onOpenChange(false);
    } catch (error: any) {
      console.error('Ticket creation failed:', error);
      if (savedTicket) {
        onTicketCreated(); reset(); onOpenChange(false); toast({ title: `${c.success} · ${savedTicket.ticket_number}`,
          action: onOpenTicket ? <ToastAction altText="Open issue" onClick={() => onOpenTicket(savedTicket!.id)}>{language === 'hu' ? 'Hiba megnyitása' : 'Open issue'}</ToastAction> : undefined,
        });
      } else { toast({ title: c.error, description: error?.message || c.error, variant: 'destructive' }); }
    } finally { submittingRef.current = false; setLoading(false); }
  };
  return <Dialog open={open} onOpenChange={next => { if (!loading) onOpenChange(next); }}>
    <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[94vh] overflow-y-auto p-4 sm:p-6">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-xl"><Wrench className="h-5 w-5 text-primary" />{c.create}</DialogTitle>
        <DialogDescription>{c.intro}</DialogDescription>
      </DialogHeader>
      {!canCreateTickets ? <Card><CardContent className="py-8 text-center text-muted-foreground"><AlertTriangle className="h-10 w-10 mx-auto mb-3" />{permissionError ? c.permissionError : c.required}</CardContent></Card> :
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label>{c.hotel} *</Label>
            <Select value={formData.hotel} onValueChange={hotel => {
              setRooms([]); setRoomsLoading(true); setRoomsError(false);
              setFormData(previous => ({ ...previous, hotel, roomId: null })); setSelectedMaintenancePerson('auto');
            }}><SelectTrigger className="h-11"><SelectValue placeholder={c.selectHotel} /></SelectTrigger>
              <SelectContent>{availableHotels.map(h => <SelectItem key={h.hotel_id} value={h.hotel_id}>{h.hotel_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>{c.room} <span className="text-muted-foreground text-xs">({c.optional})</span></Label>
            <MaintenanceRoomPicker key={formData.hotel} options={rooms} value={formData.roomId}
              onChange={roomId => setFormData(previous => ({ ...previous, roomId }))}
              disabled={!selectedHotel} loading={roomsLoading} error={roomsError}
              onRetry={() => setRoomRetry(value => value + 1)} optional language={language} />
          </div>
        </div>
        {!formData.roomId && <div className="space-y-2"><Label htmlFor="ticket-location">{c.location} *</Label>
          <Input id="ticket-location" required value={formData.location} onChange={event => setFormData(previous => ({ ...previous, location: event.target.value }))}
            placeholder={language === 'hu' ? 'pl. Recepció, 2. emeleti folyosó' : 'e.g. Reception, second-floor corridor'} className="h-11" />
        </div>}
        <div className="space-y-2"><Label>{c.title} *</Label>
          {selectedHotel?.hotel_name === 'Gozsdu Court Budapest' ?
            <MaintenanceTitleAutocomplete required value={formData.title} onChange={title => setFormData(previous => ({ ...previous, title }))} language={language} /> :
            <Input required value={formData.title} onChange={event => setFormData(previous => ({ ...previous, title: event.target.value }))} placeholder="e.g. Broken curtain rail" className="h-11" />}
        </div>
        <div className="space-y-2"><Label>{c.description} *</Label><Textarea required value={formData.description} onChange={event => setFormData(previous => ({ ...previous, description: event.target.value }))} rows={4} className="text-base" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label>{c.department}</Label>
            <Select value={formData.department} onValueChange={department => { setFormData(previous => ({ ...previous, department })); setSelectedMaintenancePerson('auto'); }}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{departments.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>{c.priority}</Label>
            <Select value={formData.priority} onValueChange={(priority: 'low' | 'medium' | 'high' | 'urgent') => setFormData(previous => ({ ...previous, priority }))}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        {formData.department === 'maintenance' && <Card className="border-primary/20 bg-primary/5"><CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><UserCheck className="h-4 w-4 text-primary" /><Label>{c.assignee}</Label></div><Badge variant="outline">{onDutyCount} {c.onDuty}</Badge></div>
          <Select value={selectedMaintenancePerson} onValueChange={setSelectedMaintenancePerson} disabled={staffLoading || !selectedHotel}>
            <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="auto">⚡ {c.auto}</SelectItem>{maintenanceStaff.map(person => <SelectItem key={person.id} value={person.id}>{person.full_name} · {person.is_signed_in ? c.onDuty : c.offDuty}</SelectItem>)}</SelectContent>
          </Select>
          {!staffLoading && maintenanceStaff.length === 0 && <p className="text-xs text-amber-700">{c.none}</p>}
          {!staffLoading && maintenanceStaff.length > 0 && onDutyCount === 0 && <p className="text-xs text-amber-700 flex gap-1.5"><Clock3 className="h-3.5 w-3.5 mt-0.5 shrink-0" />{c.noDuty}</p>}
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{selectedHotel?.hotel_name || c.selectHotel}</div>
        </CardContent></Card>}
        <div className="space-y-2"><Label>{c.attachments}</Label><AttachmentUpload ref={attachmentRef} onAttachmentsChange={() => {}} maxFiles={5} /></div>
        <div className="grid grid-cols-2 gap-2 pt-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading} className="h-11">{c.cancel}</Button>
          <Button type="submit" disabled={loading || roomsLoading || roomsError || !selectedHotel || !canCreateTickets} className="h-11">{loading ? c.creating : <><CheckCircle2 className="h-4 w-4 mr-2" />{c.submit}</>}</Button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
