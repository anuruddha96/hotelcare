import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AttachmentUpload, AttachmentUploadRef } from './AttachmentUpload';
import { toast } from '@/hooks/use-toast';
import { AlertTriangle, Building2, CheckCircle2, Clock3, UserCheck, Wrench } from 'lucide-react';

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketCreated: () => void;
}

type MaintenanceStaff = {
  id: string;
  full_name: string;
  role: string;
  assigned_hotel: string | null;
  is_signed_in: boolean;
  checked_in_at: string | null;
};

const copy: Record<string, Record<string, string>> = {
  en: {
    create: 'Create maintenance ticket', intro: 'Log an issue from reception or management. HotelCare will use the same maintenance workflow as housekeeping.',
    hotel: 'Hotel', room: 'Room', title: 'Issue title', description: 'What is wrong?', priority: 'Priority', department: 'Department', assignee: 'Maintenance assignee',
    auto: 'Auto-assign to today’s on-duty maintenance member', onDuty: 'On duty', offDuty: 'Not signed in', none: 'No maintenance staff configured for this hotel',
    noDuty: 'No maintenance member is currently signed in. Leave Auto-assign selected and the ticket will be picked up when maintenance checks in.',
    cancel: 'Cancel', submit: 'Create ticket', creating: 'Creating…', selectHotel: 'Select hotel', selectRoom: 'Select room', optional: 'Optional', attachments: 'Attachments',
    success: 'Maintenance ticket created', assigned: 'Assigned to', queued: 'Queued — no maintenance staff on duty', error: 'Could not create ticket', required: 'Please complete the required fields',
  },
  hu: {
    create: 'Karbantartási jegy létrehozása', intro: 'Rögzítsen hibát a recepcióról vagy a vezetőségtől. A HotelCare ugyanazt a karbantartási folyamatot használja, mint a takarítás.',
    hotel: 'Hotel', room: 'Szoba', title: 'Hiba címe', description: 'Mi a probléma?', priority: 'Prioritás', department: 'Részleg', assignee: 'Karbantartó',
    auto: 'Automatikus kiosztás a ma szolgálatban lévő karbantartónak', onDuty: 'Szolgálatban', offDuty: 'Nincs bejelentkezve', none: 'Ehhez a hotelhez nincs karbantartó beállítva',
    noDuty: 'Jelenleg nincs bejelentkezett karbantartó. Hagyja az automatikus kiosztást, és a jegy a karbantartó bejelentkezésekor kiosztásra kerül.',
    cancel: 'Mégse', submit: 'Jegy létrehozása', creating: 'Létrehozás…', selectHotel: 'Hotel kiválasztása', selectRoom: 'Szoba kiválasztása', optional: 'Opcionális', attachments: 'Mellékletek',
    success: 'Karbantartási jegy létrehozva', assigned: 'Hozzárendelve', queued: 'Sorban — nincs szolgálatban karbantartó', error: 'A jegy létrehozása sikertelen', required: 'Kérjük, töltse ki a kötelező mezőket',
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
  const hotels = tenantHotels.map(h => ({ id: h.hotel_id, name: h.hotel_name }));

  const [loading, setLoading] = useState(false);
  const [canCreateTickets, setCanCreateTickets] = useState(true);
  const [maintenanceStaff, setMaintenanceStaff] = useState<MaintenanceStaff[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [rooms, setRooms] = useState<{ room_number: string; hotel: string }[]>([]);
  const [selectedMaintenancePerson, setSelectedMaintenancePerson] = useState('auto');
  const [formData, setFormData] = useState({
    title: '', description: '', room_number: '', priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent', department: 'maintenance', hotel: '',
  });

  useEffect(() => {
    if (!open) return;
    const preferred = hotels.find(h => h.id === profile?.assigned_hotel || h.name === profile?.assigned_hotel);
    setFormData(prev => ({
      ...prev,
      hotel: preferred?.name || profile?.assigned_hotel || prev.hotel,
      department: prev.department || 'maintenance',
    }));
    setSelectedMaintenancePerson('auto');
  }, [open, profile?.assigned_hotel, tenantHotels]);

  useEffect(() => {
    const checkPermission = async () => {
      if (!open || !profile?.id) return;
      const { data, error } = await supabase.rpc('has_ticket_creation_permission', { _user_id: profile.id });
      if (!error) setCanCreateTickets(data !== false);
    };
    void checkPermission();
  }, [open, profile?.id]);

  useEffect(() => {
    const loadRooms = async () => {
      if (!formData.hotel) { setRooms([]); return; }
      const { data, error } = await supabase
        .from('rooms')
        .select('room_number, hotel')
        .eq('hotel', formData.hotel)
        .order('room_number');
      if (!error) { setRooms(data || []); return; }
      const { data: fallback } = await supabase
        .from('rooms')
        .select('room_number, hotel')
        .ilike('hotel', `%${formData.hotel}%`)
        .order('room_number');
      setRooms(fallback || []);
    };
    void loadRooms();
  }, [formData.hotel]);

  useEffect(() => {
    const loadMaintenanceStaff = async () => {
      if (formData.department !== 'maintenance' || !formData.hotel) {
        setMaintenanceStaff([]);
        return;
      }
      setStaffLoading(true);
      try {
        const { data, error } = await (supabase as any).rpc('get_maintenance_staff_for_hotel', {
          _hotel: formData.hotel,
          _signed_in_only: false,
        });
        if (error) throw error;
        setMaintenanceStaff((data || []) as MaintenanceStaff[]);
      } catch (error) {
        console.error('Failed to load maintenance staff:', error);
        setMaintenanceStaff([]);
      } finally {
        setStaffLoading(false);
      }
    };
    void loadMaintenanceStaff();
  }, [formData.department, formData.hotel]);

  const reset = () => {
    setFormData({ title: '', description: '', room_number: '', priority: 'medium', department: 'maintenance', hotel: profile?.assigned_hotel || '' });
    setSelectedMaintenancePerson('auto');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.id || !formData.hotel || !formData.department || !formData.title.trim() || !formData.description.trim()) {
      toast({ title: c.error, description: c.required, variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const manualAssignee = formData.department === 'maintenance' && selectedMaintenancePerson !== 'auto'
        ? selectedMaintenancePerson
        : null;

      const { data: ticketData, error: ticketError } = await (supabase as any)
        .from('tickets')
        .insert({
          title: formData.title.trim(),
          description: formData.description.trim(),
          room_number: formData.room_number || 'N/A',
          priority: formData.priority,
          department: formData.department,
          hotel: formData.hotel,
          created_by: profile.id,
          ticket_number: `TKT-${Date.now()}`,
          attachment_urls: null,
          assigned_to: manualAssignee,
          organization_slug: profile.organization_slug,
          source: 'manual',
          assignment_method: manualAssignee ? 'manual' : null,
        })
        .select('id, assigned_to, hotel, ticket_number, assignment_method')
        .single();
      if (ticketError) throw ticketError;

      if (attachmentRef.current?.hasAttachments()) {
        const uploadedPaths = await attachmentRef.current.uploadWithTicketId(ticketData.id);
        if (uploadedPaths.length) {
          await supabase.from('tickets').update({ attachment_urls: uploadedPaths }).eq('id', ticketData.id);
        }
      }

      if (ticketData.assigned_to) {
        try {
          await supabase.functions.invoke('send-work-assignment-notification', {
            body: {
              staff_id: ticketData.assigned_to,
              assignment_type: 'ticket',
              assignment_details: {
                id: ticketData.id,
                title: formData.title.trim(),
                room_number: formData.room_number || 'N/A',
                priority: formData.priority,
              },
              hotel_name: formData.hotel,
            }
          });
        } catch (notificationError) {
          console.warn('Assignment email failed:', notificationError);
        }
      }

      const assigneeName = maintenanceStaff.find(s => s.id === ticketData.assigned_to)?.full_name;
      toast({
        title: c.success,
        description: ticketData.assigned_to ? `${c.assigned}: ${assigneeName || 'Maintenance'}` : c.queued,
      });
      window.dispatchEvent(new CustomEvent('maintenance-ticket-created', { detail: ticketData }));
      onTicketCreated();
      reset();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Ticket creation error:', error);
      toast({ title: c.error, description: error?.message || c.error, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const canSelectAnyHotel = profile?.role === 'admin' || profile?.role === 'top_management' || profile?.role === 'top_management_manager';
  const availableHotels = canSelectAnyHotel
    ? hotels.filter(h => h.id !== 'all')
    : hotels.filter(h => h.id !== 'all' && (!profile?.assigned_hotel || h.id === profile.assigned_hotel || h.name === profile.assigned_hotel));
  const onDutyCount = maintenanceStaff.filter(s => s.is_signed_in).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[94vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Wrench className="h-5 w-5 text-primary" /> {c.create}
          </DialogTitle>
          <DialogDescription>{c.intro}</DialogDescription>
        </DialogHeader>

        {!canCreateTickets ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground"><AlertTriangle className="h-10 w-10 mx-auto mb-3" />No permission to create tickets.</CardContent></Card>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{c.hotel} *</Label>
                <Select value={formData.hotel} onValueChange={(hotel) => { setFormData(prev => ({ ...prev, hotel, room_number: '' })); setSelectedMaintenancePerson('auto'); }}>
                  <SelectTrigger className="h-11"><SelectValue placeholder={c.selectHotel} /></SelectTrigger>
                  <SelectContent>{availableHotels.map(h => <SelectItem key={h.id} value={h.name}>{h.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{c.room} <span className="text-muted-foreground text-xs">({c.optional})</span></Label>
                <Select value={formData.room_number || 'none'} onValueChange={(v) => setFormData(prev => ({ ...prev, room_number: v === 'none' ? '' : v }))}>
                  <SelectTrigger className="h-11"><SelectValue placeholder={c.selectRoom} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {rooms.map(r => <SelectItem key={r.room_number} value={r.room_number}>{r.room_number}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{c.title} *</Label>
              <Input value={formData.title} onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))} placeholder="e.g. Broken curtain rail" className="h-11" />
            </div>

            <div className="space-y-2">
              <Label>{c.description} *</Label>
              <Textarea value={formData.description} onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))} rows={4} className="text-base" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{c.department}</Label>
                <Select value={formData.department} onValueChange={(department) => { setFormData(prev => ({ ...prev, department })); setSelectedMaintenancePerson('auto'); }}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{departments.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{c.priority}</Label>
                <Select value={formData.priority} onValueChange={(priority: any) => setFormData(prev => ({ ...prev, priority }))}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.department === 'maintenance' && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><UserCheck className="h-4 w-4 text-primary" /><Label>{c.assignee}</Label></div>
                    <Badge variant="outline" className={onDutyCount ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}>
                      {onDutyCount} {c.onDuty}
                    </Badge>
                  </div>
                  <Select value={selectedMaintenancePerson} onValueChange={setSelectedMaintenancePerson} disabled={staffLoading}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">⚡ {c.auto}</SelectItem>
                      {maintenanceStaff.map(person => (
                        <SelectItem key={person.id} value={person.id}>
                          {person.full_name} · {person.is_signed_in ? c.onDuty : c.offDuty}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!staffLoading && maintenanceStaff.length === 0 && <p className="text-xs text-amber-700">{c.none}</p>}
                  {!staffLoading && maintenanceStaff.length > 0 && onDutyCount === 0 && <p className="text-xs text-amber-700 flex gap-1.5"><Clock3 className="h-3.5 w-3.5 mt-0.5 shrink-0" />{c.noDuty}</p>}
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{formData.hotel || c.selectHotel}</div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <Label>{c.attachments}</Label>
              <AttachmentUpload ref={attachmentRef} onAttachmentsChange={() => {}} maxFiles={5} />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading} className="h-11">{c.cancel}</Button>
              <Button type="submit" disabled={loading} className="h-11">
                {loading ? c.creating : <><CheckCircle2 className="h-4 w-4 mr-2" />{c.submit}</>}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
