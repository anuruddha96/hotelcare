import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useDropzone } from 'react-dropzone';
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
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [backgroundUpload, setBackgroundUpload] = useState(false);
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
    
    // Pattern 1: QRP rooms (e.g., "66EC.QRP216" -> "216")
    let match = cleanName.match(/QRP(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Pattern 2: SNG rooms (e.g., "70SNG-306" -> "306")
    match = cleanName.match(/\d+SNG-(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Pattern 3: ECDBL rooms (e.g., "71ECDBL-308" -> "308") 
    match = cleanName.match(/\d+ECDBL-(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Pattern 4: QUEEN rooms with or without SH (e.g., "1QUEEN-002", "4QUEEN-008SH" -> "002", "008")
    match = cleanName.match(/\d+QUEEN-(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 5: TWIN rooms with or without SH (e.g., "7TWIN-034SH", "8TWIN-036" -> "034", "036")
    match = cleanName.match(/\d+TWIN-(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 6: DOUBLE rooms (e.g., "16DOUBLE-104", "39DOUBLE-135" -> "104", "135")
    match = cleanName.match(/\d+DOUBLE-(\d{3})/);
    if (match) {
      return match[1];
    }
    
    // Pattern 7: SYN.TWIN rooms with or without SH (e.g., "13SYN.TWIN-101", "21SYN.TWIN-109SH" -> "101", "109")
    match = cleanName.match(/\d+SYN\.TWIN-(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 8: SYN.DOUBLE rooms with or without SH (e.g., "15SYN.DOUBLE-103", "19SYN.DOUBLE-107SH" -> "103", "107")
    match = cleanName.match(/\d+SYN\.DOUBLE-(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 9: TRP rooms with or without SH (e.g., "3TRP-006", "59TRP-209SH" -> "006", "209")
    match = cleanName.match(/\d+TRP-(\d{3})(?:SH)?/);
    if (match) {
      return match[1];
    }
    
    // Pattern 10: QDR rooms (e.g., "9QDR-038", "26QDR-114" -> "038", "114")
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
      
      // Process the data
      const processed = { processed: 0, updated: 0, assigned: 0, errors: [] as string[] };

      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        setProgress(10 + (i / jsonData.length) * 80);

        try {
          // Extract room number from complex room name
          const roomNumber = extractRoomNumber(row.Room.toString());
          
          // Find the room by extracted number
          const { data: rooms, error: roomError } = await supabase
            .from('rooms')
            .select('id, status, room_number')
            .eq('room_number', roomNumber);

          if (roomError || !rooms || rooms.length === 0) {
            processed.errors.push(`Room ${row.Room} (extracted: ${roomNumber}) not found in system`);
            continue;
          }

          const room = rooms[0];
          const currentStatus = room.status;
          
          // Determine new status based on PMS data
          let newStatus = 'clean';
          let needsCleaning = false;

          if (row.Occupied === 'Yes' && row.Departure) {
            // Checkout room - needs checkout cleaning
            newStatus = 'dirty';
            needsCleaning = true;
          } else if (row.Status === 'untidy' || row.Status === 'dirty') {
            // Room marked as dirty in PMS
            newStatus = 'dirty';
            needsCleaning = true;
          } else if (row.Defect && row.Defect !== '') {
            // Room has maintenance issues
            newStatus = 'maintenance';
          }

          // Update room status if changed
          if (currentStatus !== newStatus) {
            const { error: updateError } = await supabase
              .from('rooms')
              .update({ 
                status: newStatus,
                notes: row.Note || null,
                updated_at: new Date().toISOString()
              })
              .eq('id', room.id);

            if (!updateError) {
              processed.updated++;
            }
          }

          // Auto-assign cleaning if needed
          if (needsCleaning) {
            const assignmentType = row.Departure ? 'checkout_cleaning' : 'daily_cleaning';
            const priority = row.Departure ? 2 : 1; // Higher priority for checkout

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
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          PMS Data Upload
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Upload Excel file from your PMS system to automatically update room statuses and create cleaning assignments
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!uploading && !results && (
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
                {isDragActive ? 'Drop your PMS file here' : 'Upload PMS Excel File'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {isDragActive 
                  ? 'Release to upload your file'
                  : 'Drag & drop your PMS export file here, or click to select'
                }
              </p>
              {!isDragActive && (
                <>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="pms-upload"
                  />
                  <Button asChild>
                    <label htmlFor="pms-upload" className="cursor-pointer">
                      Choose File
                    </label>
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {uploading && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 animate-pulse" />
              <span>Processing PMS data...</span>
              {backgroundUpload && (
                <Badge variant="secondary" className="ml-2">
                  Running in background
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
              <span className="font-medium">Upload Complete</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{results.processed}</div>
                <div className="text-sm text-blue-600">Rooms Processed</div>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{results.updated}</div>
                <div className="text-sm text-green-600">Statuses Updated</div>
              </div>
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">{results.assigned}</div>
                <div className="text-sm text-orange-600">Tasks Assigned</div>
              </div>
            </div>

            {results.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-orange-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-medium">Issues Found ({results.errors.length})</span>
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
              onClick={() => setResults(null)}
              variant="outline" 
              className="w-full"
            >
              Upload Another File
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
