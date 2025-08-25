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
import { Download, FileSpreadsheet } from 'lucide-react';
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
  const [reportType, setReportType] = useState<string>('all');

  const canAccessReports = profile?.role && ['admin', 'manager'].includes(profile.role);

  if (!canAccessReports) return null;

  const generateReport = async () => {
    setLoading(true);
    try {
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
      if (dateRange.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange.to) {
        query = query.lte('created_at', dateRange.to.toISOString());
      }
      if (selectedHotel && selectedHotel !== 'all') {
        query = query.eq('hotel', selectedHotel);
      }
          if (reportType !== 'all') {
            query = query.eq('status', reportType as 'open' | 'in_progress' | 'completed');
          }

      const { data, error } = await query;
      if (error) throw error;

      // Transform data for Excel export
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

      // Convert to CSV format
      if (excelData.length === 0) {
        toast({
          title: 'No Data',
          description: 'No tickets found for the selected filters',
          variant: 'destructive',
        });
        return;
      }

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
      
      const fileName = `hotel-tickets-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Reports
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
                <SelectItem value="all">All Tickets</SelectItem>
                <SelectItem value="open">Open Tickets</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button 
            onClick={generateReport} 
            disabled={loading}
            className="w-full gap-2"
          >
            <Download className="h-4 w-4" />
            {loading ? 'Generating...' : 'Download Excel Report'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}