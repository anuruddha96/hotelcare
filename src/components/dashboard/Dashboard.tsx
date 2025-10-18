import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { TicketCard } from './TicketCard';
import { CreateTicketDialog } from './CreateTicketDialog';
import { TicketPermissionDialog } from './TicketPermissionDialog';
import { TicketDetailDialog } from './TicketDetailDialog';
import { UserManagementDialog } from './UserManagementDialog';
import { AccessManagementDialog } from './AccessManagementDialog';
import { AutoAssignmentService } from './AutoAssignmentService';
import { RoomManagement } from './RoomManagement';
import { CompanySettings } from './CompanySettings';
import { HousekeepingTab } from './HousekeepingTab';
import { RoomAssignmentSummaryDialog } from './RoomAssignmentSummaryDialog';
import { AttendanceTracker } from './AttendanceTracker';
import { AttendanceReports } from './AttendanceReports';
import { NotificationPermissionBanner } from './NotificationPermissionBanner';
import { VisualNotificationOverlay, useVisualNotifications } from './VisualNotificationOverlay';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Users, Filter, Home, Ticket, Settings, Shield, Clock, Building2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  department?: string;
  hotel?: string;
  created_by?: {
    full_name: string;
    role: string;
  };
  assigned_to?: {
    full_name: string;
  };
}

export function Dashboard() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const { organization, hotels } = useTenant();
  const { notifications, addNotification, removeNotification } = useVisualNotifications();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [ticketPermissionDialogOpen, setTicketPermissionDialogOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [userManagementOpen, setUserManagementOpen] = useState(false);
  const [accessManagementOpen, setAccessManagementOpen] = useState(false);
  const [companySettingsOpen, setCompanySettingsOpen] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<string | null>(null);

  useEffect(() => {
    const handleVisualNotification = (event: CustomEvent) => {
      const { title, message, type } = event.detail;
      addNotification(title, message, type);
    };

    window.addEventListener('visual-notification', handleVisualNotification as EventListener);
    return () => {
      window.removeEventListener('visual-notification', handleVisualNotification as EventListener);
    };
  }, [addNotification]);

  const canCreateTickets = profile?.role && [
    'housekeeping', 'reception', 'manager', 'admin', 'maintenance',
    'housekeeping_manager', 'maintenance_manager', 'marketing_manager', 
    'reception_manager', 'back_office_manager', 'control_manager', 
    'finance_manager', 'top_management_manager'
  ].includes(profile.role);
  
  const canManageUsers = profile?.role === 'admin';
  
  const isManager = profile?.role && [
    'manager', 'admin', 'housekeeping_manager', 'maintenance_manager',
    'marketing_manager', 'reception_manager', 'back_office_manager',
    'control_manager', 'finance_manager', 'top_management_manager'
  ].includes(profile.role);

  const fetchTickets = async () => {
    setLoading(true);
    
    console.log('fetchTickets called with profile:', profile);
    console.log('Profile role:', profile?.role);
    console.log('Profile id:', profile?.id);
    
    if (!profile || !profile.id) {
      console.log('No profile or profile.id, returning empty tickets');
      setTickets([]);
      setLoading(false);
      return;
    }

    try {
      const selectColumns = `
        *,
        created_by_profile:profiles!tickets_created_by_fkey(full_name, role),
        assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, role),
        closed_by_profile:profiles!tickets_closed_by_fkey(full_name, role)
      `;
      
      let query = supabase
        .from('tickets')
        .select(selectColumns as any)
        .order('created_at', { ascending: false });

      // Filter by assigned hotel if user has one selected - check both hotel_id and hotel_name
      if (profile.assigned_hotel) {
        const { data: hotelName } = await supabase
          .rpc('get_hotel_name_from_id', { hotel_id: profile.assigned_hotel });
        
        query = query.or(`hotel.eq.${profile.assigned_hotel},hotel.eq.${hotelName}`);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      const parsed = (data || []).map((d: any) => ({
        id: d.id,
        ticket_number: d.ticket_number,
        title: d.title,
        description: d.description,
        room_number: d.room_number,
        priority: d.priority,
        status: d.status,
        created_at: d.created_at,
        updated_at: d.updated_at,
        department: d.department,
        hotel: d.hotel,
        created_by: d.created_by_profile ? {
          full_name: d.created_by_profile.full_name,
          role: d.created_by_profile.role,
        } : undefined,
        assigned_to: d.assigned_to_profile ? {
          full_name: d.assigned_to_profile.full_name,
        } : undefined,
      })) as Ticket[];
      setTickets(parsed);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch tickets',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const searchClosedTickets = async (searchTerm: string) => {
    try {
      const { data, error } = await supabase.rpc('search_closed_tickets' as any, {
        search_term: searchTerm
      });
      
      if (error) throw error;
      return data || [];
    } catch (error: any) {
      console.error('Error searching closed tickets:', error);
      return [];
    }
  };

  useEffect(() => {
    if (!profile?.id) return;
    fetchTickets();
    checkTodayAttendance();
  }, [profile?.id, profile?.role]);

  useEffect(() => {
    checkTodayAttendance();
  }, [profile?.id]);

  const filteredTickets = tickets
    .filter(ticket => {
    const matchesSearch = ticket.ticket_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         ticket.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         ticket.room_number.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || ticket.priority === priorityFilter;
    const matchesDepartment = departmentFilter === 'all' || ticket.department === departmentFilter;
    
    const isSearchingSpecific = searchQuery.trim() !== '' && (
      ticket.ticket_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.room_number.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const showCompleted = statusFilter === 'completed' || isSearchingSpecific;
    const shouldShow = ticket.status !== 'completed' || showCompleted;
    
    return matchesSearch && matchesStatus && matchesPriority && matchesDepartment && shouldShow;
  });

  const getTicketCounts = () => {
    return {
      total: tickets.length,
      open: tickets.filter(t => t.status === 'open').length,
      inProgress: tickets.filter(t => t.status === 'in_progress').length,
      completed: tickets.filter(t => t.status === 'completed').length,
    };
  };

  const counts = getTicketCounts();

  const checkTodayAttendance = async () => {
    if (!profile?.id) return;
    
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('staff_attendance')
      .select('status')
      .eq('user_id', profile.id)
      .eq('work_date', today)
      .single();
    
    if (!error && data) {
      setAttendanceStatus(data.status);
    } else {
      setAttendanceStatus(null);
    }
  };

  const getDefaultTab = (role?: string) => {
    if (!role) return "rooms";
    
    switch (role) {
      case 'housekeeping':
        return (!attendanceStatus || attendanceStatus === 'on_break') ? "attendance" : "housekeeping";
      case 'housekeeping_manager':
        return "housekeeping";
      case 'maintenance':
        return "tickets";
      case 'reception':
      case 'front_office':
        return "rooms";
      default:
        return "rooms";
    }
  };

  const [activeTab, setActiveTab] = useState<string>(getDefaultTab(profile?.role));
  
  useEffect(() => {
    setActiveTab(getDefaultTab(profile?.role));
  }, [profile?.role, attendanceStatus]);

  return (
    <div className="min-h-screen bg-background">
      <AutoAssignmentService />
      <NotificationPermissionBanner />
      <VisualNotificationOverlay 
        notifications={notifications}
        onDismiss={removeNotification}
      />
      
      {/* Organization Info Banner - Super Admin & Admin only */}
      {(profile?.role === 'admin' || profile?.is_super_admin) && organization && (
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-background border-b">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-primary" />
                <div>
                  <h2 className="font-semibold text-sm">{organization.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {hotels.length} {hotels.length === 1 ? 'Hotel' : 'Hotels'} • Organization Slug: /{organization.slug}
                  </p>
                </div>
              </div>
              {profile?.is_super_admin && (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  Super Admin Access
                </Badge>
              )}
            </div>
          </div>
        </div>
      )}
      
      <div className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="flex flex-col gap-4 justify-between items-start">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                {profile?.assigned_hotel || t('dashboard.title')}
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground">
                {profile?.assigned_hotel ? `${profile.assigned_hotel} Management System` : t('dashboard.subtitle')}
              </p>
          </div>
          
          {/* Role-based navigation tabs */}
          <div className="w-full overflow-x-auto">
            {profile?.role === 'housekeeping' ? (
              <TabsList className="grid w-full min-w-[320px] max-w-md grid-cols-3 h-10 sm:h-12">
                <TabsTrigger value="tickets" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Ticket className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.tickets')}</span>
                </TabsTrigger>
                <TabsTrigger value="housekeeping" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.myTasks')}</span>
                </TabsTrigger>
                <TabsTrigger value="attendance" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.workStatus')}</span>
                </TabsTrigger>
              </TabsList>
            ) : profile?.role === 'maintenance' ? (
              <TabsList className="grid w-full min-w-[240px] max-w-md grid-cols-2 h-10 sm:h-12">
                <TabsTrigger value="tickets" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Ticket className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.tickets')}</span>
                </TabsTrigger>
                <TabsTrigger value="attendance" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.workStatus')}</span>
                </TabsTrigger>
              </TabsList>
            ) : profile?.role === 'admin' ? (
              <TabsList className="grid w-full min-w-[500px] max-w-xl grid-cols-5 h-10 sm:h-12">
                <TabsTrigger value="tickets" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Ticket className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.tickets')}</span>
                </TabsTrigger>
                <TabsTrigger value="rooms" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Home className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.rooms')}</span>
                </TabsTrigger>
                <TabsTrigger value="housekeeping" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.housekeeping')}</span>
                </TabsTrigger>
                <TabsTrigger value="attendance" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.workStatus')}</span>
                </TabsTrigger>
                <TabsTrigger value="admin" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Settings className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>Admin</span>
                </TabsTrigger>
              </TabsList>
            ) : ['manager','housekeeping_manager'].includes(profile?.role || '') ? (
              <TabsList className="grid w-full min-w-[400px] max-w-lg grid-cols-4 h-10 sm:h-12">
                <TabsTrigger value="tickets" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Ticket className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.tickets')}</span>
                </TabsTrigger>
                <TabsTrigger value="rooms" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Home className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.rooms')}</span>
                </TabsTrigger>
                <TabsTrigger value="housekeeping" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.housekeeping')}</span>
                </TabsTrigger>
                <TabsTrigger value="attendance" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.workStatus')}</span>
                </TabsTrigger>
              </TabsList>
            ) : (
              <TabsList className="grid w-full min-w-[320px] max-w-md grid-cols-3 h-10 sm:h-12">
                <TabsTrigger value="tickets" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Ticket className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.tickets')}</span>
                </TabsTrigger>
                <TabsTrigger value="rooms" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Home className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.rooms')}</span>
                </TabsTrigger>
                <TabsTrigger value="attendance" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>{t('dashboard.workStatus')}</span>
                </TabsTrigger>
              </TabsList>
            )}
          </div>
        </div>

          <TabsContent value="tickets" className="space-y-6">
            <div className="flex flex-col gap-3 sm:gap-4 justify-between items-start">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                  {profile?.role === 'maintenance' ? t('tickets.myTickets') : t('tasks.allTickets')}
                  {profile?.assigned_hotel && (
                    <span className="block sm:inline text-base sm:text-lg font-normal text-muted-foreground sm:ml-2">
                      {profile.assigned_hotel}
                    </span>
                  )}
                </h2>
                <p className="text-sm sm:text-base text-muted-foreground">
                  {profile?.role === 'maintenance' 
                    ? t('tickets.assignedToYou') 
                    : profile?.assigned_hotel && profile?.role !== 'admin' && profile?.role !== 'top_management'
                      ? `${t('tasks.manageTickets')} ${profile.assigned_hotel}`
                      : t('tickets.manageAllHotels')
                  }
                </p>
              </div>
              
              <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                {isManager && (
                  <RoomAssignmentSummaryDialog />
                )}
                {canManageUsers && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUserManagementOpen(true)}
                    className="text-xs sm:text-sm"
                  >
                    <Users className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">Manage Users</span>
                    <span className="sm:hidden">Users</span>
                  </Button>
                )}
                {canManageUsers && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAccessManagementOpen(true)}
                      className="text-xs sm:text-sm"
                    >
                      <Shield className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Access Control</span>
                      <span className="sm:hidden">Access</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTicketPermissionDialogOpen(true)}
                      className="text-xs sm:text-sm"
                    >
                      <Ticket className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Ticket Permissions</span>
                      <span className="sm:hidden">Tickets</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCompanySettingsOpen(true)}
                      className="text-xs sm:text-sm"
                    >
                      <Settings className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Company Settings</span>
                      <span className="sm:hidden">Settings</span>
                    </Button>
                  </>
                )}
                {canCreateTickets && (
                  <Button
                    onClick={() => setCreateDialogOpen(true)}
                    size="sm"
                    className="text-xs sm:text-sm"
                  >
                    <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">{t('dashboard.newTicket')}</span>
                    <span className="sm:hidden">New</span>
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs sm:text-sm font-medium">{t('tickets.total')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl sm:text-2xl font-bold">{counts.total}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs sm:text-sm font-medium">{t('tickets.open')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl sm:text-2xl font-bold text-yellow-500">{counts.open}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs sm:text-sm font-medium">{t('tickets.inProgress')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl sm:text-2xl font-bold text-blue-500">{counts.inProgress}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs sm:text-sm font-medium">{t('tickets.completed')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl sm:text-2xl font-bold text-green-500">{counts.completed}</div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-3 sm:gap-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t('tickets.searchPlaceholder')}
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-[130px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                    <SelectTrigger className="w-full sm:w-[130px]">
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Priority</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                    <SelectTrigger className="w-full sm:w-[150px]">
                      <SelectValue placeholder="Department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="housekeeping">Housekeeping</SelectItem>
                      <SelectItem value="reception">Reception</SelectItem>
                      <SelectItem value="front_office">Front Office</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : filteredTickets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery || statusFilter !== 'all' || priorityFilter !== 'all' || departmentFilter !== 'all'
                  ? 'No tickets match your filters'
                  : 'No tickets found'}
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {filteredTickets.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    onClick={() => setSelectedTicket(ticket)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rooms" className="space-y-6">
            <RoomManagement />
          </TabsContent>

          <TabsContent value="housekeeping" className="space-y-6">
            <HousekeepingTab />
          </TabsContent>

          <TabsContent value="attendance" className="space-y-6">
            {(profile?.role === 'housekeeping' || profile?.role === 'maintenance' || isManager) && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold">Work Status & Attendance</h2>
                <AttendanceTracker />
                <AttendanceReports />
              </div>
            )}
          </TabsContent>

          {/* Admin Tab - Organization & Hotel Management */}
          {profile?.role === 'admin' && (
            <TabsContent value="admin" className="space-y-6">
              <AdminTabs />
            </TabsContent>
          )}
        </Tabs>

        {/* Dialogs */}
        <CreateTicketDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onTicketCreated={fetchTickets}
        />
        
        {selectedTicket && (
          <TicketDetailDialog
            ticket={selectedTicket}
            open={!!selectedTicket}
            onOpenChange={() => setSelectedTicket(null)}
            onTicketUpdated={() => {
              fetchTickets();
              setSelectedTicket(null);
            }}
          />
        )}
        
        {canManageUsers && (
          <>
            <UserManagementDialog
              open={userManagementOpen}
              onOpenChange={setUserManagementOpen}
            />
            <AccessManagementDialog
              open={accessManagementOpen}
              onOpenChange={setAccessManagementOpen}
            />
            <TicketPermissionDialog
              open={ticketPermissionDialogOpen}
              onOpenChange={setTicketPermissionDialogOpen}
            />
            <CompanySettings
              open={companySettingsOpen}
              onOpenChange={setCompanySettingsOpen}
            />
          </>
        )}
      </div>
    </div>
  );
}
