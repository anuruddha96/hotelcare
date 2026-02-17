import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Download, Search, QrCode, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';

interface Room {
  id: string;
  room_number: string;
  hotel: string;
  minibar_qr_token: string;
}

interface MinibarQRManagementProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MinibarQRManagement({ open, onOpenChange }: MinibarQRManagementProps) {
  const { profile } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) fetchRooms();
  }, [open]);

  const getBaseUrl = () => 'https://hotelcare.lovable.app';

  const getOrgSlug = () => profile?.organization_slug || 'rdhotels';

  const fetchRooms = async () => {
    setLoading(true);

    // Resolve hotel display name from hotel_configurations
    const userHotel = profile?.assigned_hotel;
    let resolvedHotelName = userHotel;
    if (userHotel) {
      const { data: hotelConfig } = await supabase
        .from('hotel_configurations')
        .select('hotel_name')
        .eq('hotel_id', userHotel)
        .maybeSingle();
      if (hotelConfig?.hotel_name) {
        resolvedHotelName = hotelConfig.hotel_name;
      }
    }

    const query = supabase
      .from('rooms')
      .select('id, room_number, hotel, minibar_qr_token')
      .not('minibar_qr_token' as any, 'is', null)
      .order('room_number');

    if (userHotel) {
      if (resolvedHotelName && resolvedHotelName !== userHotel) {
        query.or(`hotel.eq.${userHotel},hotel.eq.${resolvedHotelName}`);
      } else {
        query.eq('hotel', userHotel);
      }
    }

    const { data } = await query;
    const roomData = (data || []) as any as Room[];
    setRooms(roomData);

    // Generate QR data URLs
    const urls: Record<string, string> = {};
    for (const room of roomData) {
      const url = `${getBaseUrl()}/${getOrgSlug()}/minibar/${room.minibar_qr_token}`;
      try {
        urls[room.id] = await QRCode.toDataURL(url, { width: 200, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
      } catch { /* skip */ }
    }
    setQrUrls(urls);
    setLoading(false);
  };

  const downloadSingleQR = async (room: Room) => {
    const url = `${getBaseUrl()}/${getOrgSlug()}/minibar/${room.minibar_qr_token}`;
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 });
      const link = document.createElement('a');
      link.download = `minibar-qr-room-${room.room_number}.png`;
      link.href = dataUrl;
      link.click();
    } catch { /* skip */ }
  };

  const downloadAllQRs = async () => {
    setDownloading(true);
    try {
      const filteredRooms = getFilteredRooms();
      const cols = 4;
      const qrSize = 200;
      const labelH = 30;
      const padding = 20;
      const cellW = qrSize + padding;
      const cellH = qrSize + labelH + padding;
      const rows = Math.ceil(filteredRooms.length / cols);

      const canvas = document.createElement('canvas');
      canvas.width = cols * cellW + padding;
      canvas.height = rows * cellH + padding + 40;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Title
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 18px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Minibar QR Codes', canvas.width / 2, 30);

      for (let i = 0; i < filteredRooms.length; i++) {
        const room = filteredRooms[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = padding + col * cellW;
        const y = 40 + padding + row * cellH;

        const url = `${getBaseUrl()}/${getOrgSlug()}/minibar/${room.minibar_qr_token}`;
        const dataUrl = await QRCode.toDataURL(url, { width: qrSize, margin: 1 });
        const img = await loadImage(dataUrl);
        ctx.drawImage(img, x, y, qrSize, qrSize);

        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`Room ${room.room_number}`, x + qrSize / 2, y + qrSize + 18);
      }

      const link = document.createElement('a');
      link.download = 'minibar-qr-codes-all.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('Error downloading QRs:', e);
    } finally {
      setDownloading(false);
    }
  };

  const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  const getFilteredRooms = () =>
    rooms.filter(r => r.room_number.toLowerCase().includes(search.toLowerCase()));

  const filtered = getFilteredRooms();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Minibar QR Codes
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search rooms..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Button onClick={downloadAllQRs} disabled={downloading || filtered.length === 0}>
            {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Download All ({filtered.length})
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No rooms found</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-1">
              {filtered.map(room => (
                <div key={room.id} className="border rounded-lg p-3 text-center space-y-2 bg-card hover:shadow-md transition-shadow">
                  {qrUrls[room.id] ? (
                    <img src={qrUrls[room.id]} alt={`QR Room ${room.room_number}`} className="mx-auto w-32 h-32" />
                  ) : (
                    <div className="mx-auto w-32 h-32 bg-muted rounded flex items-center justify-center">
                      <QrCode className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <p className="font-semibold text-sm">Room {room.room_number}</p>
                  <Button size="sm" variant="outline" onClick={() => downloadSingleQR(room)} className="w-full text-xs">
                    <Download className="h-3 w-3 mr-1" />Download
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
