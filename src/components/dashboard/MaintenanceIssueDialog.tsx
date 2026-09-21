import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Camera, Upload, X, CheckCircle, Wrench, Send, UserCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { MaintenanceRoomPicker } from './MaintenanceRoomPicker';
import { type MaintenanceRoomOption, loadMaintenanceRoomOptions, validateMaintenanceRoomOption } from '@/lib/maintenanceRoomOptions';
import { toast } from 'sonner';

interface MaintenanceIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  roomId: string | null;
  assignmentId?: string;
  onIssueReported?: () => void;
}

type UiCopy = {
  subtitle: string; directRoute: string; assignmentInfo: string; assignedTo: string;
  noOnDuty: string; noOnDutyDetail: string; ticketCreated: string; reportFailed: string;
  descriptionRequired: string; selectRoomRequired: string; photoAdded: string; photoCaptured: string;
};
const copyByLanguage: Record<string, UiCopy> = {
  en: {
    subtitle: 'Report the problem once. HotelCare forwards it to maintenance automatically.',
    directRoute: 'Direct maintenance escalation', assignmentInfo: 'An on-duty maintenance member is assigned automatically when available.',
    assignedTo: 'Assigned to', noOnDuty: 'No maintenance member is signed in right now',
    noOnDutyDetail: 'The ticket stays in the maintenance queue for supervisors and the next available team member.',
    ticketCreated: 'Maintenance ticket created', reportFailed: 'Failed to report maintenance issue',
    descriptionRequired: 'Please describe the problem', selectRoomRequired: 'Please select an eligible room',
    photoAdded: 'photo(s) added', photoCaptured: 'Photo captured',
  },
  hu: {
    subtitle: 'A hibát csak egyszer jelentse. A HotelCare automatikusan továbbítja a karbantartási sorba.',
    directRoute: 'Közvetlen karbantartási továbbítás', assignmentInfo: 'Ha van szolgálatban lévő karbantartó, a jegyet automatikusan hozzárendeljük.',
    assignedTo: 'Hozzárendelve', noOnDuty: 'Jelenleg nincs bejelentkezett karbantartó',
    noOnDutyDetail: 'A jegy látható marad a felügyelők és a következő elérhető karbantartó számára.',
    ticketCreated: 'Karbantartási jegy létrehozva', reportFailed: 'A karbantartási hiba jelentése sikertelen',
    descriptionRequired: 'Kérjük, írja le a problémát', selectRoomRequired: 'Válasszon elérhető szobát',
    photoAdded: 'fotó hozzáadva', photoCaptured: 'Fotó elkészült',
  },
  es: {
    subtitle: 'Informe el problema una sola vez. HotelCare lo envía automáticamente a mantenimiento.',
    directRoute: 'Escalación directa a mantenimiento', assignmentInfo: 'Si hay un técnico disponible, se le asignará el ticket automáticamente.',
    assignedTo: 'Asignado a', noOnDuty: 'No hay personal de mantenimiento conectado ahora',
    noOnDutyDetail: 'El ticket permanece visible para los supervisores.', ticketCreated: 'Ticket de mantenimiento creado',
    reportFailed: 'No se pudo informar el problema', descriptionRequired: 'Describa el problema',
    selectRoomRequired: 'Seleccione una habitación disponible', photoAdded: 'foto(s) añadida(s)', photoCaptured: 'Foto capturada',
  },
  vi: {
    subtitle: 'Chỉ cần báo lỗi một lần. HotelCare sẽ tự động chuyển vào hàng đợi bảo trì.',
    directRoute: 'Chuyển trực tiếp đến bảo trì', assignmentInfo: 'Phiếu được tự động giao cho nhân viên bảo trì đang trực khi có thể.',
    assignedTo: 'Đã giao cho', noOnDuty: 'Hiện chưa có nhân viên bảo trì đăng nhập',
    noOnDutyDetail: 'Phiếu vẫn hiển thị cho giám sát.', ticketCreated: 'Đã tạo phiếu bảo trì',
    reportFailed: 'Không thể báo sự cố bảo trì', descriptionRequired: 'Vui lòng mô tả sự cố',
    selectRoomRequired: 'Vui lòng chọn phòng hợp lệ', photoAdded: 'ảnh đã thêm', photoCaptured: 'Đã chụp ảnh',
  },
  mn: {
    subtitle: 'Асуудлыг нэг удаа мэдээлнэ. HotelCare автоматаар засвар үйлчилгээний дараалалд шилжүүлнэ.',
    directRoute: 'Засвар үйлчилгээ рүү шууд шилжүүлэх', assignmentInfo: 'Боломжтой үед тасалбар автоматаар засварын ажилтанд хуваарилагдана.',
    assignedTo: 'Хуваарилсан', noOnDuty: 'Одоогоор засварын ажилтан нэвтрээгүй байна',
    noOnDutyDetail: 'Тасалбар хянагчдад харагдах болно.', ticketCreated: 'Засварын тасалбар үүслээ',
    reportFailed: 'Засварын асуудлыг мэдээлж чадсангүй', descriptionRequired: 'Асуудлыг тайлбарлана уу',
    selectRoomRequired: 'Боломжтой өрөө сонгоно уу', photoAdded: 'зураг нэмэгдлээ', photoCaptured: 'Зураг авлаа',
  },
  az: {
    subtitle: 'Problemi bir dəfə bildirin. HotelCare onu avtomatik texniki xidmət növbəsinə göndərir.',
    directRoute: 'Birbaşa texniki xidmətə yönləndirmə', assignmentInfo: 'Mümkün olduqda tapşırıq avtomatik texniki işçiyə təyin olunur.',
    assignedTo: 'Təyin edildi', noOnDuty: 'Hazırda giriş etmiş texniki işçi yoxdur',
    noOnDutyDetail: 'Tapşırıq nəzarətçilərə görünəcək.', ticketCreated: 'Texniki xidmət tapşırığı yaradıldı',
    reportFailed: 'Texniki problemi bildirmək mümkün olmadı', descriptionRequired: 'Problemi təsvir edin',
    selectRoomRequired: 'Mövcud otaq seçin', photoAdded: 'şəkil əlavə edildi', photoCaptured: 'Şəkil çəkildi',
  },
  tl: {
    subtitle: 'I-report ang problema nang isang beses. Awtomatikong ipapadala ito sa maintenance queue.',
    directRoute: 'Direktang maintenance escalation', assignmentInfo: 'Awtomatikong ia-assign sa available na maintenance staff.',
    assignedTo: 'Naka-assign kay', noOnDuty: 'Walang maintenance staff na naka-sign in ngayon',
    noOnDutyDetail: 'Mananatiling nakikita ng supervisors ang ticket.', ticketCreated: 'Nagawa ang maintenance ticket',
    reportFailed: 'Hindi na-report ang maintenance issue', descriptionRequired: 'Pakilarawan ang problema',
    selectRoomRequired: 'Pumili ng available na kuwarto', photoAdded: 'larawan ang idinagdag', photoCaptured: 'Nakuha ang larawan',
  },
  uk: {
    subtitle: 'Повідомте про проблему один раз. HotelCare автоматично передасть її в чергу технічного обслуговування.',
    directRoute: 'Пряма передача в технічну службу', assignmentInfo: 'За наявності працівника заявку буде автоматично призначено.',
    assignedTo: 'Призначено', noOnDuty: 'Зараз немає працівника технічної служби',
    noOnDutyDetail: 'Заявка залишиться видимою керівникам.', ticketCreated: 'Заявку на ремонт створено',
    reportFailed: 'Не вдалося повідомити про проблему', descriptionRequired: 'Опишіть проблему',
    selectRoomRequired: 'Виберіть доступну кімнату', photoAdded: 'фото додано', photoCaptured: 'Фото зроблено',
  },
  ru: {
    subtitle: 'Сообщите о проблеме один раз. HotelCare автоматически передаст её в очередь технической службы.',
    directRoute: 'Прямая передача в техническую службу', assignmentInfo: 'При наличии сотрудника заявка назначается автоматически.',
    assignedTo: 'Назначено', noOnDuty: 'Сейчас нет вошедшего сотрудника технической службы',
    noOnDutyDetail: 'Заявка останется видимой руководителям.', ticketCreated: 'Заявка на ремонт создана',
    reportFailed: 'Не удалось сообщить о проблеме', descriptionRequired: 'Опишите проблему',
    selectRoomRequired: 'Выберите доступную комнату', photoAdded: 'фото добавлено', photoCaptured: 'Фото сделано',
  },
};

export function MaintenanceIssueDialog({ open, onOpenChange, roomNumber, roomId: initialRoomId, assignmentId, onIssueReported }: MaintenanceIssueDialogProps) {
  const { user, profile } = useAuth();
  const { hotels: tenantHotels } = useTenant();
  const { t, language } = useTranslation();
  const ui = copyByLanguage[language] || copyByLanguage.en;
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [photos, setPhotos] = useState<{ dataUrl: string; blob: Blob }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const submittingRef = useRef(false);
  const [showCamera, setShowCamera] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [rooms, setRooms] = useState<MaintenanceRoomOption[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState(false);
  const [roomRetry, setRoomRetry] = useState(0);
  const [selectedHotelId, setSelectedHotelId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId);
  const [initialRoomInvalid, setInitialRoomInvalid] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSelectAnyHotel = profile?.role === 'admin' || profile?.role === 'top_management' || profile?.role === 'top_management_manager' || profile?.is_super_admin;
  const availableHotels = useMemo(() => tenantHotels.filter(h => h.hotel_id !== 'all' && (
    canSelectAnyHotel || !profile?.assigned_hotel || h.hotel_id === profile.assigned_hotel || h.hotel_name === profile.assigned_hotel
  )), [tenantHotels, canSelectAnyHotel, profile?.assigned_hotel]);
  const selectedHotel = availableHotels.find(h => h.hotel_id === selectedHotelId);
  const hotelKeys = selectedHotel ? [...new Set([selectedHotel.hotel_id, selectedHotel.hotel_name].filter(Boolean))] : [];

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInitialRoomInvalid(false);
    setRooms([]);
    setSelectedRoomId(initialRoomId);
    const preferred = availableHotels.find(h => h.hotel_id === profile?.assigned_hotel || h.hotel_name === profile?.assigned_hotel);
    if (!initialRoomId) {
      setSelectedHotelId(preferred?.hotel_id || (availableHotels.length === 1 ? availableHotels[0].hotel_id : ''));
      return;
    }
    setSelectedHotelId('');
    // Room-chip entry points must resolve their actual hotel, not assume a
    // top manager's currently selected hotel or trust a caller's room label.
    void supabase.from('rooms').select('id,hotel').eq('id', initialRoomId)
      .eq('organization_slug', profile?.organization_slug || '').maybeSingle().then(({ data, error }) => {
        if (cancelled) return;
        const hotel = availableHotels.find(h => h.hotel_id === data?.hotel || h.hotel_name === data?.hotel);
        if (error || !hotel) { setInitialRoomInvalid(true); return; }
        setSelectedHotelId(hotel.hotel_id);
      });
    return () => { cancelled = true; };
  }, [open, initialRoomId, profile?.organization_slug, profile?.assigned_hotel, availableHotels]);

  useEffect(() => {
    let cancelled = false;
    setRooms([]);
    setRoomsError(false);
    if (!open || !selectedHotel || !hotelKeys.length || !profile?.organization_slug) { setRoomsLoading(false); return; }
    setRoomsLoading(true);
    void loadMaintenanceRoomOptions(hotelKeys, profile.organization_slug).then(options => {
      if (cancelled) return;
      setRooms(options);
      if (initialRoomId && !options.some(room => room.id === initialRoomId)) setInitialRoomInvalid(true);
    }).catch(error => {
      if (cancelled) return;
      console.error('Housekeeping maintenance room lookup failed:', error);
      setRoomsError(true);
    }).finally(() => { if (!cancelled) setRoomsLoading(false); });
    return () => { cancelled = true; };
  }, [open, selectedHotelId, roomRetry, profile?.organization_slug, tenantHotels, initialRoomId]);

  const startCamera = useCallback(async () => {
    try {
      setShowCamera(true);
      setIsCameraLoading(true);
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(console.error);
          setIsCameraLoading(false);
        };
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      toast.error(t('photoCapture.cameraAccessError'));
      setShowCamera(false);
      setIsCameraLoading(false);
    }
  }, [t]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setShowCamera(false);
    setIsCameraLoading(false);
  }, []);

  useEffect(() => () => { streamRef.current?.getTracks().forEach(track => track.stop()); }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    context.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      setPhotos(previous => [...previous, { dataUrl: URL.createObjectURL(blob), blob }]);
      toast.success(ui.photoCaptured);
      stopCamera();
    }, 'image/jpeg', 0.9);
  }, [stopCamera, ui.photoCaptured]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    setPhotos(previous => [...previous, ...imageFiles.map(file => ({ dataUrl: URL.createObjectURL(file), blob: file }))]);
    if (imageFiles.length) toast.success(`${imageFiles.length} ${ui.photoAdded}`);
    event.target.value = '';
  };

  const handleClose = () => {
    if (submittingRef.current) return;
    stopCamera();
    setDescription('');
    setPriority('medium');
    photos.forEach(photo => URL.revokeObjectURL(photo.dataUrl));
    setPhotos([]);
    setSelectedRoomId(initialRoomId);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!user || !profile?.organization_slug || !description.trim()) { toast.error(ui.descriptionRequired); return; }
    const roomId = initialRoomId || selectedRoomId;
    if (!roomId || !selectedHotel || initialRoomInvalid || roomsLoading || roomsError || !rooms.some(room => room.id === roomId)) {
      toast.error(ui.selectRoomRequired); return;
    }
    submittingRef.current = true;
    setIsUploading(true);
    let ticketSaved = false;
    try {
      const selected = await validateMaintenanceRoomOption(roomId, hotelKeys, profile.organization_slug);
      const uploadedUrls: string[] = [];
      let photoUploadFailed = false;
      for (const photo of photos) {
        try {
          const fileName = `${user.id}/${selected.id}/maintenance_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
          const { data, error } = await supabase.storage.from('room-photos')
            .upload(fileName, photo.blob, { contentType: photo.blob.type || 'image/jpeg', cacheControl: '3600', upsert: false });
          if (error) throw error;
          const { data: { publicUrl } } = supabase.storage.from('room-photos').getPublicUrl(data.path);
          uploadedUrls.push(publicUrl);
        } catch (error) { console.error('Optional maintenance photo upload failed:', error); photoUploadFailed = true; }
      }
      const { data, error } = await (supabase as any).rpc('create_housekeeping_maintenance_ticket', {
        _room_id: selected.id, _assignment_id: assignmentId || null,
        _description: description.trim(), _priority: priority, _photo_urls: uploadedUrls,
      });
      if (error) throw error;
      ticketSaved = true;
      const ticket = Array.isArray(data) ? data[0] : data;
      if (ticket?.assigned_to) {
        try {
          await supabase.functions.invoke('send-work-assignment-notification', {
            body: { staff_id: ticket.assigned_to, assignment_type: 'ticket', assignment_details: {
              id: ticket.id, title: description.trim().slice(0, 80), room_number: selected.label, priority,
            }, hotel_name: ticket.hotel },
          });
        } catch (notificationError) { console.warn('Maintenance assignment notification failed:', notificationError); }
        toast.success(`${ui.ticketCreated} · ${ticket.ticket_number || ''} · ${ui.assignedTo}: ${ticket.assignee_name || 'Maintenance'}`);
      } else {
        toast.success(`${ui.ticketCreated} · ${ticket?.ticket_number || ''}. ${ui.noOnDutyDetail}`);
      }
      if (photoUploadFailed) toast.warning(language === 'hu' ? 'A jegy mentve, de néhány fotó feltöltése sikertelen.' : 'Ticket saved, but some photos could not be uploaded.');
      window.dispatchEvent(new CustomEvent('maintenance-ticket-created', { detail: {
        ticketId: ticket?.id, hotel: ticket?.hotel, assignedTo: ticket?.assigned_to || null,
      } }));
      onIssueReported?.();
      submittingRef.current = false;
      handleClose();
    } catch (error: any) {
      console.error('Error reporting maintenance issue:', error);
      if (!ticketSaved) toast.error(`${ui.reportFailed}: ${error?.message || t('common.error')}`);
      else { toast.success(ui.ticketCreated); submittingRef.current = false; handleClose(); }
    } finally { submittingRef.current = false; setIsUploading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) handleClose(); else onOpenChange(next); }}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl"><Wrench className="h-5 w-5 text-primary" />
            {t('maintenance.reportIssue')} {initialRoomId ? `· ${t('common.room')} ${roomNumber}` : ''}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{ui.subtitle}</p>
        </DialogHeader>
        <Card className="border-primary/20 bg-primary/5"><CardContent className="p-3 flex items-start gap-3">
          <Send className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="space-y-1"><div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{ui.directRoute}</span><Badge variant="outline" className="text-[10px] bg-background">HotelCare</Badge>
          </div><p className="text-xs text-muted-foreground">{ui.assignmentInfo}</p></div>
        </CardContent></Card>
        <div className="space-y-4">
          {!initialRoomId && availableHotels.length > 1 && <div className="space-y-2"><Label>{language === 'hu' ? 'Hotel' : 'Hotel'} *</Label>
            <Select value={selectedHotelId} onValueChange={hotel => { setSelectedRoomId(null); setRooms([]); setRoomsLoading(true); setSelectedHotelId(hotel); }}>
              <SelectTrigger className="h-11"><SelectValue placeholder={language === 'hu' ? 'Hotel kiválasztása' : 'Select hotel'} /></SelectTrigger>
              <SelectContent>{availableHotels.map(h => <SelectItem key={h.hotel_id} value={h.hotel_id}>{h.hotel_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>}
          {initialRoomInvalid && <p role="alert" className="text-sm text-destructive">{ui.selectRoomRequired}. {language === 'hu' ? 'Frissítse a szobalistát.' : 'Refresh the room list.'}</p>}
          {!initialRoomId && <div className="space-y-2"><Label>{t('maintenance.selectRoom')} *</Label>
            <MaintenanceRoomPicker key={selectedHotelId} options={rooms} value={selectedRoomId} onChange={setSelectedRoomId}
              disabled={!selectedHotel} loading={roomsLoading} error={roomsError} onRetry={() => setRoomRetry(value => value + 1)} language={language} />
          </div>}
          {initialRoomId && !initialRoomInvalid && <div className="text-sm rounded-md border p-2.5">{t('common.room')}: {rooms.find(room => room.id === initialRoomId)?.label || roomNumber}</div>}
          <div className="space-y-2"><Label htmlFor="description">{t('maintenance.issueDescription')} *</Label>
            <Textarea id="description" placeholder={t('maintenance.issuePlaceholder')} value={description}
              onChange={event => setDescription(event.target.value)} rows={4} className="min-h-28 text-base" />
          </div>
          <div className="space-y-2"><Label>{t('maintenance.priority')}</Label>
            <Select value={priority} onValueChange={(value: 'low' | 'medium' | 'high' | 'urgent') => setPriority(value)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="low">{t('priority.low')}</SelectItem><SelectItem value="medium">{t('priority.medium')}</SelectItem>
                <SelectItem value="high">{t('priority.high')}</SelectItem><SelectItem value="urgent">{t('priority.urgent')}</SelectItem></SelectContent>
            </Select>
          </div>
          {!showCamera ? <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={startCamera} variant="outline" className="h-11"><Camera className="h-4 w-4 mr-2" />{t('common.takePhoto')}</Button>
            <Button type="button" onClick={() => fileInputRef.current?.click()} variant="outline" className="h-11"><Upload className="h-4 w-4 mr-2" />{t('common.uploadPhoto')}</Button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileUpload} className="hidden" />
          </div> : <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              {isCameraLoading && <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 text-white"><Camera className="h-8 w-8 animate-pulse" /></div>}
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div><div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={capturePhoto} disabled={isCameraLoading}><Camera className="h-4 w-4 mr-2" />{t('common.capture')}</Button>
              <Button type="button" onClick={stopCamera} variant="outline">{t('common.cancel')}</Button>
            </div>
          </div>}
          <canvas ref={canvasRef} className="hidden" />
          {photos.length > 0 && <div className="space-y-2"><Label>{t('common.photos')} ({photos.length})</Label>
            <div className="grid grid-cols-3 gap-2">{photos.map((photo, index) => <Card key={photo.dataUrl} className="relative overflow-hidden">
              <img src={photo.dataUrl} alt={`Maintenance ${index + 1}`} className="w-full h-24 object-cover" />
              <Button type="button" size="icon" variant="destructive" aria-label="Remove photo" className="absolute top-1 right-1 h-7 w-7" onClick={() => {
                URL.revokeObjectURL(photo.dataUrl);
                setPhotos(previous => previous.filter((_, i) => i !== index));
              }}><X className="h-3.5 w-3.5" /></Button>
            </Card>)}</div>
          </div>}
          <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg bg-muted/40 p-2.5"><UserCheck className="h-4 w-4 shrink-0" /><span>{ui.assignmentInfo}</span></div>
          <div className="grid grid-cols-2 gap-2 pt-1"><Button type="button" onClick={handleClose} variant="outline" className="h-11" disabled={isUploading}>{t('common.cancel')}</Button>
            <Button type="button" onClick={handleSubmit} disabled={isUploading || initialRoomInvalid || roomsLoading || roomsError || !selectedHotel || !(initialRoomId || selectedRoomId) || !description.trim()} className="h-11">
              {isUploading ? t('maintenance.reporting') : <><CheckCircle className="h-4 w-4 mr-2" />{t('maintenance.reportIssue')}</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
