import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { CheckoutRoomsView } from './CheckoutRoomsView';
import * as XLSX from 'xlsx';

interface PMSData {
  Room: string;
  Occupied: string;
  Departure: string;
  Arrival: string;
  People: number;
  'Night / Total': string;
  Note: string;
  Nationality: string;
  Defect: string;
  Status: string;
}

export function PMSUpload() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const userRole = profile?.role;
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
    
    // Pattern 11: TRP rooms with or without SH (e.g., "3TRP-006", "59TRP-209SH" -> "006", "209")
    match = cleanName.match(/\d+TRP-(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 12: QDR rooms (e.g., "9QDR-038", "26QDR-114" -> "038", "114")
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
      const jsonData: PMSData[] = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        toast.error('No data found in the Excel file');
        return;
      }

      setProgress(10);
      
      // Reset all current day room assignments since PMS upload will reset room data
      const today = new Date().toISOString().split('T')[0];
      const { error: resetError } = await supabase
        .from('room_assignments')
        .delete()
        .eq('assignment_date', today);
      
      if (resetError) {
        console.warn('Error resetting room assignments:', resetError);
      } else {
        console.log('Reset all room assignments for today');
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
          if (!row || !row.Room || row.Room === null || row.Room === undefined) {
            processed.errors.push(`Skipping empty row at index ${i}`);
            continue;
          }

          // Extract room number from complex room name
          const roomNumber = extractRoomNumber(String(row.Room).trim());
          
          // Find the room by extracted number
          const { data: rooms, error: roomError } = await supabase
            .from('rooms')
            .select('id, status, room_number, room_type, is_checkout_room')
            .eq('room_number', roomNumber);

          if (roomError || !rooms || rooms.length === 0) {
            processed.errors.push(`Room ${row.Room} (extracted: ${roomNumber}) not found in system`);
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

          // Any room with a departure time needs checkout cleaning (regardless of current occupancy)
          if (row.Departure && row.Departure.trim() !== '') {
            // Checkout room - needs checkout cleaning
            newStatus = 'dirty';
            needsCleaning = true;
            isCheckout = true;
            console.log(`[PMS] Room ${roomNumber}: Setting to dirty (checkout - Departure: ${row.Departure})`);
            
            // Add to checkout rooms list
            checkoutRoomsList.push({
              roomNumber,
              roomType: room.room_type,
              departureTime: row.Departure,
              guestCount: row.People || 0,
              status: 'checkout',
              notes: row.Note
            });
          } else if (row.Occupied === 'Yes' && !row.Departure) {
            // Daily cleaning room (occupied but no departure)
            needsCleaning = true;
            newStatus = 'dirty';
            console.log(`[PMS] Room ${roomNumber}: Daily cleaning needed (Occupied: ${row.Occupied}, no departure)`);
            
            // Add to daily cleaning rooms list
            dailyCleaningRoomsList.push({
              roomNumber,
              roomType: room.room_type,
              guestCount: row.People || 0,
              status: 'daily_cleaning',
              notes: row.Note
            });
          } else if (row.Status === 'untidy' || row.Status === 'dirty') {
            // Room marked as dirty in PMS
            newStatus = 'dirty';
            needsCleaning = true;
            console.log(`[PMS] Room ${roomNumber}: Setting to dirty (PMS status: ${row.Status})`);
          } else {
            console.log(`[PMS] Room ${roomNumber}: Setting to clean`);
          }

          console.log(`[PMS] Room ${roomNumber}: Status change ${currentStatus} -> ${newStatus}`);

          // Update room status and checkout information
          const updateData: any = { 
            status: newStatus,
            notes: row.Note || null,
            is_checkout_room: isCheckout,
            guest_count: row.People || 0,
            updated_at: new Date().toISOString()
          };

          if (isCheckout && row.Departure) {
            updateData.checkout_time = new Date().toISOString();
          } else if (!isCheckout) {
            updateData.checkout_time = null;
            updateData.is_checkout_room = false;
          }

          if (currentStatus !== newStatus || room.is_checkout_room !== isCheckout) {
            const { error: updateError } = await supabase
              .from('rooms')
              .update(updateData)
              .eq('id', room.id);

            if (!updateError) {
              processed.updated++;
            }
          }

          // Auto-assign cleaning if needed
          if (needsCleaning) {
            const assignmentType = isCheckout ? 'checkout_cleaning' : 'daily_cleaning';
            const priority = isCheckout ? 2 : 1; // Higher priority for checkout

            // Check if already assigned for today
            const { data: existingAssignments } = await supabase
              .from('room_assignments')
              .select('id')
              .eq('room_id', room.id)
              .eq('assignment_date', new Date().toISOString().split('T')[0])
              .eq('assignment_type', assignmentType);

            if (!existingAssignments || existingAssignments.length === 0) {
              // Find available housekeeper (simple round-robin for now)
              const { data: housekeepers } = await supabase
                .from('profiles')
                .select('id')
                .eq('role', 'housekeeping')
                .limit(1);

              if (housekeepers && housekeepers.length > 0) {
                const { error: assignError } = await supabase
                  .from('room_assignments')
                  .insert({
                    room_id: room.id,
                    assigned_to: housekeepers[0].id,
                    assigned_by: (await supabase.auth.getUser()).data.user?.id,
                    assignment_date: new Date().toISOString().split('T')[0],
                    assignment_type: assignmentType,
                    priority: priority,
                    estimated_duration: assignmentType === 'checkout_cleaning' ? 45 : 30,
                    notes: `Auto-assigned from PMS upload${row.Note ? ` - ${row.Note}` : ''}`
                  });

                if (!assignError) {
                  processed.assigned++;
                }
              }
            }
          }

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
      await processFile(acceptedFiles[0]);
    }
  }, []);

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

    await processFile(file);
    // Reset file input
    event.target.value = '';
  };

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
        <p className="text-sm text-muted-foreground">
          {t('pms.subtitle')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!uploading && !results && (
          <>
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
            
            {/* Only show statistics to admins */}
            {userRole === 'admin' && (
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

            <Button 
              onClick={() => {
                setResults(null);
                setCheckoutRooms([]);
                setDailyCleaningRooms([]);
              }}
              variant="outline" 
              className="w-full"
            >
              {t('pms.uploadAnother')}
            </Button>
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
    </Card>
  );
}
