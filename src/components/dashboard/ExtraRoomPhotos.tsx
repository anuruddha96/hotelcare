import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Camera, ImagePlus, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { verifiedBedPhotoHint } from '@/lib/housekeepingRoomSizing';

const categories = [
  ['bed', 'Bedroom / beds'], ['bathroom', 'Bathroom'], ['trash_bin', 'Trash bin'],
  ['minibar', 'Minibar'], ['tea_coffee_table', 'Tea / coffee'],
] as const;
type Category = (typeof categories)[number][0];
function categoryOf(url: string): Category | null {
  const name = decodeURIComponent(url.split('?')[0].split('/').pop() || '');
  return categories.find(([key]) => name.startsWith(`${key}_`))?.[0] || null;
}
function isSkip(url: string) { return url.includes('_skipped_'); }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId?: string;
  roomNumber: string;
  onSaved?: () => void;
}

/** A companion to the existing five-photo/limited-service dialog: append only.
 * It never changes cleaning status, skip reasons, notes, or PMS state. */
export function ExtraRoomPhotos({ open, onOpenChange, assignmentId, roomNumber, onSaved }: Props) {
  const { user } = useAuth();
  const { language } = useTranslation();
  const hu = language === 'hu';
  const [category, setCategory] = useState<Category>('bed');
  const [photos, setPhotos] = useState<string[]>([]);
  const [bedCount, setBedCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !assignmentId) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      const { data, error } = await (supabase as any).from('room_assignments')
        .select('completion_photos,rooms(verified_bed_count)').eq('id', assignmentId).single();
      if (cancelled) return;
      if (error) toast.error(hu ? 'A fotók nem tölthetők be' : 'Could not load photos');
      else {
        setPhotos(data?.completion_photos || []);
        setBedCount(verifiedBedPhotoHint(data?.rooms?.verified_bed_count));
      }
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [open, assignmentId, hu]);

  const upload = async (file: File) => {
    if (!assignmentId || !user?.id || busy) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      toast.error(hu ? 'JPG, PNG vagy WebP, legfeljebb 10 MB' : 'Use JPG, PNG or WebP, up to 10 MB');
      return;
    }
    setBusy(true);
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const safeRoom = roomNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    const path = `${user.id}/${safeRoom}/${category}_photo_angle_${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
    let uploaded = false;
    try {
      const result = await supabase.storage.from('room-photos').upload(path, file, { upsert: false, contentType: file.type });
      if (result.error) throw result.error;
      uploaded = true;
      const publicUrl = supabase.storage.from('room-photos').getPublicUrl(path).data.publicUrl;
      // Atomic DB-side append prevents another housekeeper's images from being
      // replaced by a stale completion_photos array from this optional UI.
      const { data, error } = await (supabase as any).rpc('append_housekeeping_photo_angle', {
        p_assignment_id: assignmentId, p_path: path, p_photo_url: publicUrl,
      });
      if (error) throw error;
      setPhotos((data || []) as string[]);
      toast.success(hu ? 'Fotó mentve' : 'Photo saved');
      onSaved?.();
    } catch (error) {
      console.error('Additional room photo upload failed', error);
      if (uploaded) await supabase.storage.from('room-photos').remove([path]).catch(() => undefined);
      toast.error(hu ? 'Nem sikerült menteni. Próbáld újra.' : 'Could not save. Please retry.');
    } finally { setBusy(false); }
  };

  const displayed = photos.filter(url => categoryOf(url) === category && !isSkip(url));
  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="w-[calc(100vw-0.75rem)] max-w-xl max-h-[92dvh] flex flex-col overflow-hidden p-4 gap-3">
      <DialogHeader><DialogTitle className="pr-8">{hu ? 'További fotók' : 'More room photos'} · {roomNumber}</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">{hu ? 'Készíts több képet, akár több szögből. A már meglévő fotók megmaradnak.' : 'Take as many extra angles as needed. Existing photos stay saved.'}</p>
      {bedCount && <p className="text-xs font-medium">{hu ? 'Igazolt ágyak' : 'Manager-confirmed beds'}: {bedCount} · {hu ? 'fotózhatod az egyes ágyakat külön is' : 'capture each bed from any angle'}</p>}
      <Select value={category} onValueChange={value => setCategory(value as Category)} disabled={busy}>
        <SelectTrigger aria-label={hu ? 'Fotó kategóriája' : 'Photo category'}><SelectValue /></SelectTrigger>
        <SelectContent>{categories.map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
        <p className="text-sm font-semibold">{hu ? 'Mentett fotók' : 'Saved photos'} · {displayed.length}</p>
        {loading ? <p role="status">Loading…</p> : <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {displayed.map((url, index) => <a href={url} key={`${url}-${index}`} target="_blank" rel="noreferrer" className="rounded-lg border overflow-hidden aspect-square" aria-label={`View ${category} photo ${index + 1}`}>
            <img src={url} alt={`${category} · ${index + 1}`} className="h-full w-full object-cover" loading="lazy" />
          </a>)}
          {displayed.length === 0 && <p className="text-xs text-muted-foreground col-span-full">{hu ? 'Még nincs fotó ebben a kategóriában.' : 'No photos in this category yet.'}</p>}
        </div>}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden"
        aria-label={hu ? 'Fotó készítése' : 'Capture extra photo'} onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }} />
      <Button disabled={busy || loading || !assignmentId} onClick={() => input.current?.click()} className="w-full min-h-12">
        {displayed.length ? <ImagePlus className="h-4 w-4 mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
        {busy ? (hu ? 'Mentés…' : 'Saving…') : displayed.length ? (hu ? 'Újabb fotó hozzáadása' : 'Add another photo / angle') : (hu ? 'Fotó készítése' : 'Take photo')}
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)} className="w-full min-h-11"><ArrowLeft className="h-4 w-4 mr-2" />{hu ? 'Vissza az ellenőrzőlistához' : 'Back to checklist'}</Button>
    </DialogContent>
  </Dialog>;
}
