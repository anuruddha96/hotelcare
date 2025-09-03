import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
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
  const [results, setResults] = useState<{
    processed: number;
    updated: number;
    assigned: number;
    errors: string[];
  } | null>(null);

  // Extract room number from complex room names (e.g., "70SNG-306" -> "306")
  const extractRoomNumber = (roomName: string): string => {
    // Remove any trailing "SH" suffix first
    let cleanName = roomName.replace(/SH$/, '');
    
    // Extract number after the last dash or period
    const match = cleanName.match(/[-.](\d+)$/);
    if (match) {
      return match[1].replace(/^0+/, '') || match[1]; // Remove leading zeros but keep if all zeros
    }
    
    // Fallback: extract any number at the end
    const fallbackMatch = cleanName.match(/(\d+)$/);
    return fallbackMatch ? fallbackMatch[1].replace(/^0+/, '') || fallbackMatch[1] : roomName;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast.error('Please upload an Excel file (.xlsx or .xls)');
      return;
    }

    setUploading(true);
    setProgress(0);
    setResults(null);

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
            processed.errors.push(`Room ${row.Room} not found in system`);
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
      
      toast.success(`Upload completed! Processed ${processed.processed} rooms, updated ${processed.updated}, assigned ${processed.assigned} new tasks`);
      
    } catch (error) {
      console.error('Error processing file:', error);
      toast.error('Failed to process the Excel file');
    } finally {
      setUploading(false);
      // Reset file input
      event.target.value = '';
    }
  };

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
          <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
            <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <div className="space-y-2">
              <h3 className="font-medium">Upload PMS Excel File</h3>
              <p className="text-sm text-muted-foreground">
                Select your PMS export file with room data
              </p>
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
            </div>
          </div>
        )}

        {uploading && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 animate-pulse" />
              <span>Processing PMS data...</span>
            </div>
            <Progress value={progress} className="w-full" />
            <p className="text-sm text-muted-foreground text-center">
              {progress < 10 ? 'Reading file...' : 
               progress < 90 ? 'Processing room data...' : 
               'Finalizing updates...'}
            </p>
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
