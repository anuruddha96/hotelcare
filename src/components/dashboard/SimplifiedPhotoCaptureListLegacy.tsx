import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  AlertCircle,
  Bath,
  Bed,
  Camera,
  CheckCircle,
  Coffee,
  RotateCcw,
  SkipForward,
  Trash2,
  Upload,
  Wine,
  X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SimplifiedPhotoCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  assignmentId?: string;
  onPhotoCaptured?: () => void;
}

type PhotoCategory = 'trash_bin' | 'bathroom' | 'bed' | 'minibar' | 'tea_coffee_table';
type SkipReason =
  | 'guest_limited_service'
  | 'guest_present_privacy'
  | 'area_not_serviced'
  | 'not_applicable'
  | 'no_access'
  | 'other';

const PHOTO_CATEGORIES = [
  { key: 'trash_bin' as PhotoCategory, translationKey: 'photoCategory.trashBin', icon: Trash2 },
  { key: 'bathroom' as PhotoCategory, translationKey: 'photoCategory.bathroom', icon: Bath },
  { key: 'bed' as PhotoCategory, translationKey: 'photoCategory.bed', icon: Bed },
  { key: 'minibar' as PhotoCategory, translationKey: 'photoCategory.minibar', icon: Wine },
  { key: 'tea_coffee_table' as PhotoCategory, translationKey: 'photoCategory.teaCoffeeTable', icon: Coffee },
] as const;

const LIMITED_SERVICE_MARKER = '[LIMITED_SERVICE]';
const LIMITED_SERVICE_DETAIL_MARKER = '[LIMITED_SERVICE_DETAIL]';

// SupervisorApprovalView already treats this legacy marker as a non-full-clean
// outcome and therefore does not publish a false "clean" state to the PMS.
// Keep it as a compatibility marker until service_scope becomes first-class.
const LEGACY_NON_FULL_CLEAN_MARKER = '[TOWEL_CHANGE_ONLY]';

const COPY = {
  en: {
    title: 'Daily room photos',
    intro: 'Take the photos you can. If the guest only allows limited service, a photo section can be skipped with a reason.',
    strict: 'For a normal full clean, all five photo sections are still required.',
    resolved: 'sections recorded',
    photo: 'Photo',
    skipped: 'Skipped',
    required: 'Required',
    capture: 'Take photo',
    choose: 'Choose photo',
    skip: 'Skip this section',
    undoSkip: 'Undo skip',
    skipTitle: 'Why can this photo not be taken?',
    skipDescription: 'Skipping is only for guest-requested limited service, privacy/access restrictions, or a genuinely non-applicable section. The reason will be visible to the supervisor.',
    reason: 'Reason',
    detail: 'Optional detail',
    confirmSkip: 'Record skip',
    limitedTitle: 'Limited service record',
    limitedInfo: 'At least one section was skipped. Briefly record what service was actually completed for the guest.',
    limitedPlaceholder: 'e.g. Replaced towels, collected rubbish and refilled water only',
    done: 'Save evidence',
    incomplete: 'Every section must have either a photo or an approved skip reason before saving.',
    noteRequired: 'Please record what limited service was completed.',
    exitTitle: 'Leave photo capture?',
    exitDescription: 'Some photo sections are still unresolved. Photos and skip evidence already saved will remain on this room.',
    leave: 'Leave',
    cameraError: 'Camera could not be opened. You can choose a photo from the phone instead.',
    saved: 'Daily-room evidence saved',
    skipSaved: 'Skip reason recorded',
    skipRemoved: 'Skip removed',
    fullClean: 'Full clean evidence',
    limited: 'Limited service evidence',
    loading: 'Loading room evidence…',
  },
  hu: {
    title: 'Napi szobafotók',
    intro: 'Készítsd el azokat a fotókat, amelyeket lehet. Ha a vendég csak korlátozott szolgáltatást enged, egy fotórész indoklással kihagyható.',
    strict: 'Normál teljes takarításnál továbbra is mind az öt fotórész kötelező.',
    resolved: 'rész rögzítve',
    photo: 'Fotó',
    skipped: 'Kihagyva',
    required: 'Kötelező',
    capture: 'Fotó készítése',
    choose: 'Fotó kiválasztása',
    skip: 'Rész kihagyása',
    undoSkip: 'Kihagyás visszavonása',
    skipTitle: 'Miért nem készíthető fotó?',
    skipDescription: 'Kihagyás csak vendég által kért korlátozott szolgáltatás, adatvédelem/hozzáférési korlátozás vagy valóban nem alkalmazható rész esetén használható. Az indokot a felügyelő látni fogja.',
    reason: 'Indok',
    detail: 'Opcionális megjegyzés',
    confirmSkip: 'Kihagyás rögzítése',
    limitedTitle: 'Korlátozott szolgáltatás',
    limitedInfo: 'Legalább egy rész ki lett hagyva. Röviden írd le, milyen szolgáltatás történt ténylegesen.',
    limitedPlaceholder: 'pl. Csak törölközőcsere, szemét összegyűjtése és vízfeltöltés',
    done: 'Bizonyíték mentése',
    incomplete: 'Mentés előtt minden részhez fotó vagy jóváhagyott kihagyási indok szükséges.',
    noteRequired: 'Írd le röviden, milyen korlátozott szolgáltatás történt.',
    exitTitle: 'Kilépsz a fotózásból?',
    exitDescription: 'Néhány fotórész még nincs rendezve. A már mentett fotók és kihagyások megmaradnak.',
    leave: 'Kilépés',
    cameraError: 'A kamera nem nyitható meg. Helyette választhatsz fotót a telefonról.',
    saved: 'Napi szoba bizonyíték mentve',
    skipSaved: 'Kihagyási indok rögzítve',
    skipRemoved: 'Kihagyás visszavonva',
    fullClean: 'Teljes takarítás bizonyítéka',
    limited: 'Korlátozott szolgáltatás bizonyítéka',
    loading: 'Szobabizonyíték betöltése…',
  },
  vi: {
    title: 'Ảnh phòng hằng ngày',
    intro: 'Chụp những ảnh có thể chụp. Nếu khách chỉ cho phép dịch vụ giới hạn, có thể bỏ qua một mục ảnh kèm lý do.',
    strict: 'Với dọn phòng đầy đủ bình thường, cả năm mục ảnh vẫn bắt buộc.',
    resolved: 'mục đã ghi nhận',
    photo: 'Ảnh',
    skipped: 'Đã bỏ qua',
    required: 'Bắt buộc',
    capture: 'Chụp ảnh',
    choose: 'Chọn ảnh',
    skip: 'Bỏ qua mục này',
    undoSkip: 'Hủy bỏ qua',
    skipTitle: 'Tại sao không thể chụp ảnh này?',
    skipDescription: 'Chỉ bỏ qua khi khách yêu cầu dịch vụ giới hạn, có hạn chế riêng tư/tiếp cận, hoặc mục này thực sự không áp dụng. Giám sát sẽ thấy lý do.',
    reason: 'Lý do',
    detail: 'Ghi chú thêm (không bắt buộc)',
    confirmSkip: 'Ghi nhận bỏ qua',
    limitedTitle: 'Ghi nhận dịch vụ giới hạn',
    limitedInfo: 'Có ít nhất một mục bị bỏ qua. Hãy ghi ngắn gọn dịch vụ thực tế đã làm cho khách.',
    limitedPlaceholder: 'vd. Chỉ thay khăn, gom rác và bổ sung nước',
    done: 'Lưu bằng chứng',
    incomplete: 'Mỗi mục phải có ảnh hoặc lý do bỏ qua được ghi nhận trước khi lưu.',
    noteRequired: 'Vui lòng ghi dịch vụ giới hạn đã thực hiện.',
    exitTitle: 'Rời phần chụp ảnh?',
    exitDescription: 'Một số mục ảnh chưa hoàn tất. Ảnh và lý do bỏ qua đã lưu vẫn được giữ lại.',
    leave: 'Rời',
    cameraError: 'Không thể mở camera. Bạn có thể chọn ảnh từ điện thoại.',
    saved: 'Đã lưu bằng chứng phòng hằng ngày',
    skipSaved: 'Đã ghi nhận lý do bỏ qua',
    skipRemoved: 'Đã hủy bỏ qua',
    fullClean: 'Bằng chứng dọn đầy đủ',
    limited: 'Bằng chứng dịch vụ giới hạn',
    loading: 'Đang tải bằng chứng phòng…',
  },
  mn: {
    title: 'Өдөр тутмын өрөөний зураг',
    intro: 'Боломжтой зургуудыг авна уу. Зочин зөвхөн хязгаарлагдмал үйлчилгээ зөвшөөрсөн бол зурагны хэсгийг шалтгаантайгаар алгасаж болно.',
    strict: 'Энгийн бүрэн цэвэрлэгээнд таван зурагны хэсэг бүгд шаардлагатай хэвээр.',
    resolved: 'хэсэг бүртгэгдсэн',
    photo: 'Зураг',
    skipped: 'Алгассан',
    required: 'Шаардлагатай',
    capture: 'Зураг авах',
    choose: 'Зураг сонгох',
    skip: 'Энэ хэсгийг алгасах',
    undoSkip: 'Алгасалтыг цуцлах',
    skipTitle: 'Яагаад энэ зургийг авч болохгүй байна вэ?',
    skipDescription: 'Зөвхөн зочны хүссэн хязгаарлагдмал үйлчилгээ, нууцлал/нэвтрэх хязгаарлалт эсвэл тухайн хэсэг үнэхээр хамаарахгүй үед алгасана. Шалтгааныг хянагч харна.',
    reason: 'Шалтгаан',
    detail: 'Нэмэлт тайлбар (заавал биш)',
    confirmSkip: 'Алгасалтыг бүртгэх',
    limitedTitle: 'Хязгаарлагдмал үйлчилгээ',
    limitedInfo: 'Дор хаяж нэг хэсэг алгассан. Зочинд яг ямар үйлчилгээ хийснийг товч бичнэ үү.',
    limitedPlaceholder: 'ж.нь. Зөвхөн алчуур сольж, хог авч, ус нөхсөн',
    done: 'Баримт хадгалах',
    incomplete: 'Хадгалахаас өмнө хэсэг бүр зураг эсвэл зөвшөөрөгдсөн алгасалтын шалтгаантай байх ёстой.',
    noteRequired: 'Ямар хязгаарлагдмал үйлчилгээ хийснийг бичнэ үү.',
    exitTitle: 'Зураг хэсгээс гарах уу?',
    exitDescription: 'Зарим хэсэг дуусаагүй байна. Хадгалсан зураг болон алгасалтын баримт өрөөнд үлдэнэ.',
    leave: 'Гарах',
    cameraError: 'Камер нээгдсэнгүй. Утаснаасаа зураг сонгож болно.',
    saved: 'Өдөр тутмын өрөөний баримт хадгалагдлаа',
    skipSaved: 'Алгасалтын шалтгаан бүртгэгдлээ',
    skipRemoved: 'Алгасалт цуцлагдлаа',
    fullClean: 'Бүрэн цэвэрлэгээний баримт',
    limited: 'Хязгаарлагдмал үйлчилгээний баримт',
    loading: 'Өрөөний баримт ачаалж байна…',
  },
  es: {
    title: 'Fotos de habitación diaria',
    intro: 'Toma las fotos que puedas. Si el huésped solo permite un servicio limitado, una sección de foto puede omitirse indicando el motivo.',
    strict: 'Para una limpieza completa normal, las cinco secciones de fotos siguen siendo obligatorias.',
    resolved: 'secciones registradas',
    photo: 'Foto',
    skipped: 'Omitida',
    required: 'Obligatoria',
    capture: 'Tomar foto',
    choose: 'Elegir foto',
    skip: 'Omitir esta sección',
    undoSkip: 'Deshacer omisión',
    skipTitle: '¿Por qué no se puede tomar esta foto?',
    skipDescription: 'La omisión solo se permite por servicio limitado solicitado por el huésped, restricciones de privacidad/acceso o una sección realmente no aplicable. El supervisor verá el motivo.',
    reason: 'Motivo',
    detail: 'Detalle opcional',
    confirmSkip: 'Registrar omisión',
    limitedTitle: 'Registro de servicio limitado',
    limitedInfo: 'Se omitió al menos una sección. Registra brevemente qué servicio se realizó realmente.',
    limitedPlaceholder: 'p. ej. Solo cambio de toallas, recogida de basura y reposición de agua',
    done: 'Guardar evidencia',
    incomplete: 'Cada sección debe tener una foto o un motivo de omisión registrado antes de guardar.',
    noteRequired: 'Registra qué servicio limitado se realizó.',
    exitTitle: '¿Salir de la captura?',
    exitDescription: 'Algunas secciones siguen sin resolver. Las fotos y omisiones ya guardadas permanecerán en la habitación.',
    leave: 'Salir',
    cameraError: 'No se pudo abrir la cámara. Puedes elegir una foto del teléfono.',
    saved: 'Evidencia de habitación diaria guardada',
    skipSaved: 'Motivo de omisión registrado',
    skipRemoved: 'Omisión eliminada',
    fullClean: 'Evidencia de limpieza completa',
    limited: 'Evidencia de servicio limitado',
    loading: 'Cargando evidencia de la habitación…',
  },
} as const;

const SKIP_REASON_LABELS: Record<string, Record<SkipReason, string>> = {
  en: {
    guest_limited_service: 'Guest requested limited service only',
    guest_present_privacy: 'Guest present / privacy — photo not appropriate',
    area_not_serviced: 'This area was not part of the requested service',
    not_applicable: 'Not applicable in this room',
    no_access: 'No access to this area',
    other: 'Other',
  },
  hu: {
    guest_limited_service: 'A vendég csak korlátozott szolgáltatást kért',
    guest_present_privacy: 'Vendég jelen van / adatvédelem miatt nem fotózható',
    area_not_serviced: 'Ez a terület nem volt része a kért szolgáltatásnak',
    not_applicable: 'Ebben a szobában nem alkalmazható',
    no_access: 'Nincs hozzáférés ehhez a területhez',
    other: 'Egyéb',
  },
  vi: {
    guest_limited_service: 'Khách chỉ yêu cầu dịch vụ giới hạn',
    guest_present_privacy: 'Khách đang ở trong phòng / không phù hợp để chụp ảnh',
    area_not_serviced: 'Khu vực này không thuộc dịch vụ được yêu cầu',
    not_applicable: 'Không áp dụng cho phòng này',
    no_access: 'Không thể tiếp cận khu vực này',
    other: 'Khác',
  },
  mn: {
    guest_limited_service: 'Зочин зөвхөн хязгаарлагдмал үйлчилгээ хүссэн',
    guest_present_privacy: 'Зочин өрөөнд байгаа / нууцлалын улмаас зураг авах боломжгүй',
    area_not_serviced: 'Энэ хэсэг хүссэн үйлчилгээнд ороогүй',
    not_applicable: 'Энэ өрөөнд хамаарахгүй',
    no_access: 'Энэ хэсэгт нэвтрэх боломжгүй',
    other: 'Бусад',
  },
  es: {
    guest_limited_service: 'El huésped solo solicitó servicio limitado',
    guest_present_privacy: 'Huésped presente / privacidad — no corresponde tomar foto',
    area_not_serviced: 'Esta zona no formó parte del servicio solicitado',
    not_applicable: 'No aplica en esta habitación',
    no_access: 'Sin acceso a esta zona',
    other: 'Otro',
  },
};

function filenameFromUrl(url: string): string {
  try {
    const withoutHash = url.split('#')[0];
    const withoutQuery = withoutHash.split('?')[0];
    return decodeURIComponent(withoutQuery.split('/').pop() || '');
  } catch {
    return url.split('/').pop() || '';
  }
}

function categoryFromUrl(url: string): PhotoCategory | null {
  const filename = filenameFromUrl(url);
  return PHOTO_CATEGORIES.find((category) => filename.startsWith(`${category.key}_`))?.key ?? null;
}

function isSkipEvidence(url: string): boolean {
  return filenameFromUrl(url).includes('_skipped_');
}

function skipReasonFromUrl(url: string): SkipReason | null {
  const filename = filenameFromUrl(url);
  const match = (Object.keys(SKIP_REASON_LABELS.en) as SkipReason[]).find((reason) =>
    filename.includes(`_skipped_${reason}_`),
  );
  return match ?? null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function limitedMarkerLine(): string {
  return `${LEGACY_NON_FULL_CLEAN_MARKER} ${LIMITED_SERVICE_MARKER} Limited stayover service — not a full room clean. Skipped photo sections are recorded as evidence cards.`;
}

function stripLimitedLines(notes: string): string {
  return notes
    .split('\n')
    .filter((line) => !line.includes(LIMITED_SERVICE_MARKER) && !line.includes(LIMITED_SERVICE_DETAIL_MARKER))
    .join('\n')
    .trim();
}

export function SimplifiedPhotoCapture({
  open,
  onOpenChange,
  roomNumber,
  assignmentId,
  onPhotoCaptured,
}: SimplifiedPhotoCaptureProps) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const locale = (language in COPY ? language : 'en') as keyof typeof COPY;
  const copy = COPY[locale];
  const reasonLabels = SKIP_REASON_LABELS[locale] || SKIP_REASON_LABELS.en;

  const [photos, setPhotos] = useState<string[]>([]);
  const [assignmentType, setAssignmentType] = useState<string | null>(null);
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [skipCategory, setSkipCategory] = useState<PhotoCategory | null>(null);
  const [skipReason, setSkipReason] = useState<SkipReason>('guest_limited_service');
  const [skipDetail, setSkipDetail] = useState('');
  const [limitedServiceNote, setLimitedServiceNote] = useState('');
  const [showExitWarning, setShowExitWarning] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentCategory = PHOTO_CATEGORIES[currentCategoryIndex];
  const skipAllowed = assignmentType === 'daily_cleaning';

  const evidenceByCategory = useMemo(() => {
    return Object.fromEntries(
      PHOTO_CATEGORIES.map((category) => {
        const urls = photos.filter((url) => categoryFromUrl(url) === category.key);
        return [category.key, {
          real: urls.filter((url) => !isSkipEvidence(url)),
          skipped: urls.filter(isSkipEvidence),
        }];
      }),
    ) as Record<PhotoCategory, { real: string[]; skipped: string[] }>;
  }, [photos]);

  const resolvedCount = useMemo(
    () => PHOTO_CATEGORIES.filter((category) => {
      const evidence = evidenceByCategory[category.key];
      return evidence.real.length > 0 || evidence.skipped.length > 0;
    }).length,
    [evidenceByCategory],
  );

  const anySkipped = useMemo(
    () => PHOTO_CATEGORIES.some((category) => evidenceByCategory[category.key].skipped.length > 0),
    [evidenceByCategory],
  );

  const allResolved = resolvedCount === PHOTO_CATEGORIES.length;
  const progress = (resolvedCount / PHOTO_CATEGORIES.length) * 100;

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setShowCamera(false);
    setCameraLoading(false);
  }, []);

  const loadExisting = useCallback(async () => {
    if (!assignmentId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('room_assignments')
        .select('completion_photos, notes, assignment_type')
        .eq('id', assignmentId)
        .single();
      if (error) throw error;
      setPhotos((data?.completion_photos || []) as string[]);
      setAssignmentType(data?.assignment_type || null);

      const notes = String(data?.notes || '');
      const detailLine = notes
        .split('\n')
        .find((line) => line.includes(LIMITED_SERVICE_DETAIL_MARKER));
      if (detailLine) {
        setLimitedServiceNote(detailLine.replace(LIMITED_SERVICE_DETAIL_MARKER, '').trim());
      } else {
        setLimitedServiceNote('');
      }
    } catch (error) {
      console.error('Failed to load room photo evidence:', error);
      toast.error('Could not load room photos');
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    if (!open) return;
    setCurrentCategoryIndex(0);
    setSkipCategory(null);
    setSkipReason('guest_limited_service');
    setSkipDetail('');
    void loadExisting();
  }, [open, loadExisting]);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const persistPhotos = useCallback(async (
    updater: (current: string[]) => string[],
  ): Promise<string[]> => {
    if (!assignmentId) return photos;
    const { data: fresh, error: fetchError } = await supabase
      .from('room_assignments')
      .select('completion_photos')
      .eq('id', assignmentId)
      .single();
    if (fetchError) throw fetchError;
    const current = (fresh?.completion_photos || []) as string[];
    const next = updater(current);
    const { error: updateError } = await supabase
      .from('room_assignments')
      .update({ completion_photos: next })
      .eq('id', assignmentId);
    if (updateError) throw updateError;
    setPhotos(next);
    return next;
  }, [assignmentId, photos]);

  const updateLimitedNotes = useCallback(async (
    mode: 'ensure' | 'remove' | 'detail',
    detail?: string,
  ) => {
    if (!assignmentId) return;
    const { data, error } = await supabase
      .from('room_assignments')
      .select('notes')
      .eq('id', assignmentId)
      .single();
    if (error) throw error;

    const current = String(data?.notes || '');
    const base = stripLimitedLines(current);
    let next = base;

    if (mode === 'ensure') {
      next = [base, limitedMarkerLine()].filter(Boolean).join('\n');
    } else if (mode === 'detail') {
      next = [base, limitedMarkerLine(), `${LIMITED_SERVICE_DETAIL_MARKER} ${String(detail || '').trim()}`]
        .filter(Boolean)
        .join('\n');
    }

    const { error: updateError } = await supabase
      .from('room_assignments')
      .update({ notes: next })
      .eq('id', assignmentId);
    if (updateError) throw updateError;
  }, [assignmentId]);

  const uploadBlob = useCallback(async (
    category: PhotoCategory,
    blob: Blob,
    extension: string,
    suffix: string,
    contentType: string,
  ): Promise<string> => {
    if (!user?.id) throw new Error('No signed-in housekeeper');
    const safeRoom = sanitizePathPart(roomNumber || 'room');
    const random = Math.random().toString(36).slice(2, 8);
    const path = `${user.id}/${safeRoom}/${category}_${suffix}_${Date.now()}_${random}.${extension}`;
    const { data, error } = await supabase.storage.from('room-photos').upload(path, blob, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw error;
    return supabase.storage.from('room-photos').getPublicUrl(data.path).data.publicUrl;
  }, [roomNumber, user?.id]);

  const saveRealPhoto = useCallback(async (category: PhotoCategory, blob: Blob) => {
    setBusy(true);
    try {
      const url = await uploadBlob(category, blob, 'jpg', 'photo', 'image/jpeg');
      const next = await persistPhotos((current) => [
        ...current.filter((item) => !(categoryFromUrl(item) === category && isSkipEvidence(item))),
        url,
      ]);

      const stillHasSkips = next.some(isSkipEvidence);
      if (!stillHasSkips) await updateLimitedNotes('remove');

      toast.success(`${t(PHOTO_CATEGORIES.find((item) => item.key === category)?.translationKey || '')} ✓`);
    } catch (error) {
      console.error('Photo upload failed:', error);
      toast.error('Could not save photo');
    } finally {
      setBusy(false);
    }
  }, [persistPhotos, t, updateLimitedNotes, uploadBlob]);

  const startCamera = useCallback(async () => {
    try {
      setCameraLoading(true);
      setShowCamera(true);
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      console.error('Camera access failed:', error);
      stopCamera();
      toast.error(copy.cameraError);
    } finally {
      setCameraLoading(false);
    }
  }, [copy.cameraError, stopCamera]);

  const capturePhoto = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    canvas.width = 0;
    canvas.height = 0;
    stopCamera();
    if (!blob) {
      toast.error('Could not capture photo');
      return;
    }
    await saveRealPhoto(currentCategory.key, blob);
    if (currentCategoryIndex < PHOTO_CATEGORIES.length - 1) {
      setCurrentCategoryIndex((index) => index + 1);
    }
  }, [currentCategory.key, currentCategoryIndex, saveRealPhoto, stopCamera]);

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image');
      return;
    }
    await saveRealPhoto(currentCategory.key, file);
    if (currentCategoryIndex < PHOTO_CATEGORIES.length - 1) {
      setCurrentCategoryIndex((index) => index + 1);
    }
  };

  const makeSkipEvidenceSvg = useCallback((
    category: PhotoCategory,
    reason: SkipReason,
    detail: string,
  ): Blob => {
    const categoryInfo = PHOTO_CATEGORIES.find((item) => item.key === category);
    const categoryLabel = categoryInfo ? t(categoryInfo.translationKey) : category;
    const reasonLabel = reasonLabels[reason] || reasonLabels.other;
    const detailText = detail.trim() || '—';
    const now = new Date().toLocaleString();
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <rect width="1200" height="800" fill="#f8fafc"/>
  <rect x="70" y="70" width="1060" height="660" rx="36" fill="#ffffff" stroke="#cbd5e1" stroke-width="4"/>
  <circle cx="170" cy="175" r="55" fill="#fef3c7"/>
  <text x="170" y="195" text-anchor="middle" font-size="54" font-family="Arial, sans-serif">↷</text>
  <text x="255" y="155" font-size="34" font-weight="700" font-family="Arial, sans-serif" fill="#0f172a">Photo intentionally skipped</text>
  <text x="255" y="205" font-size="25" font-family="Arial, sans-serif" fill="#475569">Limited daily-room service evidence</text>
  <text x="120" y="315" font-size="24" font-weight="700" font-family="Arial, sans-serif" fill="#334155">Room</text>
  <text x="350" y="315" font-size="24" font-family="Arial, sans-serif" fill="#0f172a">${escapeXml(roomNumber)}</text>
  <text x="120" y="380" font-size="24" font-weight="700" font-family="Arial, sans-serif" fill="#334155">Section</text>
  <text x="350" y="380" font-size="24" font-family="Arial, sans-serif" fill="#0f172a">${escapeXml(categoryLabel)}</text>
  <text x="120" y="445" font-size="24" font-weight="700" font-family="Arial, sans-serif" fill="#334155">Reason</text>
  <text x="350" y="445" font-size="24" font-family="Arial, sans-serif" fill="#0f172a">${escapeXml(reasonLabel)}</text>
  <text x="120" y="510" font-size="24" font-weight="700" font-family="Arial, sans-serif" fill="#334155">Detail</text>
  <text x="350" y="510" font-size="22" font-family="Arial, sans-serif" fill="#475569">${escapeXml(detailText).slice(0, 80)}</text>
  <text x="120" y="575" font-size="24" font-weight="700" font-family="Arial, sans-serif" fill="#334155">Recorded</text>
  <text x="350" y="575" font-size="22" font-family="Arial, sans-serif" fill="#475569">${escapeXml(now)}</text>
  <rect x="120" y="635" width="960" height="52" rx="16" fill="#fff7ed"/>
  <text x="600" y="668" text-anchor="middle" font-size="19" font-family="Arial, sans-serif" fill="#9a3412">This evidence does not represent a full room clean.</text>
</svg>`;
    return new Blob([svg], { type: 'image/svg+xml' });
  }, [reasonLabels, roomNumber, t]);

  const confirmSkip = async () => {
    if (!skipCategory || !skipAllowed) return;
    if (skipReason === 'other' && skipDetail.trim().length < 3) {
      toast.error('Please add a short reason');
      return;
    }

    setBusy(true);
    try {
      const svg = makeSkipEvidenceSvg(skipCategory, skipReason, skipDetail);
      const url = await uploadBlob(
        skipCategory,
        svg,
        'svg',
        `skipped_${skipReason}`,
        'image/svg+xml',
      );

      await persistPhotos((current) => [
        ...current.filter((item) => categoryFromUrl(item) !== skipCategory),
        url,
      ]);
      await updateLimitedNotes('ensure');

      toast.success(copy.skipSaved);
      setSkipCategory(null);
      setSkipReason('guest_limited_service');
      setSkipDetail('');
      if (currentCategoryIndex < PHOTO_CATEGORIES.length - 1) {
        setCurrentCategoryIndex((index) => index + 1);
      }
    } catch (error) {
      console.error('Could not record photo skip:', error);
      toast.error('Could not record skip reason');
    } finally {
      setBusy(false);
    }
  };

  const undoSkip = async (category: PhotoCategory) => {
    setBusy(true);
    try {
      const next = await persistPhotos((current) =>
        current.filter((item) => !(categoryFromUrl(item) === category && isSkipEvidence(item))),
      );
      if (!next.some(isSkipEvidence)) {
        await updateLimitedNotes('remove');
        setLimitedServiceNote('');
      }
      toast.success(copy.skipRemoved);
    } catch (error) {
      console.error('Could not remove skip:', error);
      toast.error('Could not remove skip');
    } finally {
      setBusy(false);
    }
  };

  const finishEvidence = async () => {
    if (!allResolved) {
      toast.error(copy.incomplete);
      return;
    }
    if (anySkipped && limitedServiceNote.trim().length < 3) {
      toast.error(copy.noteRequired);
      return;
    }

    setBusy(true);
    try {
      if (anySkipped) {
        await updateLimitedNotes('detail', limitedServiceNote);
      } else {
        await updateLimitedNotes('remove');
      }
      await onPhotoCaptured?.();
      toast.success(copy.saved);
      stopCamera();
      onOpenChange(false);
    } catch (error) {
      console.error('Could not finalize room evidence:', error);
      toast.error('Could not save room evidence');
    } finally {
      setBusy(false);
    }
  };

  const requestClose = () => {
    stopCamera();
    if (resolvedCount > 0 && !allResolved) {
      setShowExitWarning(true);
      return;
    }
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else requestClose();
      }}>
        <DialogContent className="w-[calc(100vw-0.75rem)] max-w-2xl max-h-[94dvh] overflow-hidden p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 pr-8 text-lg">
              <Camera className="h-5 w-5 text-primary" />
              {copy.title} — {roomNumber}
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto px-4 py-4 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5">
              <p className="text-sm font-medium text-foreground">{copy.intro}</p>
              <p className="text-xs text-muted-foreground">{copy.strict}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">{resolvedCount} / {PHOTO_CATEGORIES.length} {copy.resolved}</span>
                <Badge variant={anySkipped ? 'outline' : allResolved ? 'default' : 'secondary'}>
                  {anySkipped ? copy.limited : copy.fullClean}
                </Badge>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {loading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">{copy.loading}</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PHOTO_CATEGORIES.map((category, index) => {
                  const Icon = category.icon;
                  const evidence = evidenceByCategory[category.key];
                  const hasReal = evidence.real.length > 0;
                  const hasSkip = evidence.skipped.length > 0;
                  const skippedReason = hasSkip ? skipReasonFromUrl(evidence.skipped[0]) : null;
                  const preview = hasReal ? evidence.real[0] : hasSkip ? evidence.skipped[0] : null;

                  return (
                    <div
                      key={category.key}
                      className={cn(
                        'rounded-2xl border p-3 space-y-3 transition-colors',
                        currentCategoryIndex === index && 'ring-2 ring-primary/30',
                        hasReal && 'border-emerald-300 bg-emerald-50/30 dark:bg-emerald-950/10',
                        hasSkip && 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/10',
                      )}
                      onClick={() => setCurrentCategoryIndex(index)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
                            <Icon className="h-4 w-4 text-primary" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight">{t(category.translationKey)}</p>
                            {hasSkip && skippedReason && (
                              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5 leading-tight">
                                {reasonLabels[skippedReason]}
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge variant={hasReal ? 'default' : hasSkip ? 'outline' : 'secondary'} className="text-[10px] shrink-0">
                          {hasReal ? copy.photo : hasSkip ? copy.skipped : copy.required}
                        </Badge>
                      </div>

                      {preview && (
                        <div className="overflow-hidden rounded-xl border bg-background aspect-video">
                          <img src={preview} alt={t(category.translationKey)} className="h-full w-full object-cover" loading="lazy" />
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            setCurrentCategoryIndex(index);
                            void startCamera();
                          }}
                          className="min-h-10 whitespace-normal"
                        >
                          <Camera className="h-4 w-4 mr-1.5 shrink-0" />
                          {copy.capture}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            setCurrentCategoryIndex(index);
                            setTimeout(() => fileInputRef.current?.click(), 0);
                          }}
                          className="min-h-10 whitespace-normal"
                        >
                          <Upload className="h-4 w-4 mr-1.5 shrink-0" />
                          {copy.choose}
                        </Button>

                        {skipAllowed && !hasReal && !hasSkip && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={(event) => {
                              event.stopPropagation();
                              setCurrentCategoryIndex(index);
                              setSkipCategory(category.key);
                              setSkipReason('guest_limited_service');
                              setSkipDetail('');
                            }}
                            className="min-h-10 text-amber-700 hover:text-amber-800 hover:bg-amber-50 whitespace-normal"
                          >
                            <SkipForward className="h-4 w-4 mr-1.5 shrink-0" />
                            {copy.skip}
                          </Button>
                        )}

                        {hasSkip && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={(event) => {
                              event.stopPropagation();
                              void undoSkip(category.key);
                            }}
                            className="min-h-10 text-muted-foreground whitespace-normal"
                          >
                            <RotateCcw className="h-4 w-4 mr-1.5 shrink-0" />
                            {copy.undoSkip}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {anySkipped && (
              <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-amber-950 dark:text-amber-100">{copy.limitedTitle}</p>
                    <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">{copy.limitedInfo}</p>
                  </div>
                </div>
                <Textarea
                  value={limitedServiceNote}
                  onChange={(event) => setLimitedServiceNote(event.target.value)}
                  placeholder={copy.limitedPlaceholder}
                  rows={3}
                  className="bg-background"
                />
              </div>
            )}

            {!allResolved && resolvedCount > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-3">
                <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-200">{copy.incomplete}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 border-t bg-background p-4">
            <Button
              onClick={finishEvidence}
              disabled={busy || loading || !allResolved || (anySkipped && limitedServiceNote.trim().length < 3)}
              className="min-h-11"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {busy ? '…' : copy.done}
            </Button>
            <Button variant="outline" onClick={requestClose} disabled={busy} className="min-h-11">
              <X className="h-4 w-4 mr-1" />
              {t('common.cancel')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileSelected}
      />

      <AlertDialog open={showCamera} onOpenChange={(next) => { if (!next) stopCamera(); }}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-xl p-3 sm:p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>{t(currentCategory.translationKey)} — {roomNumber}</AlertDialogTitle>
            <AlertDialogDescription>{copy.capture}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="overflow-hidden rounded-xl bg-black aspect-[3/4] sm:aspect-video flex items-center justify-center">
            <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <AlertDialogFooter className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AlertDialogCancel onClick={stopCamera}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void capturePhoto()} disabled={cameraLoading || busy}>
              <Camera className="h-4 w-4 mr-2" />
              {cameraLoading ? '…' : copy.capture}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!skipCategory} onOpenChange={(next) => { if (!next) setSkipCategory(null); }}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.skipTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.skipDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{copy.reason}</Label>
              <Select value={skipReason} onValueChange={(value) => setSkipReason(value as SkipReason)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(reasonLabels) as SkipReason[]).map((reason) => (
                    <SelectItem key={reason} value={reason}>{reasonLabels[reason]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{copy.detail}</Label>
              <Textarea
                value={skipDetail}
                onChange={(event) => setSkipDetail(event.target.value)}
                rows={2}
                placeholder={skipReason === 'other' ? 'Required for Other' : ''}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmSkip()} disabled={busy}>
              <SkipForward className="h-4 w-4 mr-2" />
              {copy.confirmSkip}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showExitWarning} onOpenChange={setShowExitWarning}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.exitTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.exitDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowExitWarning(false); onOpenChange(false); }}>
              {copy.leave}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
