import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, RefreshCw, Users, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { CheckoutRoomsView } from './CheckoutRoomsView';
import { PMSUploadHistoryDialog } from './PMSUploadHistoryDialog';
import { PMSSyncHistoryDialog } from './PMSSyncHistoryDialog';
import * as XLSX from 'xlsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface PMSData {
  [key: string]: any;
}

// Dynamic column mapping: maps expected fields to actual header names found in the file
interface ColumnMap {
  Room: string | null;
  Occupied: string | null;
  Departure: string | null;
  Arrival: string | null;
  People: string | null;
  NightTotal: string | null;
  Note: string | null;
  Nationality: string | null;
  Defect: string | null;
  Status: string | null;
}

// Fuzzy match a header to expected column names
function fuzzyMatchColumn(header: string, patterns: string[]): boolean {
  // Normalize: lowercase, remove BOM/invisible chars, remove hyphens/underscores/dots, collapse spaces
  const normalized = header.trim().toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF\uFFFE\u00A0]/g, '')
    .replace(/[-_./\\]/g, '')
    .replace(/\s+/g, '');
  return patterns.some(p => {
    const normP = p.toLowerCase().replace(/[-_./\\]/g, '').replace(/\s+/g, '');
    return normalized.includes(normP) || normP.includes(normalized);
  });
}

function buildColumnMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {
    Room: null, Occupied: null, Departure: null, Arrival: null,
    People: null, NightTotal: null, Note: null, Nationality: null,
    Defect: null, Status: null
  };

  const matchers: Record<keyof ColumnMap, string[]> = {
    Room: ['room', 'szoba', 'pokoj', 'habitación', 'zimmer', 'phòng', 'camera', 'stanza', 'nr', 'číslo'],
    Occupied: ['occupied', 'foglalt', 'obsazeno', 'ocupado', 'belegt', 'occupato', 'occupata', 'occ'],
    Departure: ['departure', 'távozás', 'elutazás', 'elutazas', 'elutaz', 'odjezd', 'salida', 'abreise', 'checkout', 'check-out', 'check out', 'partenza', 'dep', 'odchod', 'výjezd', 'co time', 'co-time'],
    Arrival: ['arrival', 'érkezés', 'příjezd', 'llegada', 'anreise', 'checkin', 'check-in', 'check in', 'arrivo', 'arr', 'příchod'],
    People: ['people', 'személy', 'osoby', 'personas', 'personen', 'guests', 'fő', 'persone', 'ospiti', 'pax', 'pers', 'vendégek', 'vendeg', 'guest'],
    NightTotal: ['night', 'éjszaka', 'éj', 'noc', 'noche', 'nacht', 'total', 'összes', 'osszes', 'notte', 'notti'],
    Note: ['note', 'megjegyzés', 'poznámka', 'nota', 'bemerkung', 'comment', 'remark', 'poznámky'],
    Nationality: ['nationality', 'nemzetiség', 'národnost', 'nacionalidad', 'nationalität', 'nazionalità', 'nazione'],
    Defect: ['defect', 'hiba', 'závada', 'defecto', 'mangel', 'difetto', 'guasto'],
    Status: ['status', 'állapot', 'stav', 'estado', 'zustand', 'stato']
  };

  for (const header of headers) {
    const clean = header.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
    for (const [field, patterns] of Object.entries(matchers)) {
      if (!map[field as keyof ColumnMap] && fuzzyMatchColumn(clean, patterns)) {
        map[field as keyof ColumnMap] = header; // Use original header as key
        break;
      }
    }
  }

  // Fallback: try exact match with common variants
  if (!map.NightTotal) {
    const nightTotalVariants = ['Night / Total', 'Night/Total', 'Night/ Total', 'Night /Total', 'Éj / Összes', 'Éj/Összes', 'Ej / Osszes', 'Ej/Osszes'];
    for (const header of headers) {
      if (nightTotalVariants.includes(header.trim())) {
        map.NightTotal = header;
        break;
      }
    }
  }

  return map;
}

function getField(row: PMSData, columnMap: ColumnMap, field: keyof ColumnMap): any {
  const actualKey = columnMap[field];
  if (!actualKey) return undefined;
  return row[actualKey];
}

// Convert Excel serial time numbers to HH:MM strings
function excelTimeToString(val: any): string | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    const totalMinutes = Math.round(val * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  const str = String(val).trim();
  return str === '' ? null : str;
}

// Case-insensitive, multi-language occupied check
function isOccupiedYes(val: any): boolean {
  if (val === true) return true;
  if (val === undefined || val === null) return false;
  const s = String(val).trim().toLowerCase();
  return ['yes', 'igen', 'ano', 'si', 'ja', 'true', '1'].includes(s);
}

function isOccupiedNo(val: any): boolean {
  if (val === false) return true;
  if (val === undefined || val === null) return false;
  const s = String(val).trim().toLowerCase();
  return ['no', 'nem', 'ne', 'nein', 'false', '0'].includes(s);
}

function parseNightTotal(val: any): { currentNight: number; totalNights: number } | null {
  if (val === undefined || val === null) return null;

  const raw = String(val).trim();
  if (!raw) return null;

  const slashMatch = raw.match(/(\d+)\s*[\/\\-]\s*(\d+)/);
  if (slashMatch) {
    const currentNight = Number.parseInt(slashMatch[1], 10);
    const totalNights = Number.parseInt(slashMatch[2], 10);
    if (Number.isFinite(currentNight) && Number.isFinite(totalNights) && currentNight > 0 && totalNights > 0) {
      return { currentNight, totalNights };
    }
  }

  const numberParts = raw.match(/\d+/g);
  if (numberParts && numberParts.length >= 2) {
    const currentNight = Number.parseInt(numberParts[0], 10);
    const totalNights = Number.parseInt(numberParts[1], 10);
    if (Number.isFinite(currentNight) && Number.isFinite(totalNights) && currentNight > 0 && totalNights > 0) {
      return { currentNight, totalNights };
    }
  }

  return null;
}

interface PMSUploadProps {
  onNavigateToTeamView?: () => void;
}

export function PMSUpload({ onNavigateToTeamView }: PMSUploadProps = {}) {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const userRole = profile?.role;
  const selectedHotel = profile?.assigned_hotel; // Get selected hotel from profile
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [backgroundUpload, setBackgroundUpload] = useState(false);
  const [checkoutRooms, setCheckoutRooms] = useState<any[]>([]);
  const [dailyCleaningRooms, setDailyCleaningRooms] = useState<any[]>([]);
  const [results, setResults] = useState<{
    processed: number;
    updated: number;
    assigned: number;
    errors: string[];
  } | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [syncHistoryDialogOpen, setSyncHistoryDialogOpen] = useState(false);
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isSyncingPrevio, setIsSyncingPrevio] = useState(false);
  const [previoSyncEnabled, setPrevioSyncEnabled] = useState(false);
  const [resolvedHotelName, setResolvedHotelName] = useState<string | undefined>(undefined);

  // Resolve hotel slug to full hotel name for filtering
  useEffect(() => {
    if (!selectedHotel) return;
    const resolve = async () => {
      const { data: hotelConfig } = await supabase
        .from('hotel_configurations')
        .select('hotel_name')
        .eq('hotel_id', selectedHotel)
        .maybeSingle();
      setResolvedHotelName(hotelConfig?.hotel_name || selectedHotel);
    };
    resolve();
  }, [selectedHotel]);

  // Handle background processing notifications
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && backgroundUpload) {
        // User came back, check if background upload is still running
        toast.info('PMS upload is still processing in the background...');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [backgroundUpload]);

  // Check if this is the first upload of the day
  const checkFirstUploadToday = (): boolean => {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const lastUploadDate = localStorage.getItem('pms_last_upload_date');
    return lastUploadDate !== today;
  };

  // Mark today as having an upload
  const markUploadToday = () => {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem('pms_last_upload_date', today);
  };

  // Enhanced room number extraction based on provided mappings
  const extractRoomNumber = (roomName: string): string => {
    const originalName = roomName;
    
    // Clean and normalize the input
    let cleanName = roomName.trim();
    
    // Handle specific patterns based on provided mappings
    
    // Pattern 1: Q-XXX format (e.g., "Q-101" -> "101")
    let match = cleanName.match(/^Q-(\d{3})$/);
    if (match) {
      return match[1];
    }
    
    // Pattern 2: DB/TW-XXX format (e.g., "DB/TW-102" -> "102")
    match = cleanName.match(/^DB\/TW-(\d{3})$/);
    if (match) {
      return match[1];
    }
    
    // Pattern 3: QRP rooms (e.g., "66EC.QRP216" -> "216")
    match = cleanName.match(/QRP(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Pattern 4: SNG rooms (e.g., "70SNG-306" -> "306")
    match = cleanName.match(/\d+SNG-(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Pattern 5: ECDBL rooms (e.g., "71ECDBL-308" -> "308") 
    match = cleanName.match(/\d+ECDBL-(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Pattern 6: QUEEN rooms with or without SH (e.g., "1QUEEN-002", "4QUEEN-008SH" -> "002", "008")
    match = cleanName.match(/\d+QUEEN-(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 7: TWIN rooms with or without SH (e.g., "7TWIN-034SH", "8TWIN-036" -> "034", "036")
    match = cleanName.match(/\d+TWIN-(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 8: DOUBLE rooms (e.g., "16DOUBLE-104", "39DOUBLE-135" -> "104", "135")
    match = cleanName.match(/\d+DOUBLE-(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Pattern 9: SYN.TWIN rooms with or without SH (e.g., "13SYN.TWIN-101", "21SYN.TWIN-109SH" -> "101", "109")
    match = cleanName.match(/\d+SYN\.TWIN-(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 10: SYN.DOUBLE rooms with or without SH (e.g., "15SYN.DOUBLE-103", "19SYN.DOUBLE-107SH" -> "103", "107")
    match = cleanName.match(/\d+SYN\.DOUBLE-(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 11: TRP rooms with or without SH (e.g., "3TRP-006", "59TRP-209SH", "TRP-105" -> "006", "209", "105")
    match = cleanName.match(/(?:\d+)?TRP-?(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 12: CQ rooms (Comfort Queen) (e.g., "CQ-405" -> "405")
    match = cleanName.match(/CQ-(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Pattern 13: QRP rooms (Quad Room Premium) (e.g., "QRP-406", "66EC.QRP216" -> "406", "216")
    match = cleanName.match(/QRP-?(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Pattern 14: QDR rooms (e.g., "9QDR-038", "26QDR-114" -> "038", "114")
    match = cleanName.match(/\d+QDR-(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Fallback: Extract last 3-digit number after dash or period
    match = cleanName.match(/[-.](\d{3})(?:SH)?$/);
    if (match) {
      return match[1];
    }
    
    // Final fallback: Any 3-digit number at the end
    const fallbackMatch = cleanName.match(/(\d{3})(?:SH)?$/);
    return fallbackMatch ? fallbackMatch[1] : originalName;
  };

  const processFile = async (file: File) => {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast.error('Please upload an Excel file (.xlsx or .xls)');
      return;
    }

    setUploading(true);
    setProgress(0);
    setResults(null);

    // Check if user might navigate away and enable background processing
    const handleBeforeUnload = () => {
      if (uploading) {
        setBackgroundUpload(true);
        toast.info('Upload will continue in background. You will be notified when complete.');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData: PMSData[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });

      if (jsonData.length === 0) {
        toast.error('No data found in the Excel file');
        return;
      }

      // Build dynamic column map from actual headers
      const firstRow = jsonData[0];
      const headers = Object.keys(firstRow);
      const columnMap = buildColumnMap(headers);
      
      console.log('[PMS] Detected headers:', JSON.stringify(headers));
      console.log('[PMS] Column mapping:', JSON.stringify(columnMap));
      
      // Log first 2 rows raw data for debugging
      for (let dbgIdx = 0; dbgIdx < Math.min(2, jsonData.length); dbgIdx++) {
        const dbgRow = jsonData[dbgIdx];
        console.log(`[PMS] Raw row ${dbgIdx}:`, JSON.stringify(dbgRow));
        // Log each key-value pair to spot invisible chars
        Object.entries(dbgRow).forEach(([k, v]) => {
          console.log(`[PMS]   "${k}" (len=${k.length}, codes=${[...k].map(c => c.charCodeAt(0)).join(',')}) = "${v}"`);
        });
      }

      // Only warn if critical columns are missing
      if (!columnMap.Departure) {
        console.warn('[PMS] "Departure" column not detected — checkout rooms won\'t be identified. Headers:', headers.join(', '));
      }

      if (!columnMap.Room) {
        toast.error('Could not find "Room" column in the Excel file. Detected headers: ' + headers.join(', '));
        return;
      }

      setProgress(10);
      
      // ONE-TIME hotel name resolution FIRST before any reset queries
      // selectedHotel can be hotel_id (e.g. 'memories-budapest') or hotel_name (e.g. 'Hotel Memories Budapest')
      // rooms table stores 'hotel' as the full name, so we must resolve it first
      let hotelNameForFilter = selectedHotel;
      if (selectedHotel) {
        const { data: hotelConfig } = await supabase
          .from('hotel_configurations')
          .select('hotel_name')
          .eq('hotel_id', selectedHotel)
          .maybeSingle();
        hotelNameForFilter = hotelConfig?.hotel_name || selectedHotel;
        console.log(`[PMS] Resolved hotel filter: ${selectedHotel} -> ${hotelNameForFilter}`);
      }

      // Reset ONLY the selected hotel's current day room assignments since PMS upload will reset room data
      const today = new Date().toISOString().split('T')[0];
      
      if (hotelNameForFilter) {
        // First, get all room IDs for the selected hotel (use resolved name)
        const { data: selectedHotelRooms } = await supabase
          .from('rooms')
          .select('id')
          .eq('hotel', hotelNameForFilter);
        
        if (selectedHotelRooms && selectedHotelRooms.length > 0) {
          const roomIds = selectedHotelRooms.map(r => r.id);
          
          // Delete only assignments for THIS hotel's rooms
          const { error: resetError } = await supabase
            .from('room_assignments')
            .delete()
            .eq('assignment_date', today)
            .in('room_id', roomIds);
          
          if (resetError) {
            console.warn(`Error resetting room assignments for ${hotelNameForFilter}:`, resetError);
          } else {
            console.log(`Reset room assignments for ${hotelNameForFilter} today (${roomIds.length} rooms)`);
          }

          // Batch reset DND on ALL rooms for this hotel before processing
          const { error: dndResetError } = await supabase
            .from('rooms')
            .update({ is_dnd: false, dnd_marked_at: null, dnd_marked_by: null })
            .eq('hotel', hotelNameForFilter);
          
          if (dndResetError) {
            console.warn(`Error resetting DND for ${hotelNameForFilter}:`, dndResetError);
          } else {
            // Verify DND reset actually worked (detect silent RLS failures)
            const { count: dndStillOn } = await supabase
              .from('rooms')
              .select('id', { count: 'exact', head: true })
              .eq('hotel', hotelNameForFilter)
              .eq('is_dnd', true);
            if (dndStillOn && dndStillOn > 0) {
              console.error(`DND reset FAILED - ${dndStillOn} rooms still have DND=true. Likely RLS issue.`);
              toast.error(`DND reset failed for ${dndStillOn} rooms. Contact admin.`);
            } else {
              console.log(`Reset DND flags for all rooms in ${hotelNameForFilter}`);
            }
          }

          // Batch reset towel/linen change flags to prevent stale data from previous uploads
          const { error: tcResetError } = await supabase
            .from('rooms')
            .update({ towel_change_required: false, linen_change_required: false })
            .eq('hotel', hotelNameForFilter);
          
          if (tcResetError) {
            console.warn(`Error resetting T/RC flags for ${hotelNameForFilter}:`, tcResetError);
          } else {
            // Verify T/RC reset
            const { count: tcStillOn } = await supabase
              .from('rooms')
              .select('id', { count: 'exact', head: true })
              .eq('hotel', hotelNameForFilter)
              .or('towel_change_required.eq.true,linen_change_required.eq.true');
            if (tcStillOn && tcStillOn > 0) {
              console.error(`T/RC reset FAILED - ${tcStillOn} rooms still have flags set. Likely RLS issue.`);
              toast.error(`Towel/linen reset failed for ${tcStillOn} rooms. Contact admin.`);
            } else {
              console.log(`Reset towel/linen change flags for all rooms in ${hotelNameForFilter}`);
            }
          }

          // Batch reset checkout flags to prevent stale data from previous uploads
          const { error: checkoutResetError } = await supabase
            .from('rooms')
            .update({ is_checkout_room: false, checkout_time: null })
            .eq('hotel', hotelNameForFilter);
          
          if (checkoutResetError) {
            console.warn(`Error resetting checkout flags for ${hotelNameForFilter}:`, checkoutResetError);
          } else {
            console.log(`Reset checkout flags for all rooms in ${hotelNameForFilter}`);
          }
        }
      } else {
        console.warn('No hotel selected - skipping assignment reset');
      }

      // Clear minibar records from previous day for the current hotel to avoid confusion
      if (hotelNameForFilter) {
        const { data: hotelRooms } = await supabase
          .from('rooms')
          .select('id')
          .eq('hotel', hotelNameForFilter);
        
        if (hotelRooms && hotelRooms.length > 0) {
          const roomIds = hotelRooms.map(r => r.id);
          
          // Calculate previous day's date range
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          yesterday.setHours(0, 0, 0, 0);
          const startOfYesterday = yesterday.toISOString();
          
          const endOfYesterday = new Date(yesterday);
          endOfYesterday.setHours(23, 59, 59, 999);
          const endOfYesterdayISO = endOfYesterday.toISOString();
          
          const { error: minibarClearError } = await supabase
            .from('room_minibar_usage')
            .update({ is_cleared: true })
            .in('room_id', roomIds)
            .eq('is_cleared', false)
            .gte('usage_date', startOfYesterday)
            .lte('usage_date', endOfYesterdayISO);
          
          if (minibarClearError) {
            console.warn('Error clearing minibar records:', minibarClearError);
          } else {
            console.log('Cleared previous day minibar records for hotel');
          }
        }
      }

      // Process the data
      const processed = { processed: 0, updated: 0, assigned: 0, errors: [] as string[] };
      const checkoutRoomsList: any[] = [];
      const dailyCleaningRoomsList: any[] = [];

      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        setProgress(10 + (i / jsonData.length) * 80);

        try {
          // Skip empty or invalid rows
          const roomVal = getField(row, columnMap, 'Room');
          if (!row || !roomVal || roomVal === null || roomVal === undefined || String(roomVal).trim() === '') {
            // Silently skip truly empty rows (don't count as errors)
            continue;
          }

          // Extract room number from complex room name
          const roomNumber = extractRoomNumber(String(roomVal).trim());
          
          // Find the room by extracted number with hotel filter
          let roomQuery = supabase
            .from('rooms')
            .select('id, status, room_number, room_type, is_checkout_room, hotel, is_dnd')
            .eq('room_number', roomNumber);

          // Filter by selected hotel using pre-resolved hotel name
          if (hotelNameForFilter) {
            roomQuery = roomQuery.eq('hotel', hotelNameForFilter);
          }

          const { data: rooms, error: roomError } = await roomQuery;

          if (roomError || !rooms || rooms.length === 0) {
            processed.errors.push(`Room ${roomVal} (extracted: ${roomNumber}) not found in ${selectedHotel || 'any hotel'}`);
            continue;
          }

          const room = rooms[0];
          const currentStatus = room.status;
          
          console.log(`[PMS] Found room ${roomNumber} with current status: ${currentStatus}`);
          
          // Allow PMS to override status (manual lock not yet implemented)
          // If you need to preserve manual maintenance/out_of_order, we'll add a DB flag (status_locked)

          
          // Determine new status based on PMS data
          let newStatus = 'clean';
          let needsCleaning = false;
          let isCheckout = false;
          let guestNightsStayed = 0;
          let towelChangeRequired = false;
          let linenChangeRequired = false;
          let isNoShow = false;
          let isEarlyCheckout = false;
          let totalNights = 0;

          // Parse Night/Total column for guest stay information
          const nightTotalVal = getField(row, columnMap, 'NightTotal');
          const nightTotalRaw = nightTotalVal === null || nightTotalVal === undefined
            ? null
            : String(nightTotalVal).trim();
          const parsedNightTotal = parseNightTotal(nightTotalVal);

          if (parsedNightTotal) {
            guestNightsStayed = parsedNightTotal.currentNight;
            totalNights = parsedNightTotal.totalNights;

            // Early checkout: guest is on their last night (e.g. 3/3)
            if (guestNightsStayed === totalNights && totalNights > 0) {
              isEarlyCheckout = true;
            }

            // Cleaning cycle: T, T, RC repeating every 6 days from day 3
            // Day 3: T, Day 5: T, Day 7: RC, Day 9: T, Day 11: T, Day 13: RC, ...
            if (guestNightsStayed >= 3) {
              const cyclePosition = (guestNightsStayed - 3) % 6;
              if (cyclePosition === 0 || cyclePosition === 2) {
                // Towel Change days: 3, 5, 9, 11, 15, 17...
                towelChangeRequired = true;
                linenChangeRequired = false;
              } else if (cyclePosition === 4) {
                // Room Cleaning days: 7, 13, 19...
                linenChangeRequired = true;
                towelChangeRequired = false;
              }
            }

            console.log(`[PMS] Room ${roomNumber}: Guest stayed ${guestNightsStayed}/${totalNights} nights. Early checkout: ${isEarlyCheckout}. Towel change: ${towelChangeRequired}, Linen change: ${linenChangeRequired}`);
          }

          const departureVal = getField(row, columnMap, 'Departure');
          const occupiedVal = getField(row, columnMap, 'Occupied');
          const arrivalVal = getField(row, columnMap, 'Arrival');
          const peopleVal = getField(row, columnMap, 'People');
          const noteVal = getField(row, columnMap, 'Note');
          const statusVal = getField(row, columnMap, 'Status');

          // Any room with a departure time needs checkout cleaning (regardless of current occupancy)
          const departureParsed = excelTimeToString(departureVal);
          if (departureParsed !== null) {
            // Checkout room - needs checkout cleaning
            newStatus = 'dirty';
            needsCleaning = true;
            isCheckout = true;
            
            // A room WITH a departure time had a guest who departed -- never a no-show
            // Determine checkout sub-type
            const checkoutStatus = isEarlyCheckout ? 'early_checkout' : 'checkout';
            const checkoutNotePrefix = isNoShow ? 'No Show' : isEarlyCheckout ? `Early Checkout (Night ${guestNightsStayed}/${totalNights})` : null;
            
            console.log(`[PMS] Room ${roomNumber}: Setting to dirty (checkout - Departure: ${departureParsed}${isNoShow ? ' - No Show' : ''}${isEarlyCheckout ? ' - Early Checkout' : ''})`);
            
            // Add to checkout rooms list
            checkoutRoomsList.push({
              roomNumber,
              roomType: room.room_type,
              departureTime: departureParsed,
              guestCount: peopleVal || 0,
              status: checkoutStatus,
              currentNight: guestNightsStayed > 0 ? guestNightsStayed : null,
              totalNights: totalNights > 0 ? totalNights : null,
              nightTotal: nightTotalRaw,
              notes: checkoutNotePrefix ? `${checkoutNotePrefix} - ${noteVal || ''}`.trim() : noteVal
            });
          } else if (isOccupiedYes(occupiedVal) && departureParsed === null) {
            // Daily cleaning room (occupied but no departure)
            needsCleaning = true;
            newStatus = 'dirty';
            console.log(`[PMS] Room ${roomNumber}: Daily cleaning needed (Occupied: ${occupiedVal}, no departure)`);
            
            // Add to daily cleaning rooms list
            dailyCleaningRoomsList.push({
              roomNumber,
              roomType: room.room_type,
              guestCount: peopleVal || 0,
              status: 'daily_cleaning',
              currentNight: guestNightsStayed > 0 ? guestNightsStayed : null,
              totalNights: totalNights > 0 ? totalNights : null,
              nightTotal: nightTotalRaw,
              notes: noteVal
            });
          } else if (isOccupiedNo(occupiedVal) && String(statusVal).toLowerCase().includes('untidy') && arrivalVal) {
            // No Show (NS) - Guest didn't show up, room was prepared but unused
            isNoShow = true;
            newStatus = 'clean'; // Room is clean but was prepared for no-show
            console.log(`[PMS] Room ${roomNumber}: No Show detected (Occupied: No, Status: Untidy with Arrival)`);
          } else if (statusVal && (String(statusVal).toLowerCase().includes('untidy') || String(statusVal).toLowerCase().includes('dirty'))) {
            // Room marked as dirty/untidy in PMS
            newStatus = 'dirty';
            needsCleaning = true;
            console.log(`[PMS] Room ${roomNumber}: Setting to dirty (PMS status: ${statusVal})`);
          } else {
            console.log(`[PMS] Room ${roomNumber}: Setting to clean`);
          }

          console.log(`[PMS] Room ${roomNumber}: Status change ${currentStatus} -> ${newStatus}`);

          // Update room status and checkout information
          const roomNotes = noteVal ? String(noteVal).trim() : null;
          const statusNote = isNoShow ? 'No Show' : isEarlyCheckout && isCheckout ? 'Early Checkout' : null;
          const combinedNotes = [statusNote, roomNotes].filter(Boolean).join(' - ');
          
          // Extract room type, category and Shabath flag from PMS Room column name
          const extractRoomInfo = (roomName: string, hotelName: string): { roomType: string | null; roomCategory: string | null; isShabath: boolean } => {
            if (!roomName) return { roomType: null, roomCategory: null, isShabath: false };
            const upper = roomName.toUpperCase();
            // Shabath detection: SH suffix before room number dash, e.g. "4QUEEN-008SH" or "7TWIN-034SH"
            const isShabath = /SH\s*$/.test(upper.replace(/[^A-Z0-9]/g, '')) || /SH$/.test(upper.trim());
            
            const isOttofiori = hotelName.toLowerCase().includes('ottofiori');
            
            if (isOttofiori) {
              // Hotel Ottofiori patterns (prefix-based: CQ-, Q-, DB/TW-, TRP-, QRP-)
              if (/^CQ-/i.test(roomName.trim())) return { roomType: 'queen', roomCategory: 'Deluxe Queen Room', isShabath };
              if (/^Q-/i.test(roomName.trim())) return { roomType: 'queen', roomCategory: 'Deluxe Queen Room', isShabath };
              if (/^DB\/TW-/i.test(roomName.trim())) return { roomType: 'double_twin', roomCategory: 'Deluxe Double or Twin Room', isShabath };
              if (/^TRP-/i.test(roomName.trim())) return { roomType: 'triple', roomCategory: 'Deluxe Triple Room', isShabath };
              if (/^QRP-/i.test(roomName.trim())) return { roomType: 'quadruple', roomCategory: 'Deluxe Quadruple Room', isShabath };
              if (/^ECO/i.test(roomName.trim()) || /^EC-/i.test(roomName.trim())) return { roomType: 'economy_double', roomCategory: 'Economy Double Room', isShabath };
              console.log(`[PMS] Ottofiori: No category match for "${roomName}"`);
              return { roomType: null, roomCategory: null, isShabath };
            }
            
            // Hotel Memories Budapest patterns (order matters: check longer patterns first)
            if (upper.includes('SYN.DOUBLE')) return { roomType: 'syn_double', roomCategory: 'Deluxe Double or Twin Room with Synagogue View', isShabath };
            if (upper.includes('SYN.TWIN')) return { roomType: 'syn_twin', roomCategory: 'Deluxe Double or Twin Room with Synagogue View', isShabath };
            if (upper.includes('EC.QRP')) return { roomType: 'economy_quadruple', roomCategory: 'Comfort Quadruple Room', isShabath };
            if (upper.includes('ECDBL')) return { roomType: 'economy_double', roomCategory: 'Comfort Double Room with Small Window', isShabath };
            if (upper.includes('QUEEN')) return { roomType: 'queen', roomCategory: 'Deluxe Queen Room', isShabath };
            if (upper.includes('DOUBLE')) return { roomType: 'double', roomCategory: 'Deluxe Double or Twin Room', isShabath };
            if (upper.includes('TWIN')) return { roomType: 'twin', roomCategory: 'Deluxe Double or Twin Room', isShabath };
            if (upper.includes('TRP')) return { roomType: 'triple', roomCategory: 'Deluxe Triple Room', isShabath };
            if (upper.includes('QDR')) return { roomType: 'quadruple', roomCategory: 'Deluxe Quadruple Room', isShabath };
            if (upper.includes('SNG')) return { roomType: 'single', roomCategory: 'Deluxe Single Room', isShabath };
            return { roomType: null, roomCategory: null, isShabath };
          };

          const roomNameVal = getField(row, columnMap, 'Room');
          const roomInfo = extractRoomInfo(String(roomNameVal || ''), hotelNameForFilter || '');

          const updateData: any = { 
            status: newStatus,
            notes: combinedNotes || null,
            is_checkout_room: isCheckout,
            guest_count: peopleVal || 0,
            guest_nights_stayed: guestNightsStayed,
            towel_change_required: towelChangeRequired,
            linen_change_required: linenChangeRequired,
            is_dnd: false,
            dnd_marked_at: null,
            dnd_marked_by: null,
            updated_at: new Date().toISOString()
          };

          // Update room_type, room_category, bed_type (shabath), and room_name from PMS
          if (roomInfo.roomType) {
            updateData.room_type = roomInfo.roomType;
          }
          if (roomInfo.roomCategory) {
            updateData.room_category = roomInfo.roomCategory;
          }
          updateData.bed_type = roomInfo.isShabath ? 'shabath' : null;
          updateData.room_name = roomNameVal ? String(roomNameVal).trim() : null;

          // Set last change dates if changes are required
          const today = new Date().toISOString().split('T')[0];
          if (towelChangeRequired) {
            updateData.last_towel_change = today;
          }
          if (linenChangeRequired) {
            updateData.last_linen_change = today;
          }

          if (isCheckout && departureParsed !== null) {
            updateData.checkout_time = new Date().toISOString();
          } else if (!isCheckout) {
            updateData.checkout_time = null;
            updateData.is_checkout_room = false;
          }

          // Always update on PMS upload to ensure re-uploads reclassify correctly
          const { error: updateError } = await supabase
            .from('rooms')
            .update(updateData)
            .eq('id', room.id);

          if (!updateError) {
            processed.updated++;
          }

          // Note: PMS upload only updates room statuses. Managers must manually assign rooms to housekeepers.

          processed.processed++;
        } catch (error) {
          console.error('Error processing row:', error);
          processed.errors.push(`Error processing room ${row.Room}: ${error}`);
        }
      }

      setProgress(100);
      setResults(processed);
      setCheckoutRooms(checkoutRoomsList);
      setDailyCleaningRooms(dailyCleaningRoomsList);
      setBackgroundUpload(false);
      
      // Save summary for managers/admins to view later
      try {
        const { error: summaryError } = await supabase
          .from('pms_upload_summary')
          .insert({
            uploaded_by: user?.id,
            processed_rooms: processed.processed,
            updated_rooms: processed.updated,
            assigned_rooms: processed.assigned,
            checkout_rooms: checkoutRoomsList,
            daily_cleaning_rooms: dailyCleaningRoomsList,
            errors: processed.errors,
            hotel_filter: selectedHotel
          });
          
        if (summaryError) {
          console.error('Error saving PMS upload summary:', summaryError);
        }
      } catch (error) {
        console.error('Error saving PMS upload summary:', error);
      }
      
      // Show completion notification
      const successMessage = `Upload completed! Processed ${processed.processed} rooms, updated ${processed.updated}, assigned ${processed.assigned} new tasks`;
      
      if (document.visibilityState === 'visible') {
        toast.success(successMessage);
      } else {
        // User is on another tab, show notification that will persist
        toast.success(successMessage, { duration: 10000 });
        
        // Try to show browser notification if permission granted
        if (Notification.permission === 'granted') {
          new Notification('PMS Upload Complete', {
            body: successMessage,
            icon: '/favicon.ico'
          });
        }
      }
      
    } catch (error) {
      console.error('Error processing file:', error);
      toast.error('Failed to process the Excel file');
      setBackgroundUpload(false);
    } finally {
      setUploading(false);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      
      // Check if this is the first upload today
      if (checkFirstUploadToday()) {
        // First upload - proceed directly
        markUploadToday();
        await processFile(file);
      } else {
        // Second or later upload - show warning dialog
        setPendingFile(file);
        setShowWarningDialog(true);
      }
    }
  }, [selectedHotel]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    multiple: false,
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check if this is the first upload today
    if (checkFirstUploadToday()) {
      // First upload - proceed directly
      markUploadToday();
      await processFile(file);
    } else {
      // Second or later upload - show warning dialog
      setPendingFile(file);
      setShowWarningDialog(true);
    }
    
    // Reset file input
    event.target.value = '';
  };

  // Handle confirmation from warning dialog
  const handleWarningConfirm = async () => {
    if (pendingFile) {
      setShowWarningDialog(false);
      await processFile(pendingFile);
      setPendingFile(null);
    }
  };

  // Handle cancellation from warning dialog
  const handleWarningCancel = () => {
    setShowWarningDialog(false);
    setPendingFile(null);
    toast.info(t('pms.uploadCancelled'));
  };

  // Handle Previo PMS sync
  const handlePrevioSync = async () => {
    if (!selectedHotel || !user) {
      toast.error('Please select a hotel first');
      return;
    }

    setIsSyncingPrevio(true);
    setResults(null);
    setCheckoutRooms([]);
    setDailyCleaningRooms([]);

    try {
      // Step 1: Sync rooms from Previo
      console.log('Calling previo-sync-rooms for hotel:', selectedHotel);
      
      const { data: roomsData, error: roomsError } = await supabase.functions.invoke(
        'previo-sync-rooms',
        {
          body: { 
            hotelId: '788619' // Previo test hotel ID
          }
        }
      );

      if (roomsError) {
        throw new Error(`Room sync failed: ${roomsError.message}`);
      }

      console.log('Rooms synced:', roomsData);

      // Step 2: Sync reservations from Previo
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      console.log('Calling previo-sync-reservations...');
      
      const { data: reservationsData, error: reservationsError } = await supabase.functions.invoke(
        'previo-sync-reservations',
        {
          body: {
            hotelId: '788619',
            dateFrom: today,
            dateTo: tomorrowStr
          }
        }
      );

      if (reservationsError) {
        throw new Error(`Reservation sync failed: ${reservationsError.message}`);
      }

      console.log('Reservations synced:', reservationsData);

      // Step 3: Fetch rooms to populate checkout and daily cleaning lists
      // Get hotel name from hotel_id
      const { data: hotelConfig } = await supabase
        .from('hotel_configurations')
        .select('hotel_name')
        .eq('hotel_id', selectedHotel)
        .single();
      
      const hotelNameToFilter = hotelConfig?.hotel_name || selectedHotel;

      const { data: roomsList, error: roomsListError } = await supabase
        .from('rooms')
        .select('room_number, room_type, status, is_checkout_room, guest_count, checkout_time, notes')
        .eq('hotel', hotelNameToFilter)
        .eq('status', 'dirty');

      if (!roomsListError && roomsList) {
        const checkoutRoomsList: any[] = [];
        const dailyCleaningRoomsList: any[] = [];

        roomsList.forEach((room) => {
          if (room.is_checkout_room) {
            checkoutRoomsList.push({
              roomNumber: room.room_number,
              roomType: room.room_type,
              departureTime: room.checkout_time ? new Date(room.checkout_time).toLocaleTimeString() : undefined,
              guestCount: room.guest_count || 0,
              status: 'checkout',
              notes: room.notes
            });
          } else {
            dailyCleaningRoomsList.push({
              roomNumber: room.room_number,
              roomType: room.room_type,
              guestCount: room.guest_count || 0,
              status: 'daily_cleaning',
              notes: room.notes
            });
          }
        });

        setCheckoutRooms(checkoutRoomsList);
        setDailyCleaningRooms(dailyCleaningRoomsList);
      }

      // Step 4: Show success message
      toast.success('Successfully synced with Previo PMS!');
      
      // Step 5: Set results to show on screen
      const roomResults = roomsData?.results || {};
      const reservationResults = reservationsData?.results || {};
      
      setResults({
        processed: (roomResults.total || 0),
        updated: (roomResults.updated || 0) + (reservationResults.updated || 0),
        assigned: 0,
        errors: [
          ...(roomResults.errors || []),
          ...(reservationResults.errors || [])
        ]
      });

      // Step 6: Mark upload today (same as Excel upload)
      markUploadToday();

    } catch (error: any) {
      console.error('Previo sync error:', error);
      toast.error(`Previo sync failed: ${error.message}`);
    } finally {
      setIsSyncingPrevio(false);
    }
  };

  // Check if Previo sync should be enabled for this hotel
  useEffect(() => {
    const checkPrevioEnabled = async () => {
      if (!selectedHotel) {
        console.log('❌ No hotel selected');
        setPrevioSyncEnabled(false);
        return;
      }
      
      console.log('🔍 Checking Previo sync for hotel:', selectedHotel);
      console.log('👤 User role:', userRole);
      
      // Enable for admins, managers with hotelcare-test hotel
      // selectedHotel can be either hotel_name or hotel_id from profile
      const { data: hotelConfigs, error } = await supabase
        .from('hotel_configurations')
        .select('hotel_id, hotel_name, settings')
        .or(`hotel_id.eq."${selectedHotel}",hotel_name.eq."${selectedHotel}"`)
        .limit(1);
      
      if (error) {
        console.error('❌ Error fetching hotel config:', error);
        setPrevioSyncEnabled(false);
        return;
      }
      
      console.log('🔍 Found hotel configs:', hotelConfigs);
      
      // Enable Previo sync for hotelcare-test hotel for managers and admins
      if (hotelConfigs && hotelConfigs.length > 0 && hotelConfigs[0].hotel_id === 'hotelcare-test') {
        const hasPermission = userRole === 'admin' || userRole === 'manager' || userRole === 'housekeeping_manager';
        console.log('✅ Hotel is hotelcare-test, has permission:', hasPermission);
        setPrevioSyncEnabled(hasPermission);
      } else {
        console.log('❌ Previo sync disabled. Config found:', hotelConfigs);
        setPrevioSyncEnabled(false);
      }
    };
    
    checkPrevioEnabled();
  }, [selectedHotel, userRole]);

  // Request notification permission on component mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          {t('pms.title')}
        </CardTitle>
          <div className="flex justify-between items-start">
          <div>
            <p className="text-sm text-muted-foreground">
              {t('pms.subtitle')}
            </p>
          </div>
          <div className="flex gap-2">
            {previoSyncEnabled && (
              <Button 
                variant="outline" 
                onClick={() => setSyncHistoryDialogOpen(true)}
                className="text-sm"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync History
              </Button>
            )}
            <Button 
              variant="outline" 
              onClick={() => setHistoryDialogOpen(true)}
              className="text-sm"
            >
              View History
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hotel Selection Warning */}
        {selectedHotel && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-semibold text-blue-800 mb-1">
                  Hotel Filter Active
                </h4>
                <p className="text-sm text-blue-700">
                  Currently operating on: <strong>{selectedHotel}</strong>
                  <br />
                  Only rooms in this hotel will be affected by the PMS upload.
                </p>
              </div>
            </div>
          </div>
        )}
        
        {!selectedHotel && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <h4 className="font-semibold text-amber-800 mb-1">
                  No Hotel Selected
                </h4>
                <p className="text-sm text-amber-700">
                  Please select a hotel from the switcher at the top to upload PMS data.
                </p>
              </div>
            </div>
          </div>
        )}
        
        {!uploading && !results && selectedHotel && (
          <>
            {/* Warning about data reset */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-amber-800 mb-1">
                    Data Reset Warning
                  </h4>
                  <p className="text-sm text-amber-700">
                    Uploading a PMS file will reset all room assignments and data for {selectedHotel} for the current day
                  </p>
                </div>
              </div>
            </div>
            
            {selectedHotel && (
              <div 
                {...getRootProps()} 
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragActive 
                    ? 'border-primary bg-primary/5' 
                    : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'
                }`}
              >
                <input {...getInputProps()} />
                <Upload className={`h-12 w-12 mx-auto mb-4 transition-colors ${
                  isDragActive ? 'text-primary' : 'text-muted-foreground'
                }`} />
                <div className="space-y-2">
                <h3 className="font-medium">
                  {isDragActive ? t('pms.dropHere') : t('pms.title')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {isDragActive 
                    ? t('pms.releaseToUpload')
                    : t('pms.dragDrop')
                  }
                </p>
              </div>
            </div>
            )}

            {/* Upload Buttons */}
            <div className="flex justify-center gap-4 mt-4">
              {previoSyncEnabled && (
                <Button
                  onClick={handlePrevioSync}
                  disabled={uploading || isSyncingPrevio || !(userRole === 'admin' || userRole === 'manager' || userRole === 'housekeeping_manager')}
                  className="w-full max-w-xs"
                  variant="outline"
                >
                  {isSyncingPrevio ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Syncing with Previo...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync with Previo
                    </>
                  )}
                </Button>
              )}
            </div>
          </>
        )}

        {uploading && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 animate-pulse" />
              <span>{t('pms.processing')}</span>
              {backgroundUpload && (
                <Badge variant="secondary" className="ml-2">
                  {t('pms.backgroundUpload')}
                </Badge>
              )}
            </div>
            <Progress value={progress} className="w-full" />
            <p className="text-sm text-muted-foreground text-center">
              {progress < 10 ? 'Reading file...' : 
               progress < 90 ? 'Processing room data...' : 
               'Finalizing updates...'}
            </p>
            {backgroundUpload && (
              <p className="text-xs text-muted-foreground text-center bg-muted p-2 rounded">
                💡 You can navigate to other tabs while this processes. You'll be notified when complete.
              </p>
            )}
          </div>
        )}

        {results && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">{t('pms.uploadComplete')}</span>
            </div>
            
            {/* Show statistics to admins and managers */}
            {(userRole === 'admin' || userRole === 'manager' || userRole === 'housekeeping_manager') && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{results.processed}</div>
                  <div className="text-sm text-blue-600">{t('pms.roomsProcessed')}</div>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{results.updated}</div>
                  <div className="text-sm text-green-600">{t('pms.statusesUpdated')}</div>
                </div>
                <div className="text-center p-4 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">{results.assigned}</div>
                  <div className="text-sm text-orange-600">{t('pms.tasksAssigned')}</div>
                </div>
              </div>
            )}

            {results.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-orange-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-medium">{t('pms.issuesFound')} ({results.errors.length})</span>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {results.errors.map((error, index) => (
                    <p key={index} className="text-sm text-orange-600 bg-orange-50 p-2 rounded">
                      {error}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button 
                onClick={() => {
                  setResults(null);
                  setCheckoutRooms([]);
                  setDailyCleaningRooms([]);
                }}
                variant="outline" 
                className="flex-1"
              >
                {t('pms.uploadAnother')}
              </Button>
              {onNavigateToTeamView && (
                <Button 
                  onClick={onNavigateToTeamView}
                  className="flex-1"
                >
                  <Users className="h-4 w-4 mr-1" />
                  Go to Team View
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Checkout Rooms Visibility */}
        {(checkoutRooms.length > 0 || dailyCleaningRooms.length > 0) && (
          <div className="mt-6">
            <CheckoutRoomsView 
              checkoutRooms={checkoutRooms} 
              dailyCleaningRooms={dailyCleaningRooms} 
            />
          </div>
        )}
      </CardContent>
        <PMSUploadHistoryDialog
          open={historyDialogOpen}
          onOpenChange={setHistoryDialogOpen}
          hotelFilter={resolvedHotelName || selectedHotel || undefined}
        />
        
        <PMSSyncHistoryDialog
          open={syncHistoryDialogOpen}
          onOpenChange={setSyncHistoryDialogOpen}
        />

        {/* Warning Dialog for Second Upload */}
        <AlertDialog open={showWarningDialog} onOpenChange={setShowWarningDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                {t('pms.warning.title')}
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p className="font-semibold text-amber-600">
                  {t('pms.warning.secondUpload')}
                </p>
                <p>
                  {t('pms.warning.description')} <strong>{selectedHotel || 'selected hotel'}</strong>
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>{t('pms.warning.clearAssignments')}</li>
                  <li>{t('pms.warning.clearMinibar')}</li>
                  <li>{t('pms.warning.resetStatuses')}</li>
                </ul>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleWarningCancel}>
                {t('pms.warning.cancel')}
              </AlertDialogCancel>
              <AlertDialogAction onClick={handleWarningConfirm} className="bg-amber-500 hover:bg-amber-600">
                {t('pms.warning.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    );
  }
