import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DateRangeFilter } from './DateRangeFilter';
import { HotelFilter } from './HotelFilter';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, FileSpreadsheet, BarChart3 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';

interface ReportsDialogProps {
  trigger?: React.ReactNode;
}

export function ReportsDialog({ trigger }: ReportsDialogProps) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [selectedHotel, setSelectedHotel] = useState<string>('all');
  const [reportType, setReportType] = useState<string>('tickets');

  const canAccessReports = profile?.role && ['admin', 'manager'].includes(profile.role);

  if (!canAccessReports) return null;

  const generateReport = async () => {
    setLoading(true);
    try {
      let excelData: any[] = [];
      let fileName = '';

      switch (reportType) {
        case 'tickets':
          const result = await generateTicketsReport();
          excelData = result.data;
          fileName = result.fileName;
          break;
        case 'housekeeping':
          const hkResult = await generateHousekeepingReport();
          excelData = hkResult.data;
          fileName = hkResult.fileName;
          break;
        case 'rooms':
          const roomResult = await generateRoomsReport();
          excelData = roomResult.data;
          fileName = roomResult.fileName;
          break;
        case 'sla':
          const slaResult = await generateSLAReport();
          excelData = slaResult.data;
          fileName = slaResult.fileName;
          break;
        case 'operational':
          const opResult = await generateOperationalReport();
          excelData = opResult.data;
          fileName = opResult.fileName;
          break;
        default:
          throw new Error('Invalid report type selected');
      }

      if (excelData.length === 0) {
        toast({
          title: 'No Data',
          description: 'No data found for the selected filters',
          variant: 'destructive',
        });
        return;
      }

      // Convert to CSV format
      const headers = Object.keys(excelData[0]);
      const csvContent = [
        headers.join(','),
        ...excelData.map(row => 
          headers.map(header => {
            const value = row[header as keyof typeof row];
            return `"${String(value).replace(/"/g, '""')}"`;
          }).join(',')
        )
      ].join('\n');

      // Download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: 'Success',
        description: `Report downloaded successfully (${excelData.length} records)`,
      });

      setOpen(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const generateTicketsReport = async () => {
    let query = supabase
      .from('tickets')
      .select(`
        *,
        created_by:profiles!tickets_created_by_fkey(full_name, role),
        assigned_to:profiles!tickets_assigned_to_fkey(full_name, role),
        closed_by:profiles!tickets_closed_by_fkey(full_name, role),
        comments(content, created_at, profiles(full_name, role))
      `)
      .order('created_at', { ascending: false });

    // Apply filters
    if (dateRange?.from) {
      query = query.gte('created_at', dateRange.from.toISOString());
    }
    if (dateRange?.to) {
      query = query.lte('created_at', dateRange.to.toISOString());
    }
    if (selectedHotel && selectedHotel !== 'all') {
      query = query.eq('hotel', selectedHotel);
    }

    const { data, error } = await query;
    if (error) throw error;

    const excelData = data?.map((ticket: any) => {
      const slaHours = {
        urgent: 2,
        high: 8,
        medium: 24,
        low: 72
      }[ticket.priority] || 24;

      const createdAt = new Date(ticket.created_at);
      const closedAt = ticket.closed_at ? new Date(ticket.closed_at) : null;
      const hoursToClose = closedAt ? 
        Math.floor((closedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60)) : null;
      const slaBreached = hoursToClose ? hoursToClose > slaHours : false;

      return {
        'Ticket Number': ticket.ticket_number,
        'Title': ticket.title,
        'Description': ticket.description,
        'Hotel': ticket.hotel || 'N/A',
        'Room Number': ticket.room_number,
        'Category': ticket.category || 'N/A',
        'Sub Category': ticket.sub_category || 'N/A',
        'Priority': ticket.priority.toUpperCase(),
        'Status': ticket.status.replace('_', ' ').toUpperCase(),
        'Created By': ticket.created_by?.full_name || 'Unknown',
        'Created Date': format(createdAt, 'yyyy-MM-dd HH:mm:ss'),
        'Assigned To': ticket.assigned_to?.full_name || 'Unassigned',
        'Closed By': ticket.closed_by?.full_name || 'N/A',
        'Closed Date': ticket.closed_at ? format(new Date(ticket.closed_at), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
        'Resolution': ticket.resolution_text || 'N/A',
        'SLA Hours': slaHours,
        'Hours to Close': hoursToClose || 'N/A',
        'SLA Breached': slaBreached ? 'Yes' : 'No',
        'SLA Breach Reason': ticket.sla_breach_reason || 'N/A',
        'Comments Count': ticket.comments?.length || 0,
        'Attachment URLs': ticket.attachment_urls?.join('; ') || 'None'
      };
    }) || [];

    return {
      data: excelData,
      fileName: `tickets-report-${format(new Date(), 'yyyy-MM-dd')}.csv`
    };
  };

  const generateHousekeepingReport = async () => {
    // First get housekeeping performance data
    let performanceQuery = supabase
      .from('housekeeping_performance')
      .select('*')
      .order('assignment_date', { ascending: false });

    if (dateRange?.from) {
      performanceQuery = performanceQuery.gte('assignment_date', format(dateRange.from, 'yyyy-MM-dd'));
    }
    if (dateRange?.to) {
      performanceQuery = performanceQuery.lte('assignment_date', format(dateRange.to, 'yyyy-MM-dd'));
    }

    const { data: performanceData, error: performanceError } = await performanceQuery;
    if (performanceError) throw performanceError;

    if (!performanceData || performanceData.length === 0) {
      return {
        data: [],
        fileName: `housekeeping-performance-${format(new Date(), 'yyyy-MM-dd')}.csv`
      };
    }

    // Get unique housekeeper and room IDs
    const housekeeperIds = [...new Set(performanceData.map(p => p.housekeeper_id))];
    const roomIds = [...new Set(performanceData.map(p => p.room_id))];

    // Fetch housekeepers data
    const { data: housekeepers } = await supabase
      .from('profiles')
      .select('id, full_name, nickname')
      .in('id', housekeeperIds);

    // Fetch rooms data
    const { data: rooms } = await supabase
      .from('rooms')
      .select('id, room_number, hotel, room_type')
      .in('id', roomIds);

    // Create lookup maps
    const housekeeperMap = new Map(housekeepers?.map(h => [h.id, h]) || []);
    const roomMap = new Map(rooms?.map(r => [r.id, r]) || []);

    const excelData = performanceData.map((record: any) => {
      const housekeeper = housekeeperMap.get(record.housekeeper_id);
      const room = roomMap.get(record.room_id);

      return {
        'Date': format(new Date(record.assignment_date), 'yyyy-MM-dd'),
        'Hotel': room?.hotel || 'N/A',
        'Room Number': room?.room_number || 'N/A',
        'Room Type': room?.room_type || 'N/A',
        'Housekeeper': housekeeper?.full_name || 'Unknown',
        'Nickname': housekeeper?.nickname || 'N/A',
        'Assignment Type': record.assignment_type.replace('_', ' '),
        'Started At': format(new Date(record.started_at), 'yyyy-MM-dd HH:mm:ss'),
        'Completed At': format(new Date(record.completed_at), 'yyyy-MM-dd HH:mm:ss'),
        'Actual Duration (min)': record.actual_duration_minutes,
        'Estimated Duration (min)': record.estimated_duration_minutes || 'N/A',
        'Efficiency Score': Math.round(record.efficiency_score),
        'Performance': record.efficiency_score >= 100 ? 'Above Target' : 'Below Target'
      };
    });

    return {
      data: excelData,
      fileName: `housekeeping-performance-${format(new Date(), 'yyyy-MM-dd')}.csv`
    };
  };

  const generateRoomsReport = async () => {
    // Get rooms data
    let roomsQuery = supabase
      .from('rooms')
      .select('*')
      .order('hotel', { ascending: true });

    if (selectedHotel && selectedHotel !== 'all') {
      roomsQuery = roomsQuery.eq('hotel', selectedHotel);
    }

    const { data: roomsData, error: roomsError } = await roomsQuery;
    if (roomsError) throw roomsError;

    if (!roomsData || roomsData.length === 0) {
      return {
        data: [],
        fileName: `rooms-status-${format(new Date(), 'yyyy-MM-dd')}.csv`
      };
    }

    // Get unique cleaner IDs (excluding null values)
    const cleanerIds = [...new Set(roomsData
      .map(r => r.last_cleaned_by)
      .filter(id => id !== null)
    )];

    // Fetch cleaner profiles if there are any
    let cleaners: any[] = [];
    if (cleanerIds.length > 0) {
      const { data: cleanerData } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .in('id', cleanerIds);
      cleaners = cleanerData || [];
    }

    // Create cleaner lookup map
    const cleanerMap = new Map(cleaners.map(c => [c.id, c]));

    const excelData = roomsData.map((room: any) => {
      const lastCleaned = room.last_cleaned_at ? new Date(room.last_cleaned_at) : null;
      const hoursSinceClean = lastCleaned ? 
        Math.floor((new Date().getTime() - lastCleaned.getTime()) / (1000 * 60 * 60)) : null;
      const cleaner = room.last_cleaned_by ? cleanerMap.get(room.last_cleaned_by) : null;

      return {
        'Hotel': room.hotel,
        'Room Number': room.room_number,
        'Room Name': room.room_name || 'N/A',
        'Room Type': room.room_type,
        'Bed Type': room.bed_type || 'N/A',
        'Floor': room.floor_number || 'N/A',
        'Status': room.status,
        'Is Checkout Room': room.is_checkout_room ? 'Yes' : 'No',
        'Guest Count': room.guest_count || 0,
        'Checkout Time': room.checkout_time ? format(new Date(room.checkout_time), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
        'Last Cleaned At': lastCleaned ? format(lastCleaned, 'yyyy-MM-dd HH:mm:ss') : 'Never',
        'Last Cleaned By': cleaner?.full_name || 'N/A',
        'Hours Since Clean': hoursSinceClean || 'N/A',
        'Needs Attention': hoursSinceClean && hoursSinceClean > 24 ? 'Yes' : 'No',
        'Notes': room.notes || 'None'
      };
    });

    return {
      data: excelData,
      fileName: `rooms-status-${format(new Date(), 'yyyy-MM-dd')}.csv`
    };
  };

  const generateSLAReport = async () => {
    let query = supabase
      .from('tickets')
      .select(`
        *,
        created_by:profiles!tickets_created_by_fkey(full_name, role),
        assigned_to:profiles!tickets_assigned_to_fkey(full_name, role)
      `)
      .order('created_at', { ascending: false });

    if (dateRange?.from) {
      query = query.gte('created_at', dateRange.from.toISOString());
    }
    if (dateRange?.to) {
      query = query.lte('created_at', dateRange.to.toISOString());
    }
    if (selectedHotel && selectedHotel !== 'all') {
      query = query.eq('hotel', selectedHotel);
    }

    const { data, error } = await query;
    if (error) throw error;

    const excelData = data?.map((ticket: any) => {
      const slaHours = {
        urgent: 2,
        high: 8,
        medium: 24,
        low: 72
      }[ticket.priority] || 24;

      const createdAt = new Date(ticket.created_at);
      const dueDate = new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000);
      const closedAt = ticket.closed_at ? new Date(ticket.closed_at) : new Date();
      const hoursToResolve = Math.floor((closedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60));
      const slaBreached = hoursToResolve > slaHours;
      const breachHours = slaBreached ? hoursToResolve - slaHours : 0;

      return {
        'Ticket Number': ticket.ticket_number,
        'Title': ticket.title,
        'Hotel': ticket.hotel || 'N/A',
        'Room Number': ticket.room_number,
        'Priority': ticket.priority.toUpperCase(),
        'Status': ticket.status.replace('_', ' ').toUpperCase(),
        'Created Date': format(createdAt, 'yyyy-MM-dd HH:mm:ss'),
        'SLA Due Date': format(dueDate, 'yyyy-MM-dd HH:mm:ss'),
        'Closed Date': ticket.closed_at ? format(new Date(ticket.closed_at), 'yyyy-MM-dd HH:mm:ss') : 'Open',
        'SLA Target (Hours)': slaHours,
        'Actual Resolution (Hours)': hoursToResolve,
        'SLA Status': slaBreached ? 'BREACHED' : 'MET',
        'Breach Hours': breachHours,
        'Breach Reason': ticket.sla_breach_reason || 'N/A',
        'Created By': ticket.created_by?.full_name || 'Unknown',
        'Assigned To': ticket.assigned_to?.full_name || 'Unassigned',
        'Department': ticket.department || 'N/A'
      };
    }) || [];

    return {
      data: excelData,
      fileName: `sla-compliance-${format(new Date(), 'yyyy-MM-dd')}.csv`
    };
  };

  const generateOperationalReport = async () => {
    // Get summary data from multiple tables
    const [ticketsResult, roomsResult, performanceResult] = await Promise.all([
      supabase.from('tickets').select('*'),
      supabase.from('rooms').select('*'),
      supabase.from('housekeeping_performance').select('*')
    ]);

    if (ticketsResult.error || roomsResult.error || performanceResult.error) {
      throw new Error('Failed to fetch operational data');
    }

    const tickets = ticketsResult.data || [];
    const rooms = roomsResult.data || [];
    const performance = performanceResult.data || [];

    // Group by hotel
    const hotelStats = rooms.reduce((acc: any, room: any) => {
      if (!acc[room.hotel]) {
        acc[room.hotel] = {
          hotel: room.hotel,
          totalRooms: 0,
          cleanRooms: 0,
          dirtyRooms: 0,
          checkoutRooms: 0,
          totalTickets: 0,
          openTickets: 0,
          completedTickets: 0,
          avgEfficiency: 0,
          performanceRecords: 0
        };
      }
      
      acc[room.hotel].totalRooms++;
      if (room.status === 'clean') acc[room.hotel].cleanRooms++;
      if (room.status === 'dirty') acc[room.hotel].dirtyRooms++;
      if (room.is_checkout_room) acc[room.hotel].checkoutRooms++;
      
      return acc;
    }, {});

    // Add ticket stats
    tickets.forEach((ticket: any) => {
      const hotel = ticket.hotel;
      if (hotelStats[hotel]) {
        hotelStats[hotel].totalTickets++;
        if (ticket.status === 'open' || ticket.status === 'in_progress') {
          hotelStats[hotel].openTickets++;
        }
        if (ticket.status === 'completed') {
          hotelStats[hotel].completedTickets++;
        }
      }
    });

    // Add performance stats
    performance.forEach((perf: any) => {
      const roomData = rooms.find(r => r.id === perf.room_id);
      if (roomData && hotelStats[roomData.hotel]) {
        hotelStats[roomData.hotel].performanceRecords++;
        hotelStats[roomData.hotel].avgEfficiency += perf.efficiency_score;
      }
    });

    const excelData = Object.values(hotelStats).map((stats: any) => ({
      'Hotel': stats.hotel,
      'Total Rooms': stats.totalRooms,
      'Clean Rooms': stats.cleanRooms,
      'Dirty Rooms': stats.dirtyRooms,
      'Checkout Rooms': stats.checkoutRooms,
      'Room Utilization': `${Math.round((stats.checkoutRooms / stats.totalRooms) * 100)}%`,
      'Cleanliness Rate': `${Math.round((stats.cleanRooms / stats.totalRooms) * 100)}%`,
      'Total Tickets': stats.totalTickets,
      'Open Tickets': stats.openTickets,
      'Completed Tickets': stats.completedTickets,
      'Ticket Resolution Rate': stats.totalTickets > 0 ? `${Math.round((stats.completedTickets / stats.totalTickets) * 100)}%` : '0%',
      'Avg Housekeeping Efficiency': stats.performanceRecords > 0 ? `${Math.round(stats.avgEfficiency / stats.performanceRecords)}%` : 'N/A',
      'Performance Records': stats.performanceRecords
    }));

    return {
      data: excelData,
      fileName: `operational-summary-${format(new Date(), 'yyyy-MM-dd')}.csv`
    };
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button 
            variant="outline" 
            className="flex items-center gap-1 sm:gap-2 bg-background/50 border-border/40 hover:bg-background/80 transition-colors px-2 sm:px-4"
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Reports</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Ticket Report</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <Label>Date Range</Label>
            <DateRangeFilter 
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
            />
          </div>

          <div>
            <Label>Hotel</Label>
            <HotelFilter 
              value={selectedHotel}
              onValueChange={setSelectedHotel}
            />
          </div>

          <div>
            <Label>Report Type</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tickets">📋 Tickets Report</SelectItem>
                <SelectItem value="housekeeping">🧹 Housekeeping Performance</SelectItem>
                <SelectItem value="rooms">🏨 Room Status & Utilization</SelectItem>
                <SelectItem value="sla">⏱️ SLA Compliance</SelectItem>
                <SelectItem value="operational">📊 Operational Summary</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button 
            onClick={generateReport} 
            disabled={loading}
            className="w-full gap-2"
          >
            <Download className="h-4 w-4" />
            {loading ? 'Generating...' : 'Download CSV Report'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}