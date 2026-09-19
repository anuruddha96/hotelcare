import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ArrowLeft, ArrowRight, Bath, Bed, Camera, Check, CheckCircle, Coffee, ImagePlus, RotateCcw, SkipForward, Trash2, Upload, Wine, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { isGozsduNoMinibarRoom } from '@/lib/gozsduNoMinibar';

type Category = 'bed' | 'tea_coffee_table' | 'bathroom' | 'trash_bin' | 'minibar';
type SkipReason = 'guest_limited_service' | 'guest_present_privacy' | 'area_not_serviced' | 'not_applicable' | 'no_access' | 'other';
type Language = 'en' | 'hu' | 'vi' | 'mn' | 'es';
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  hotel?: string;
  assignmentId?: string;
  onPhotoCaptured?: () => void;
}

// The order follows how staff walk through the room. Keys and filenames are
// unchanged: existing photos, completion validation and supervisor evidence
// continue to use the same five categories.
const ALL_STEPS = [
  { key: 'bed', translation: 'photoCategory.bed', icon: Bed },
  { key: 'tea_coffee_table', translation: 'photoCategory.teaCoffeeTable', icon: Coffee },
  { key: 'bathroom', translation: 'photoCategory.bathroom', icon: Bath },
  { key: 'trash_bin', translation: 'photoCategory.trashBin', icon: Trash2 },
  { key: 'minibar', translation: 'photoCategory.minibar', icon: Wine },
] as const;
const REASONS: SkipReason[] = ['guest_limited_service', 'guest_present_privacy', 'area_not_serviced', 'not_applicable', 'no_access', 'other'];
const LIMITED = '[LIMITED_SERVICE]';
const DETAIL = '[LIMITED_SERVICE_DETAIL]';
const NON_FULL_CLEAN = '[TOWEL_CHANGE_ONLY]'; // Compatibility: supervisor must not publish a limited clean to PMS.
const TEXT: Record<Language, Record<string, string>> = {
  en: { title: 'Daily room photos', step: 'Step', progress: 'sections recorded', prompt: 'Take the photo, then continue automatically.', take: 'Take photo', choose: 'Choose photo', another: 'Add another photo / angle', anotherPrevious: 'Add another photo of', next: 'Next section', back: 'Previous', required: 'Photo required', taken: 'Photos', skipped: 'Skipped', skip: 'Skip with reason', undo: 'Undo skip', save: 'Save evidence', saving: 'Saving…', full: 'Full clean', limited: 'Limited service', skipTitle: 'Why can this photo not be taken?', skipHelp: 'Only skip for limited guest service, privacy/access restrictions, or a genuinely non-applicable area. Your supervisor will see the reason.', reason: 'Reason', detail: 'Optional detail', confirm: 'Record skip', limitedTitle: 'What service was completed?', limitedHelp: 'Skipping does not count as a full clean. Briefly describe the actual service.', limitedPlaceholder: 'e.g. Changed towels and collected rubbish only', incomplete: 'Complete all five steps with a photo or a justified skip.', noteRequired: 'Describe the limited service completed.', exitTitle: 'Leave photo capture?', exitHelp: 'Photos and skip reasons already saved will remain on the room. Unfinished steps still need attention.', leave: 'Leave', saved: 'Room photo evidence saved', error: 'Photo could not be saved. Try again.', cameraError: 'Camera unavailable. Choose a photo instead.', loading: 'Loading room photos…', review: 'Tap any step to review or add more photos.', noPhoto: 'No photo yet', anotherHint: 'Extra beds and additional angles are always allowed.', camera: 'Camera', cancelled: 'Cancel' },
  hu: { title: 'Napi szobafotók', step: 'Lépés', progress: 'rész rögzítve', prompt: 'Készíts fotót, majd automatikusan továbblépsz.', take: 'Fotó készítése', choose: 'Fotó kiválasztása', another: 'Újabb fotó / másik szög', anotherPrevious: 'Újabb fotó erről:', next: 'Következő rész', back: 'Előző', required: 'Fotó szükséges', taken: 'Fotók', skipped: 'Kihagyva', skip: 'Kihagyás indokkal', undo: 'Kihagyás visszavonása', save: 'Bizonyíték mentése', saving: 'Mentés…', full: 'Teljes takarítás', limited: 'Korlátozott szolgáltatás', skipTitle: 'Miért nem készíthető fotó?', skipHelp: 'Csak vendégkérés, adatvédelem, hozzáférési akadály vagy valóban nem alkalmazható rész miatt hagyd ki. A felügyelő látja az indokot.', reason: 'Indok', detail: 'Opcionális megjegyzés', confirm: 'Kihagyás rögzítése', limitedTitle: 'Milyen szolgáltatás történt?', limitedHelp: 'A kihagyás nem jelent teljes takarítást. Írd le röviden az elvégzett munkát.', limitedPlaceholder: 'pl. Csak törölközőcsere és szemétgyűjtés', incomplete: 'Mind az öt részhez fotó vagy indokolt kihagyás szükséges.', noteRequired: 'Írd le az elvégzett korlátozott szolgáltatást.', exitTitle: 'Kilépsz a fotózásból?', exitHelp: 'A mentett fotók és indokok megmaradnak. A hiányzó lépések továbbra is szükségesek.', leave: 'Kilépés', saved: 'Szobafotók mentve', error: 'A fotó mentése sikertelen. Próbáld újra.', cameraError: 'A kamera nem érhető el. Válassz képet a telefonról.', loading: 'Fotók betöltése…', review: 'Érints meg egy lépést az ellenőrzéshez vagy további fotókhoz.', noPhoto: 'Még nincs fotó', anotherHint: 'Több ágyat és szöget is fotózhatsz.', camera: 'Kamera', cancelled: 'Mégse' },
  vi: { title: 'Ảnh phòng hằng ngày', step: 'Bước', progress: 'mục đã ghi', prompt: 'Chụp ảnh để tự động sang bước tiếp theo.', take: 'Chụp ảnh', choose: 'Chọn ảnh', another: 'Thêm ảnh / góc khác', anotherPrevious: 'Thêm ảnh cho', next: 'Bước tiếp', back: 'Quay lại', required: 'Cần ảnh', taken: 'Ảnh', skipped: 'Đã bỏ qua', skip: 'Bỏ qua có lý do', undo: 'Hủy bỏ qua', save: 'Lưu bằng chứng', saving: 'Đang lưu…', full: 'Dọn đầy đủ', limited: 'Dịch vụ giới hạn', skipTitle: 'Tại sao không thể chụp ảnh?', skipHelp: 'Chỉ bỏ qua vì yêu cầu của khách, quyền riêng tư, không thể tiếp cận hoặc không áp dụng. Giám sát sẽ xem lý do.', reason: 'Lý do', detail: 'Ghi chú thêm', confirm: 'Ghi nhận bỏ qua', limitedTitle: 'Đã thực hiện công việc gì?', limitedHelp: 'Bỏ qua không có nghĩa là dọn đầy đủ. Ghi ngắn gọn công việc thực tế.', limitedPlaceholder: 'Ví dụ: chỉ thay khăn và thu rác', incomplete: 'Cả năm mục cần ảnh hoặc lý do bỏ qua.', noteRequired: 'Mô tả dịch vụ giới hạn.', exitTitle: 'Rời phần chụp ảnh?', exitHelp: 'Ảnh và lý do đã lưu vẫn còn. Các bước chưa xong vẫn cần hoàn thành.', leave: 'Rời', saved: 'Đã lưu ảnh phòng', error: 'Không lưu được ảnh. Hãy thử lại.', cameraError: 'Không mở được camera. Hãy chọn ảnh.', loading: 'Đang tải ảnh…', review: 'Chạm vào bước để xem hoặc thêm ảnh.', noPhoto: 'Chưa có ảnh', anotherHint: 'Có thể chụp thêm giường hoặc góc khác.', camera: 'Camera', cancelled: 'Hủy' },
  mn: { title: 'Өрөөний өдөр тутмын зураг', step: 'Алхам', progress: 'хэсэг бүртгэгдсэн', prompt: 'Зураг авч дараагийн алхамд автоматаар шилжинэ.', take: 'Зураг авах', choose: 'Зураг сонгох', another: 'Нэмэлт зураг / өөр өнцөг', anotherPrevious: 'Нэмэлт зураг:', next: 'Дараагийн алхам', back: 'Буцах', required: 'Зураг шаардлагатай', taken: 'Зураг', skipped: 'Алгассан', skip: 'Шалтгаантай алгасах', undo: 'Алгасалтыг цуцлах', save: 'Баримт хадгалах', saving: 'Хадгалж байна…', full: 'Бүрэн цэвэрлэгээ', limited: 'Хязгаарлагдмал үйлчилгээ', skipTitle: 'Яагаад зураг авах боломжгүй вэ?', skipHelp: 'Зөвхөн зочны хүсэлт, нууцлал, нэвтрэх боломжгүй эсвэл хамаарахгүй үед алгасана. Хянагч шалтгааныг харна.', reason: 'Шалтгаан', detail: 'Нэмэлт тэмдэглэл', confirm: 'Алгасалтыг бүртгэх', limitedTitle: 'Ямар үйлчилгээ хийгдсэн бэ?', limitedHelp: 'Алгасалт нь бүрэн цэвэрлэгээ биш. Хийсэн ажлаа тэмдэглэнэ үү.', limitedPlaceholder: 'Жишээ нь зөвхөн алчуур сольж хог цуглуулсан', incomplete: 'Таван хэсэг бүр зураг эсвэл шалтгаантай байх ёстой.', noteRequired: 'Хязгаарлагдмал үйлчилгээг тайлбарлана уу.', exitTitle: 'Зураг авахаас гарах уу?', exitHelp: 'Хадгалсан зураг, шалтгаан үлдэнэ. Дутуу алхмууд дуусах ёстой.', leave: 'Гарах', saved: 'Өрөөний зураг хадгаллаа', error: 'Зураг хадгалагдсангүй. Дахин оролдоно уу.', cameraError: 'Камер нээгдсэнгүй. Зураг сонгоно уу.', loading: 'Зураг ачаалж байна…', review: 'Алхам дээр дарж зураг нэмнэ үү.', noPhoto: 'Зураг байхгүй', anotherHint: 'Ор болон бусад өнцгөөс нэмж авна.', camera: 'Камер', cancelled: 'Цуцлах' },
  es: { title: 'Fotos diarias', step: 'Paso', progress: 'secciones registradas', prompt: 'Toma la foto y avanza automáticamente.', take: 'Tomar foto', choose: 'Elegir foto', another: 'Otra foto / ángulo', anotherPrevious: 'Otra foto de', next: 'Siguiente', back: 'Anterior', required: 'Foto obligatoria', taken: 'Fotos', skipped: 'Omitida', skip: 'Omitir con motivo', undo: 'Deshacer omisión', save: 'Guardar evidencia', saving: 'Guardando…', full: 'Limpieza completa', limited: 'Servicio limitado', skipTitle: '¿Por qué no se puede tomar la foto?', skipHelp: 'Solo omite por solicitud del huésped, privacidad, falta de acceso o si no aplica. El supervisor verá el motivo.', reason: 'Motivo', detail: 'Detalle opcional', confirm: 'Registrar omisión', limitedTitle: '¿Qué servicio se realizó?', limitedHelp: 'Omitir no equivale a limpieza completa. Describe el trabajo realizado.', limitedPlaceholder: 'p. ej., solo toallas y basura', incomplete: 'Las cinco secciones necesitan foto o motivo de omisión.', noteRequired: 'Describe el servicio limitado.', exitTitle: '¿Salir de la captura?', exitHelp: 'Las fotos y motivos guardados permanecen; faltan pasos por completar.', leave: 'Salir', saved: 'Evidencia guardada', error: 'No se pudo guardar la foto. Inténtalo de nuevo.', cameraError: 'Cámara no disponible. Elige una foto.', loading: 'Cargando fotos…', review: 'Toca un paso para revisar o añadir fotos.', noPhoto: 'Sin foto', anotherHint: 'Puedes fotografiar más camas y ángulos.', camera: 'Cámara', cancelled: 'Cancelar' },
};
const REASON_LABELS: Record<Language, Record<SkipReason, string>> = {
  en: { guest_limited_service: 'Guest requested limited service only', guest_present_privacy: 'Guest present / privacy', area_not_serviced: 'Area not part of requested service', not_applicable: 'Not applicable in this room', no_access: 'No access to this area', other: 'Other' },
  hu: { guest_limited_service: 'A vendég csak korlátozott szolgáltatást kért', guest_present_privacy: 'Vendég jelen van / adatvédelem', area_not_serviced: 'Nem része a kért szolgáltatásnak', not_applicable: 'Nem alkalmazható ebben a szobában', no_access: 'Nincs hozzáférés', other: 'Egyéb' },
  vi: { guest_limited_service: 'Khách chỉ yêu cầu dịch vụ giới hạn', guest_present_privacy: 'Khách đang ở trong phòng / riêng tư', area_not_serviced: 'Không thuộc dịch vụ yêu cầu', not_applicable: 'Không áp dụng', no_access: 'Không thể tiếp cận', other: 'Khác' },
  mn: { guest_limited_service: 'Зочин хязгаарлагдмал үйлчилгээ хүссэн', guest_present_privacy: 'Зочин байгаа / нууцлал', area_not_serviced: 'Үйлчилгээнд хамаарахгүй', not_applicable: 'Энэ өрөөнд хамаарахгүй', no_access: 'Нэвтрэх боломжгүй', other: 'Бусад' },
  es: { guest_limited_service: 'El huésped solo solicitó servicio limitado', guest_present_privacy: 'Huésped presente / privacidad', area_not_serviced: 'Zona fuera del servicio solicitado', not_applicable: 'No aplica', no_access: 'Sin acceso', other: 'Otro' },
};

const filename = (url: string) => {
  try { return decodeURIComponent(url.split('#')[0].split('?')[0].split('/').pop() || ''); }
  catch { return url.split('?')[0].split('/').pop() || ''; }
};
const categoryOf = (url: string): Category | null => ALL_STEPS.find(step => filename(url).startsWith(`${step.key}_`))?.key || null;
const isSkip = (url: string) => filename(url).includes('_skipped_');
const reasonOf = (url: string): SkipReason | null => REASONS.find(reason => filename(url).includes(`_skipped_${reason}_`)) || null;
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const stripLimited = (value: string) => value.split('\n').filter(line => !line.includes(LIMITED) && !line.includes(DETAIL)).join('\n').trim();
const limitedMarker = `${NON_FULL_CLEAN} ${LIMITED} Limited stayover service — not a full room clean. Skipped photo sections are recorded as evidence cards.`;

/** Single-card mobile stepper; all evidence remains assignment-scoped and immediately saved. */
export function GuidedRoomPhotoCapture({ open, onOpenChange, roomNumber, hotel, assignmentId, onPhotoCaptured }: Props) {
  const { user, profile } = useAuth();
  const noMinibar = isGozsduNoMinibarRoom(profile?.assigned_hotel, hotel);
  // The guest-facing minibar category does not exist at Gozsdu. Historical
  // minibar evidence is preserved; it is not a current step or a completion gate.
  const STEPS = useMemo(() => noMinibar
    ? ALL_STEPS.filter(step => step.key !== 'minibar')
    : ALL_STEPS, [noMinibar]);
  const { t, language } = useTranslation();
  const locale: Language = language === 'hu' || language === 'vi' || language === 'mn' || language === 'es' ? language : 'en';
  const copy = TEXT[locale];
  const labels = REASON_LABELS[locale];
  const [photos, setPhotos] = useState<string[]>([]);
  const [assignmentType, setAssignmentType] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [previousCategory, setPreviousCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraCategory, setCameraCategory] = useState<Category>('bed');
  const [skipCategory, setSkipCategory] = useState<Category | null>(null);
  const [skipReason, setSkipReason] = useState<SkipReason>('guest_limited_service');
  const [skipDetail, setSkipDetail] = useState('');
  const [limitedNote, setLimitedNote] = useState('');
  const [exitWarning, setExitWarning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pickerCategory = useRef<Category>('bed');
  const current = STEPS[Math.min(index, STEPS.length - 1)];
  const evidence = useMemo(() => Object.fromEntries(STEPS.map(step => [step.key, { real: photos.filter(url => categoryOf(url) === step.key && !isSkip(url)), skipped: photos.filter(url => categoryOf(url) === step.key && isSkip(url)) }])) as Record<Category, { real: string[]; skipped: string[] }>, [photos, STEPS]);
  const resolved = STEPS.filter(step => evidence[step.key].real.length || evidence[step.key].skipped.length).length;
  const anySkipped = STEPS.some(step => evidence[step.key].skipped.length > 0);
  const complete = resolved === STEPS.length;
  const skipAllowed = assignmentType === 'daily_cleaning';
  const incompleteCopy = noMinibar ? ({
    en: 'Complete all four applicable sections with a photo or a justified skip.',
    hu: 'Mind a négy alkalmazható részhez fotó vagy indokolt kihagyás szükséges.',
    vi: 'Bốn mục áp dụng cần ảnh hoặc lý do bỏ qua.',
    mn: 'Хамаарах дөрвөн хэсэг бүрд зураг эсвэл алгасах шалтгаан шаардлагатай.',
    es: 'Las cuatro secciones aplicables necesitan foto o motivo de omisión.',
  } as const)[locale] : copy.incomplete;

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCameraOpen(false);
    setCameraLoading(false);
  }, []);
  useEffect(() => () => stopCamera(), [stopCamera]);
  useEffect(() => {
    if (!open) { stopCamera(); return; }
    if (!assignmentId) { setPhotos([]); setAssignmentType(null); return; }
    let active = true;
    setPhotos([]); setAssignmentType(null); setIndex(0); setPreviousCategory(null);
    setLimitedNote(''); setSkipCategory(null); setLoading(true);
    void (async () => {
      const { data, error } = await supabase.from('room_assignments').select('completion_photos, notes, assignment_type').eq('id', assignmentId).single();
      if (!active) return;
      if (error) toast.error(copy.error);
      else {
        setPhotos((data?.completion_photos || []) as string[]);
        setAssignmentType(data?.assignment_type || null);
        const detail = String(data?.notes || '').split('\n').find(line => line.includes(DETAIL));
        setLimitedNote(detail ? detail.replace(DETAIL, '').trim() : '');
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [open, assignmentId, noMinibar, copy.error, stopCamera]);

  const persist = async (transform: (urls: string[]) => string[]) => {
    if (!assignmentId) throw new Error('Missing room assignment');
    const { data, error } = await supabase.from('room_assignments').select('completion_photos').eq('id', assignmentId).single();
    if (error) throw error;
    const next = transform((data?.completion_photos || []) as string[]);
    const result = await supabase.from('room_assignments').update({ completion_photos: next }).eq('id', assignmentId);
    if (result.error) throw result.error;
    setPhotos(next);
    return next;
  };
  const updateNotes = async (mode: 'ensure' | 'remove' | 'detail', detail = '') => {
    if (!assignmentId) throw new Error('Missing room assignment');
    const { data, error } = await supabase.from('room_assignments').select('notes').eq('id', assignmentId).single();
    if (error) throw error;
    const base = stripLimited(String(data?.notes || ''));
    const next = mode === 'remove' ? base : [base, limitedMarker, ...(mode === 'detail' ? [`${DETAIL} ${detail.trim()}`] : [])].filter(Boolean).join('\n');
    const result = await supabase.from('room_assignments').update({ notes: next }).eq('id', assignmentId);
    if (result.error) throw result.error;
  };
  const upload = async (category: Category, blob: Blob, suffix: string, extension: string, contentType: string) => {
    if (!user?.id) throw new Error('Sign in required');
    const safeRoom = roomNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    const path = `${user.id}/${safeRoom}/${category}_${suffix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${extension}`;
    const result = await supabase.storage.from('room-photos').upload(path, blob, { contentType, cacheControl: '3600', upsert: false });
    if (result.error) throw result.error;
    return supabase.storage.from('room-photos').getPublicUrl(result.data.path).data.publicUrl;
  };
  const advance = (category: Category, urls: string[]) => {
    const captured = STEPS.findIndex(step => step.key === category);
    const next = STEPS.findIndex((step, position) => position > captured && !urls.some(url => categoryOf(url) === step.key));
    setPreviousCategory(category);
    if (next >= 0) setIndex(next);
    else {
      const firstIncomplete = STEPS.findIndex(step => !urls.some(url => categoryOf(url) === step.key));
      setIndex(firstIncomplete >= 0 ? firstIncomplete : captured);
    }
  };
  const savePhoto = async (category: Category, blob: Blob, type = 'image/jpeg', ext = 'jpg') => {
    if (busy) return;
    setBusy(true);
    try {
      const url = await upload(category, blob, 'photo', ext, type);
      const next = await persist(urls => [...urls.filter(item => !(categoryOf(item) === category && isSkip(item))), url]);
      if (!next.some(isSkip)) await updateNotes('remove');
      advance(category, next);
      toast.success(`${t(STEPS.find(step => step.key === category)?.translation || '')} ✓`);
    } catch (error) { console.error('Room photo upload failed:', error); toast.error(copy.error); }
    finally { setBusy(false); }
  };
  const startCamera = async (category: Category) => {
    if (busy) return;
    setCameraCategory(category); setCameraLoading(true); setCameraOpen(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable');
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      stream.current = media;
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
    } catch (error) { console.error('Camera start failed:', error); stopCamera(); toast.error(copy.cameraError); }
    finally { setCameraLoading(false); }
  };
  const capture = async () => {
    const element = video.current;
    const surface = canvas.current;
    if (!element || !surface || busy || cameraLoading) return;
    const context = surface.getContext('2d');
    if (!context) return;
    surface.width = element.videoWidth || 1280; surface.height = element.videoHeight || 720;
    context.drawImage(element, 0, 0, surface.width, surface.height);
    const blob = await new Promise<Blob | null>(resolve => surface.toBlob(resolve, 'image/jpeg', 0.85));
    surface.width = 0; surface.height = 0;
    const category = cameraCategory;
    stopCamera();
    if (blob) await savePhoto(category, blob);
    else toast.error(copy.error);
  };
  const choosePhoto = (category: Category) => {
    pickerCategory.current = category;
    picker.current?.click();
  };
  const handleSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 15 * 1024 * 1024) { toast.error(copy.error); return; }
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'jpg';
    await savePhoto(pickerCategory.current, file, file.type || 'image/jpeg', extension);
  };
  const recordSkip = async () => {
    if (!skipCategory || !skipAllowed || busy) return;
    if (skipReason === 'other' && skipDetail.trim().length < 3) { toast.error(copy.noteRequired); return; }
    setBusy(true);
    const category = skipCategory;
    try {
      const label = t(STEPS.find(step => step.key === category)?.translation || '');
      const value = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f8fafc"/><text x="70" y="110" font-size="34" fill="#0f172a">Photo intentionally skipped — not a full clean</text><text x="70" y="190" font-size="28" fill="#0f172a">Room: ${escapeXml(roomNumber)}</text><text x="70" y="250" font-size="28" fill="#0f172a">Section: ${escapeXml(label)}</text><text x="70" y="310" font-size="26" fill="#0f172a">Reason: ${escapeXml(labels[skipReason])}</text><text x="70" y="370" font-size="23" fill="#0f172a">Detail: ${escapeXml(skipDetail.trim()).slice(0, 80)}</text><text x="70" y="430" font-size="23" fill="#0f172a">Recorded: ${escapeXml(new Date().toLocaleString())}</text></svg>`;
      const url = await upload(category, new Blob([value], { type: 'image/svg+xml' }), `skipped_${skipReason}`, 'svg', 'image/svg+xml');
      const next = await persist(urls => [...urls.filter(item => categoryOf(item) !== category), url]);
      await updateNotes('ensure');
      setSkipCategory(null); setSkipDetail(''); setSkipReason('guest_limited_service');
      advance(category, next);
    } catch (error) { console.error('Skip evidence failed:', error); toast.error(copy.error); }
    finally { setBusy(false); }
  };
  const undoSkip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await persist(urls => urls.filter(url => !(categoryOf(url) === current.key && isSkip(url))));
      if (!next.some(isSkip)) { await updateNotes('remove'); setLimitedNote(''); }
    } catch (error) { console.error('Undo skip failed:', error); toast.error(copy.error); }
    finally { setBusy(false); }
  };
  const finish = async () => {
    if (!complete) { toast.error(incompleteCopy); return; }
    if (anySkipped && limitedNote.trim().length < 3) { toast.error(copy.noteRequired); return; }
    setBusy(true);
    try {
      await updateNotes(anySkipped ? 'detail' : 'remove', limitedNote);
      await onPhotoCaptured?.();
      toast.success(copy.saved);
      stopCamera(); onOpenChange(false);
    } catch (error) { console.error('Evidence finalization failed:', error); toast.error(copy.error); }
    finally { setBusy(false); }
  };
  const requestClose = () => {
    stopCamera();
    if (busy) return;
    if (resolved > 0 && !complete) setExitWarning(true);
    else onOpenChange(false);
  };
  const active = evidence[current.key];
  const Icon = current.icon;
  const previous = previousCategory && STEPS.find(step => step.key === previousCategory);
  const showPreviousShortcut = previous && previousCategory !== current.key && evidence[previousCategory!].real.length > 0;

  return <>
    <Dialog open={open} onOpenChange={next => next ? onOpenChange(true) : requestClose()}>
      <DialogContent className="w-[calc(100vw-0.5rem)] max-w-xl h-[min(94dvh,780px)] flex flex-col overflow-hidden gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-3"><DialogTitle className="flex items-center gap-2 pr-8 text-base"><Camera className="h-5 w-5 text-primary shrink-0" />{copy.title} — {roomNumber}</DialogTitle></DialogHeader>
        <div className="shrink-0 px-4 pt-3 pb-2 space-y-2 border-b">
          <div className="flex justify-between items-center gap-2 text-xs"><span className="font-semibold">{resolved} / {STEPS.length} {copy.progress}</span><Badge variant={anySkipped ? 'outline' : complete ? 'default' : 'secondary'}>{anySkipped ? copy.limited : copy.full}</Badge></div>
          <Progress value={resolved / STEPS.length * 100} className="h-1.5" />
          <div className="flex gap-1 overflow-x-auto py-1" role="group" aria-label={copy.review}>
            {STEPS.map((step, position) => {
              const StepIcon = step.icon;
              const done = evidence[step.key].real.length > 0;
              const skipped = evidence[step.key].skipped.length > 0;
              return <button key={step.key} type="button" disabled={busy || loading} aria-current={position === index ? 'step' : undefined} aria-label={`${position + 1}. ${t(step.translation)}${done ? `, ${evidence[step.key].real.length} ${copy.taken}` : skipped ? `, ${copy.skipped}` : ''}`} onClick={() => { setIndex(position); setPreviousCategory(null); }} className={cn('min-w-12 flex-1 flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] leading-tight transition-colors', position === index ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted')}>
                <span className={cn('h-8 w-8 rounded-full flex items-center justify-center', done ? 'bg-emerald-600 text-white' : skipped ? 'bg-amber-100 text-amber-800' : 'bg-muted text-foreground')}>
                  {done ? <Check className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                </span><span className="max-w-16 line-clamp-2 text-center">{t(step.translation)}</span>
              </button>;
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
          {loading ? <p role="status" className="py-10 text-center text-sm">{copy.loading}</p> : <>
            <div className="rounded-xl border-2 border-primary/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Icon className="h-6 w-6 text-primary" /><div><p className="text-xs text-muted-foreground">{copy.step} {index + 1} / {STEPS.length}</p><h3 className="font-bold text-lg">{t(current.translation)}</h3></div></div><Badge variant={active.real.length ? 'default' : active.skipped.length ? 'outline' : 'secondary'}>{active.real.length ? `${active.real.length} ${copy.taken}` : active.skipped.length ? copy.skipped : copy.required}</Badge></div>
              <p className="text-xs text-muted-foreground">{active.real.length ? copy.anotherHint : copy.prompt}</p>
              {active.real.length > 0 && <div className="grid grid-cols-3 gap-2" aria-label={`${t(current.translation)} ${copy.taken}`}>
                {active.real.map((url, number) => <a key={url} href={url} target="_blank" rel="noreferrer" className="aspect-square rounded-lg border overflow-hidden" aria-label={`${t(current.translation)} ${number + 1}`}><img src={url} alt={`${t(current.translation)} ${number + 1}`} loading="lazy" className="h-full w-full object-cover" /></a>)}
              </div>}
              {active.skipped.length > 0 && <p className="rounded-lg bg-amber-50 text-amber-900 p-2 text-xs">{labels[reasonOf(active.skipped[0]) || 'other']}</p>}
              <Button className="w-full min-h-12 text-base" disabled={busy} onClick={() => void startCamera(current.key)}><Camera className="h-5 w-5 mr-2" />{active.real.length ? copy.another : copy.take}</Button>
              <Button className="w-full min-h-11" variant="outline" disabled={busy} onClick={() => choosePhoto(current.key)}><Upload className="h-4 w-4 mr-2" />{copy.choose}</Button>
              {skipAllowed && !active.real.length && !active.skipped.length && <Button className="w-full min-h-10 text-amber-800" variant="ghost" disabled={busy} onClick={() => { setSkipCategory(current.key); setSkipDetail(''); setSkipReason('guest_limited_service'); }}><SkipForward className="h-4 w-4 mr-2" />{copy.skip}</Button>}
              {active.skipped.length > 0 && <Button className="w-full min-h-10" variant="ghost" disabled={busy} onClick={() => void undoSkip()}><RotateCcw className="h-4 w-4 mr-2" />{copy.undo}</Button>}
            </div>
            {showPreviousShortcut && previous && <Button variant="outline" className="w-full min-h-11 border-dashed" disabled={busy} onClick={() => void startCamera(previous.key)}><ImagePlus className="h-4 w-4 mr-2" />{copy.anotherPrevious} {t(previous.translation)}</Button>}
            <div className="flex justify-between gap-2"><Button variant="ghost" disabled={busy || index === 0} onClick={() => { setIndex(i => i - 1); setPreviousCategory(null); }}><ArrowLeft className="h-4 w-4 mr-1" />{copy.back}</Button><Button variant="ghost" disabled={busy || index === STEPS.length - 1} onClick={() => { setIndex(i => i + 1); setPreviousCategory(null); }}>{copy.next}<ArrowRight className="h-4 w-4 ml-1" /></Button></div>
            {anySkipped && <div className="rounded-xl border border-amber-300 bg-amber-50/50 p-3 space-y-2"><Label htmlFor="limited-service-note" className="font-semibold">{copy.limitedTitle}</Label><p className="text-xs text-muted-foreground">{copy.limitedHelp}</p><Textarea id="limited-service-note" rows={2} value={limitedNote} onChange={event => setLimitedNote(event.target.value)} placeholder={copy.limitedPlaceholder} /></div>}
            {!complete && resolved > 0 && <p className="text-xs text-muted-foreground">{incompleteCopy}</p>}
          </>}
        </div>
        <div className="shrink-0 border-t bg-background p-3 flex gap-2"><Button disabled={busy || loading || !complete || (anySkipped && limitedNote.trim().length < 3)} onClick={() => void finish()} className="flex-1 min-h-12"><CheckCircle className="h-4 w-4 mr-2" />{busy ? copy.saving : copy.save}</Button><Button variant="outline" disabled={busy} onClick={requestClose} className="min-h-12 px-3" aria-label={copy.cancelled}><X className="h-5 w-5" /></Button></div>
      </DialogContent>
    </Dialog>
    <input ref={picker} type="file" accept="image/*" capture="environment" className="hidden" onChange={event => void handleSelected(event)} />
    <AlertDialog open={cameraOpen} onOpenChange={next => { if (!next) stopCamera(); }}><AlertDialogContent className="w-[calc(100vw-0.75rem)] max-w-xl p-3"><AlertDialogHeader><AlertDialogTitle>{t(STEPS.find(step => step.key === cameraCategory)?.translation || '')} — {roomNumber}</AlertDialogTitle><AlertDialogDescription>{copy.camera}</AlertDialogDescription></AlertDialogHeader><div className="aspect-[3/4] sm:aspect-video overflow-hidden rounded-xl bg-black"><video ref={video} playsInline muted autoPlay className="w-full h-full object-cover" /></div><canvas ref={canvas} className="hidden" /><AlertDialogFooter className="grid grid-cols-2 gap-2"><AlertDialogCancel onClick={stopCamera}>{copy.cancelled}</AlertDialogCancel><AlertDialogAction disabled={busy || cameraLoading} onClick={() => void capture()}><Camera className="h-4 w-4 mr-1" />{copy.take}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={!!skipCategory} onOpenChange={next => { if (!next && !busy) setSkipCategory(null); }}><AlertDialogContent className="w-[calc(100vw-1rem)] max-w-md"><AlertDialogHeader><AlertDialogTitle>{copy.skipTitle}</AlertDialogTitle><AlertDialogDescription>{copy.skipHelp}</AlertDialogDescription></AlertDialogHeader><div className="space-y-3"><Label htmlFor="photo-skip-reason">{copy.reason}</Label><Select value={skipReason} onValueChange={value => setSkipReason(value as SkipReason)} disabled={busy}><SelectTrigger id="photo-skip-reason"><SelectValue /></SelectTrigger><SelectContent>{REASONS.map(reason => <SelectItem key={reason} value={reason}>{labels[reason]}</SelectItem>)}</SelectContent></Select><Label htmlFor="photo-skip-detail">{copy.detail}</Label><Textarea id="photo-skip-detail" value={skipDetail} onChange={event => setSkipDetail(event.target.value)} rows={2} /></div><AlertDialogFooter><AlertDialogCancel disabled={busy}>{copy.cancelled}</AlertDialogCancel><AlertDialogAction disabled={busy || (skipReason === 'other' && skipDetail.trim().length < 3)} onClick={() => void recordSkip()}>{copy.confirm}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={exitWarning} onOpenChange={setExitWarning}><AlertDialogContent className="w-[calc(100vw-1rem)] max-w-md"><AlertDialogHeader><AlertDialogTitle>{copy.exitTitle}</AlertDialogTitle><AlertDialogDescription>{copy.exitHelp}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{copy.cancelled}</AlertDialogCancel><AlertDialogAction onClick={() => { setExitWarning(false); onOpenChange(false); }}>{copy.leave}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
