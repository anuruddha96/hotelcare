import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { CalendarDays, Clock, MapPin, TrendingUp, Users, Download } from 'lucide-react';
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

interface AttendanceRecord {
  id: string;
  user_id: string;
  check_in_time: string;
  check_out_time: string | null;
  check_in_location: any;
  check_out_location: any;
  work_date: string;
  total_hours: number | null;
  break_duration: number;
  status: string;
  notes: string | null;
  profiles?: {
    full_name: string;
    role: string;
  } | null;
}

interface AttendanceSummary {
  total_days: number;
  total_hours: number;
  avg_hours_per_day: number;
  punctual_days: number;
  late_arrivals: number;
  early_departures: number;
}

export const AttendanceReports = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('week');
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [employees, setEmployees] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const isAdmin = profile?.role === 'admin' || profile?.role === 'hr' || profile?.role === 'manager' || profile?.role === 'housekeeping_manager' || profile?.role === 'top_management';

  useEffect(() => {
    if (user && isAdmin) {
      fetchEmployees();
    }
    fetchAttendanceData();
  }, [user, selectedPeriod, selectedEmployee, isAdmin]);

  const getDateRange = () => {
    const today = new Date();
    
    switch (selectedPeriod) {
      case 'today':
        return { start: today, end: today };
      case 'week':
        return { start: startOfWeek(today), end: endOfWeek(today) };
      case 'month':
        return { start: startOfMonth(today), end: endOfMonth(today) };
      case '30days':
        return { start: subDays(today, 30), end: today };
      default:
        return { start: startOfWeek(today), end: endOfWeek(today) };
    }
  };

  const fetchEmployees = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .neq('role', 'admin')
      .order('full_name');

    if (error) {
      console.error('Error fetching employees:', error);
      return;
    }

    setEmployees(data || []);
  };

  const fetchAttendanceData = async () => {
    if (!user) return;

    setIsLoading(true);
    const { start, end } = getDateRange();

    let query = supabase
      .from('staff_attendance')
      .select(`
        *,
        profiles:user_id (
          full_name,
          role
        )
      `)
      .gte('work_date', format(start, 'yyyy-MM-dd'))
      .lte('work_date', format(end, 'yyyy-MM-dd'))
      .order('work_date', { ascending: false })
      .order('check_in_time', { ascending: false });

    // Apply user filter
    if (isAdmin) {
      if (selectedEmployee && selectedEmployee !== 'all') {
        query = query.eq('user_id', selectedEmployee);
      }
    } else {
      // Non-admin users can only see their own records
      query = query.eq('user_id', user.id);
    }

    const { data: attendanceData, error: attendanceError } = await query;

    if (attendanceError) {
      toast({
        title: "Error",
        description: "Failed to fetch attendance data",
        variant: "destructive"
      });
      setIsLoading(false);
      return;
    }

    setAttendanceRecords((attendanceData as any) || []);

    // Fetch summary
    const targetUserId = isAdmin && selectedEmployee !== 'all' ? selectedEmployee : (isAdmin ? null : user.id);
    
    const { data: summaryData, error: summaryError } = await supabase
      .rpc('get_attendance_summary', {
        target_user_id: targetUserId,
        start_date: format(start, 'yyyy-MM-dd'),
        end_date: format(end, 'yyyy-MM-dd')
      });

    if (!summaryError && summaryData && typeof summaryData === 'object') {
      setSummary(summaryData as unknown as AttendanceSummary);
    }

    setIsLoading(false);
  };

  const exportToCSV = () => {
    const headers = [
      'Date',
      'Employee',
      'Role', 
      'Check In',
      'Check Out',
      'Total Hours',
      'Break Duration',
      'Status',
      'Location',
      'Notes'
    ];

    const csvData = attendanceRecords.map(record => [
      record.work_date,
      record.profiles?.full_name || 'Unknown',
      record.profiles?.role || 'Unknown',
      format(new Date(record.check_in_time), 'HH:mm'),
      record.check_out_time ? format(new Date(record.check_out_time), 'HH:mm') : 'N/A',
      record.total_hours ? `${record.total_hours}h` : 'N/A',
      `${record.break_duration}m`,
      record.status,
      record.check_in_location?.address || 'N/A',
      record.notes || ''
    ]);

    const csvContent = [headers, ...csvData]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'checked_in':
        return <Badge className="bg-green-500 text-white">Working</Badge>;
      case 'on_break':
        return <Badge className="bg-yellow-500 text-white">On Break</Badge>;
      case 'checked_out':
        return <Badge className="bg-gray-500 text-white">Completed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            {t('hr.management')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">{t('periods.today')}</SelectItem>
                <SelectItem value="week">{t('periods.thisWeek')}</SelectItem>
                <SelectItem value="month">{t('periods.thisMonth')}</SelectItem>
                <SelectItem value="30days">{t('periods.last30Days')}</SelectItem>
              </SelectContent>
            </Select>

            {isAdmin && (
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select Employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('periods.allEmployees')}</SelectItem>
                  {employees.map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.full_name} - {emp.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button onClick={exportToCSV} variant="outline" className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              {t('hr.exportCsv')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <CalendarDays className="h-4 w-4 text-blue-600" />
                <div>
                  <p className="text-sm font-medium">{t('hr.totalDays')}</p>
                  <p className="text-2xl font-bold">{summary.total_days}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <Clock className="h-4 w-4 text-green-600" />
                <div>
                  <p className="text-sm font-medium">{t('hr.totalHours')}</p>
                  <p className="text-2xl font-bold">{summary.total_hours.toFixed(1)}h</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-4 w-4 text-purple-600" />
                <div>
                  <p className="text-sm font-medium">{t('hr.avgHoursPerDay')}</p>
                  <p className="text-2xl font-bold">{summary.avg_hours_per_day.toFixed(1)}h</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <Users className="h-4 w-4 text-orange-600" />
                <div>
                  <p className="text-sm font-medium">{t('hr.punctualDays')}</p>
                  <p className="text-2xl font-bold">{summary.punctual_days}/{summary.total_days}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Attendance Records Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('hr.attendanceRecords')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('hr.date')}</TableHead>
                  {isAdmin && <TableHead>{t('hr.employee')}</TableHead>}
                  <TableHead>{t('hr.checkIn')}</TableHead>
                  <TableHead>{t('hr.checkOut')}</TableHead>
                  <TableHead>{t('hr.hours')}</TableHead>
                  <TableHead>{t('hr.status')}</TableHead>
                  <TableHead>{t('hr.location')}</TableHead>
                  <TableHead>{t('hr.notes')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendanceRecords.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>{format(new Date(record.work_date), 'MMM dd, yyyy')}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div>
                          <div className="font-medium">{record.profiles?.full_name}</div>
                          <div className="text-xs text-muted-foreground">{record.profiles?.role}</div>
                        </div>
                      </TableCell>
                    )}
                    <TableCell>{format(new Date(record.check_in_time), 'HH:mm')}</TableCell>
                    <TableCell>
                      {record.check_out_time ? format(new Date(record.check_out_time), 'HH:mm') : 'N/A'}
                    </TableCell>
                    <TableCell>
                      {record.total_hours ? `${record.total_hours.toFixed(1)}h` : 'N/A'}
                    </TableCell>
                    <TableCell>{getStatusBadge(record.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 max-w-xs">
                        <MapPin className="h-3 w-3" />
                        <span className="text-xs truncate">
                          {record.check_in_location?.address || 'N/A'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="text-xs truncate">{record.notes || '-'}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!isLoading && attendanceRecords.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {t('hr.noRecordsFound')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};