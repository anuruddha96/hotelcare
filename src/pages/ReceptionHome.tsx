import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { supabase } from '@/integrations/supabase/client';
import { usePMSHotelContext } from '@/hooks/usePMSHotelContext';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import FrontDesk from './FrontDesk';

function tomorrowISO() { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }

function BreakfastUpload() {
  const { selectedHotelId, selectedHotel } = usePMSHotelContext();
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(tomorrowISO());
  const [busy, setBusy] = useState(false);
  const onDrop = useCallback((accepted: File[]) => accepted[0] && setFile(accepted[0]), []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] }, multiple: false });
  const upload = async () => {
    if (!file || !selectedHotelId) return;
    setBusy(true);
    const body = new FormData(); body.append('file', file); body.append('date', date); body.append('hotel_id', selectedHotelId);
    const { data, error } = await supabase.functions.invoke('breakfast-roster-upload', { body });
    setBusy(false);
    if (error || data?.success === false || data?.error) { toast.error(data?.error || error?.message || 'Upload failed'); return; }
    toast.success(`Uploaded ${data?.rows || 0} rows`); setFile(null);
  };
  return <div className="min-h-screen bg-background"><Header /><PMSNavigation /><main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
    <div><h1 className="text-2xl font-bold">Daily Overview</h1><p className="text-sm text-muted-foreground">{selectedHotel?.hotel_name || selectedHotelId || ''}</p></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" />Previo XLSX</CardTitle></CardHeader><CardContent className="space-y-4">
      <div><Label>Breakfast date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div {...getRootProps()} className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer ${isDragActive ? 'border-primary bg-primary/5' : 'border-border'}`}><input {...getInputProps()} /><FileSpreadsheet className="h-10 w-10 mx-auto mb-2 text-muted-foreground" /><p className="font-medium">{file?.name || 'Drag & drop or choose the Daily Overview XLSX'}</p></div>
      <Button className="w-full" size="lg" onClick={upload} disabled={!file || !selectedHotelId || busy}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}Upload</Button>
    </CardContent></Card>
  </main></div>;
}

export default function ReceptionHome() {
  const { pathname } = useLocation();
  if (pathname.endsWith('/reception/breakfast-upload')) return <BreakfastUpload />;
  return <FrontDesk />;
}
