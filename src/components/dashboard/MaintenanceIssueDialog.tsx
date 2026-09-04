import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Camera, Upload, X, AlertTriangle, CheckCircle, Wrench, Send, UserCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
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
  subtitle: string;
  directRoute: string;
  assignmentInfo: string;
  assignedTo: string;
  noOnDuty: string;
  noOnDutyDetail: string;
  ticketCreated: string;
  reportFailed: string;
  descriptionRequired: string;
  selectRoomRequired: string;
  photoAdded: string;
  photoCaptured: string;
};

const copyByLanguage: Record<string, UiCopy> = {
  en: {
    subtitle: 'Report the problem once. HotelCare forwards it to the maintenance queue automatically.',
    directRoute: 'Direct maintenance escalation',
    assignmentInfo: 'If a maintenance member is signed in at this hotel today, the ticket is assigned automatically.',
    assignedTo: 'Assigned to',
    noOnDuty: 'No maintenance member is signed in right now',
    noOnDutyDetail: 'The ticket stays visible to supervisors and will be picked up automatically when maintenance checks in.',
    ticketCreated: 'Maintenance ticket created',
    reportFailed: 'Failed to report maintenance issue',
    descriptionRequired: 'Please describe the problem',
    selectRoomRequired: 'Please select a room',
    photoAdded: 'photo(s) added',
    photoCaptured: 'Photo captured',
  },
  hu: {
    subtitle: 'A hibát csak egyszer jelentse. A HotelCare automatikusan továbbítja a karbantartási sorba.',
    directRoute: 'Közvetlen karbantartási továbbítás',
    assignmentInfo: 'Ha ma van bejelentkezett karbantartó ebben a hotelben, a jegy automatikusan hozzá kerül.',
    assignedTo: 'Hozzárendelve',
    noOnDuty: 'Jelenleg nincs bejelentkezett karbantartó',
    noOnDutyDetail: 'A jegy látható marad a felügyelőknek, és automatikusan kiosztásra kerül, amikor a karbantartó bejelentkezik.',
    ticketCreated: 'Karbantartási jegy létrehozva',
    reportFailed: 'A karbantartási hiba jelentése sikertelen',
    descriptionRequired: 'Kérjük, írja le a problémát',
    selectRoomRequired: 'Kérjük, válasszon szobát',
    photoAdded: 'fotó hozzáadva',
    photoCaptured: 'Fotó elkészült',
  },
  es: {
    subtitle: 'Informe el problema una sola vez. HotelCare lo envía automáticamente a mantenimiento.',
    directRoute: 'Escalación directa a mantenimiento',
    assignmentInfo: 'Si hoy hay un técnico conectado en este hotel, el ticket se asigna automáticamente.',
    assignedTo: 'Asignado a',
    noOnDuty: 'No hay personal de mantenimiento conectado ahora',
    noOnDutyDetail: 'El ticket seguirá visible para los supervisores y se asignará automáticamente cuando mantenimiento inicie sesión.',
    ticketCreated: 'Ticket de mantenimiento creado',
    reportFailed: 'No se pudo informar el problema',
    descriptionRequired: 'Describa el problema',
    selectRoomRequired: 'Seleccione una habitación',
    photoAdded: 'foto(s) añadida(s)',
    photoCaptured: 'Foto capturada',
  },
  vi: {
    subtitle: 'Chỉ cần báo lỗi một lần. HotelCare sẽ tự động chuyển vào hàng đợi bảo trì.',
    directRoute: 'Chuyển trực tiếp đến bảo trì',
    assignmentInfo: 'Nếu hôm nay có nhân viên bảo trì đã đăng nhập tại khách sạn này, phiếu sẽ được tự động giao.',
    assignedTo: 'Đã giao cho',
    noOnDuty: 'Hiện chưa có nhân viên bảo trì đăng nhập',
    noOnDutyDetail: 'Phiếu vẫn hiển thị cho giám sát và sẽ tự động được giao khi nhân viên bảo trì đăng nhập.',
    ticketCreated: 'Đã tạo phiếu bảo trì',
    reportFailed: 'Không thể báo sự cố bảo trì',
    descriptionRequired: 'Vui lòng mô tả sự cố',
    selectRoomRequired: 'Vui lòng chọn phòng',
    photoAdded: 'ảnh đã thêm',
    photoCaptured: 'Đã chụp ảnh',
  },
  mn: {
    subtitle: 'Асуудлыг нэг удаа мэдээлнэ. HotelCare автоматаар засвар үйлчилгээний дараалалд шилжүүлнэ.',
    directRoute: 'Засвар үйлчилгээ рүү шууд шилжүүлэх',
    assignmentInfo: 'Өнөөдөр энэ зочид буудалд засварын ажилтан нэвтэрсэн бол тасалбар автоматаар хуваарилагдана.',
    assignedTo: 'Хуваарилсан',
    noOnDuty: 'Одоогоор засварын ажилтан нэвтрээгүй байна',
    noOnDutyDetail: 'Тасалбар хянагчдад харагдана. Засварын ажилтан нэвтрэхэд автоматаар хуваарилагдана.',
    ticketCreated: 'Засварын тасалбар үүслээ',
    reportFailed: 'Засварын асуудлыг мэдээлж чадсангүй',
    descriptionRequired: 'Асуудлыг тайлбарлана уу',
    selectRoomRequired: 'Өрөө сонгоно уу',
    photoAdded: 'зураг нэмэгдлээ',
    photoCaptured: 'Зураг авлаа',
  },
  az: {
    subtitle: 'Problemi bir dəfə bildirin. HotelCare onu avtomatik texniki xidmət növbəsinə göndərir.',
    directRoute: 'Birbaşa texniki xidmətə yönləndirmə',
    assignmentInfo: 'Bu gün bu oteldə texniki işçi giriş edibsə, tapşırıq avtomatik ona təyin olunur.',
    assignedTo: 'Təyin edildi',
    noOnDuty: 'Hazırda giriş etmiş texniki işçi yoxdur',
    noOnDutyDetail: 'Tapşırıq nəzarətçilərə görünəcək və texniki işçi giriş etdikdə avtomatik təyin olunacaq.',
    ticketCreated: 'Texniki xidmət tapşırığı yaradıldı',
    reportFailed: 'Texniki problemi bildirmək mümkün olmadı',
    descriptionRequired: 'Problemi təsvir edin',
    selectRoomRequired: 'Otaq seçin',
    photoAdded: 'şəkil əlavə edildi',
    photoCaptured: 'Şəkil çəkildi',
  },
  tl: {
    subtitle: 'I-report ang problema nang isang beses. Awtomatikong ipapadala ito ng HotelCare sa maintenance queue.',
    directRoute: 'Direktang maintenance escalation',
    assignmentInfo: 'Kung may maintenance staff na naka-sign in sa hotel ngayon, awtomatikong ia-assign ang ticket.',
    assignedTo: 'Naka-assign kay',
    noOnDuty: 'Walang maintenance staff na naka-sign in ngayon',
    noOnDutyDetail: 'Makikita pa rin ng mga supervisor ang ticket at awtomatikong maa-assign kapag nag-sign in ang maintenance.',
    ticketCreated: 'Nagawa ang maintenance ticket',
    reportFailed: 'Hindi na-report ang maintenance issue',
    descriptionRequired: 'Pakilarawan ang problema',
    selectRoomRequired: 'Pumili ng kuwarto',
    photoAdded: 'larawan ang idinagdag',
    photoCaptured: 'Nakuha ang larawan',
  },
  uk: {
    subtitle: 'Повідомте про проблему один раз. HotelCare автоматично передасть її в чергу технічного обслуговування.',
    directRoute: 'Пряма передача в технічну службу',
    assignmentInfo: 'Якщо сьогодні в цьому готелі увійшов технічний працівник, заявка буде призначена автоматично.',
    assignedTo: 'Призначено',
    noOnDuty: 'Зараз немає технічного працівника, який увійшов у систему',
    noOnDutyDetail: 'Заявка залишиться видимою керівникам і буде автоматично призначена після входу технічного працівника.',
    ticketCreated: 'Заявку на ремонт створено',
    reportFailed: 'Не вдалося повідомити про проблему',
    descriptionRequired: 'Опишіть проблему',
    selectRoomRequired: 'Виберіть кімнату',
    photoAdded: 'фото додано',
    photoCaptured: 'Фото зроблено',
  },
  ru: {
    subtitle: 'Сообщите о проблеме один раз. HotelCare автоматически передаст её в очередь технической службы.',
    directRoute: 'Прямая передача в техническую службу',
    assignmentInfo: 'Если сегодня в этом отеле вошёл сотрудник технической службы, заявка назначится автоматически.',
    assignedTo: 'Назначено',
    noOnDuty: 'Сейчас нет вошедшего сотрудника технической службы',
    noOnDutyDetail: 'Заявка останется видимой руководителям и автоматически назначится после входа сотрудника технической службы.',
    ticketCreated: 'Заявка на ремонт создана',
    reportFailed: 'Не удалось сообщить о проблеме',
    descriptionRequired: 'Опишите проблему',
    selectRoomRequired: 'Выберите комнату',
    photoAdded: 'фото добавлено',
    photoCaptured: 'Фото сделано',
  },
};

export function MaintenanceIssueDialog({
  open,
  onOpenChange,
  roomNumber,
  roomId: initialRoomId,
  assignmentId,
  onIssueReported
}: MaintenanceIssueDialogProps) {
  const { user, profile } = useAuth();
  const { t, language } = useTranslation();
  const ui = copyByLanguage[language] || copyByLanguage.en;
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [photos, setPhotos] = useState<{ dataUrl: string; blob: Blob }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [rooms, setRooms] = useState<Array<{ id: string; room_number: string; hotel: string }>>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!initialRoomId) fetchRooms();
    else setSelectedRoomId(initialRoomId);
  }, [open, initialRoomId]);

  const fetchRooms = async () => {
    try {
      let query = supabase.from('rooms').select('id, room_number, hotel');
      if (profile?.assigned_hotel) {
        const { data: hotelConfig } = await supabase
          .from('hotel_configurations')
          .select('hotel_name')
          .eq('hotel_id', profile.assigned_hotel)
          .maybeSingle();
        const hotelName = hotelConfig?.hotel_name || profile.assigned_hotel;
        query = query.or(`hotel.eq.${profile.assigned_hotel},hotel.eq.${hotelName}`);
      }
      const { data, error } = await query.order('room_number');
      if (error) throw error;
      setRooms(data || []);
    } catch (error) {
      console.error('Error fetching rooms:', error);
      toast.error(t('common.error'));
    }
  };

  const startCamera = useCallback(async () => {
    try {
      setShowCamera(true);
      setIsCameraLoading(true);
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
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

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    context.drawImage(videoRef.current, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setPhotos(prev => [...prev, { dataUrl: URL.createObjectURL(blob), blob }]);
      toast.success(ui.photoCaptured);
      stopCamera();
    }, 'image/jpeg', 0.9);
  }, [stopCamera, ui.photoCaptured]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    setPhotos(prev => [
      ...prev,
      ...imageFiles.map(file => ({ dataUrl: URL.createObjectURL(file), blob: file }))
    ]);
    if (imageFiles.length) toast.success(`${imageFiles.length} ${ui.photoAdded}`);
  };

  const handleSubmit = async () => {
    if (!user || !description.trim()) {
      toast.error(ui.descriptionRequired);
      return;
    }
    const roomToUse = initialRoomId || selectedRoomId;
    if (!roomToUse) {
      toast.error(ui.selectRoomRequired);
      return;
    }

    setIsUploading(true);
    try {
      const selectedRoom = rooms.find(r => r.id === roomToUse);
      const roomNum = initialRoomId ? roomNumber : selectedRoom?.room_number || 'unknown';
      const uploadedUrls: string[] = [];

      for (const photo of photos) {
        const fileName = `${user.id}/${roomNum}/maintenance_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const { data, error } = await supabase.storage
          .from('room-photos')
          .upload(fileName, photo.blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('room-photos').getPublicUrl(data.path);
        uploadedUrls.push(publicUrl);
      }

      const { data, error } = await (supabase as any).rpc('create_housekeeping_maintenance_ticket', {
        _room_id: roomToUse,
        _assignment_id: assignmentId || null,
        _description: description.trim(),
        _priority: priority,
        _photo_urls: uploadedUrls,
      });
      if (error) throw error;

      const ticket = Array.isArray(data) ? data[0] : data;
      if (ticket?.assigned_to) {
        try {
          await supabase.functions.invoke('send-work-assignment-notification', {
            body: {
              staff_id: ticket.assigned_to,
              assignment_type: 'ticket',
              assignment_details: {
                id: ticket.id,
                title: description.trim().slice(0, 80),
                room_number: roomNum,
                priority,
              },
              hotel_name: ticket.hotel,
            }
          });
        } catch (notificationError) {
          console.warn('Maintenance assignment email could not be sent:', notificationError);
        }
        toast.success(`${ui.ticketCreated} · ${ui.assignedTo}: ${ticket.assignee_name || 'Maintenance'}`);
      } else {
        toast.warning(`${ui.ticketCreated}. ${ui.noOnDuty}. ${ui.noOnDutyDetail}`);
      }

      window.dispatchEvent(new CustomEvent('maintenance-ticket-created', {
        detail: { ticketId: ticket?.id, hotel: ticket?.hotel, assignedTo: ticket?.assigned_to || null }
      }));

      onIssueReported?.();
      handleClose();
    } catch (error: any) {
      console.error('Error reporting issue:', error);
      toast.error(`${ui.reportFailed}: ${error?.message || t('common.error')}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    stopCamera();
    setDescription('');
    setPriority('medium');
    photos.forEach(photo => URL.revokeObjectURL(photo.dataUrl));
    setPhotos([]);
    setSelectedRoomId(initialRoomId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next ? handleClose() : onOpenChange(next)}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Wrench className="h-5 w-5 text-primary" />
            {t('maintenance.reportIssue')} {initialRoomId ? `· ${t('common.room')} ${roomNumber}` : ''}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{ui.subtitle}</p>
        </DialogHeader>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3 flex items-start gap-3">
            <Send className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{ui.directRoute}</span>
                <Badge variant="outline" className="text-[10px] bg-background">HotelCare</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{ui.assignmentInfo}</p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!initialRoomId && (
            <div className="space-y-2">
              <Label htmlFor="room">{t('maintenance.selectRoom')} *</Label>
              <Select value={selectedRoomId || ''} onValueChange={setSelectedRoomId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder={t('maintenance.selectRoomPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map(room => (
                    <SelectItem key={room.id} value={room.id}>
                      {t('common.room')} {room.room_number} · {room.hotel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">{t('maintenance.issueDescription')} *</Label>
            <Textarea
              id="description"
              placeholder={t('maintenance.issuePlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="min-h-28 text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">{t('maintenance.priority')}</Label>
            <Select value={priority} onValueChange={(value: any) => setPriority(value)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">{t('priority.low')}</SelectItem>
                <SelectItem value="medium">{t('priority.medium')}</SelectItem>
                <SelectItem value="high">{t('priority.high')}</SelectItem>
                <SelectItem value="urgent">{t('priority.urgent')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!showCamera ? (
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={startCamera} variant="outline" className="h-11">
                <Camera className="h-4 w-4 mr-2" />{t('common.takePhoto')}
              </Button>
              <Button type="button" onClick={() => fileInputRef.current?.click()} variant="outline" className="h-11">
                <Upload className="h-4 w-4 mr-2" />{t('common.uploadPhoto')}
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileUpload} className="hidden" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
                {isCameraLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 text-white">
                    <Camera className="h-8 w-8 animate-pulse" />
                  </div>
                )}
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" onClick={capturePhoto} disabled={isCameraLoading}>
                  <Camera className="h-4 w-4 mr-2" />{t('common.capture')}
                </Button>
                <Button type="button" onClick={stopCamera} variant="outline">{t('common.cancel')}</Button>
              </div>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />

          {photos.length > 0 && (
            <div className="space-y-2">
              <Label>{t('common.photos')} ({photos.length})</Label>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo, index) => (
                  <Card key={index} className="relative overflow-hidden">
                    <img src={photo.dataUrl} alt={`Maintenance ${index + 1}`} className="w-full h-24 object-cover" />
                    <Button type="button" size="icon" variant="destructive" className="absolute top-1 right-1 h-7 w-7" onClick={() => {
                      URL.revokeObjectURL(photo.dataUrl);
                      setPhotos(prev => prev.filter((_, i) => i !== index));
                    }}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg bg-muted/40 p-2.5">
            <UserCheck className="h-4 w-4 shrink-0" />
            <span>{ui.assignmentInfo}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button type="button" onClick={handleClose} variant="outline" className="h-11" disabled={isUploading}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={isUploading || !description.trim()} className="h-11">
              {isUploading ? t('maintenance.reporting') : (
                <><CheckCircle className="h-4 w-4 mr-2" />{t('maintenance.reportIssue')}</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
