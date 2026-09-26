import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { maintenanceQueueCounts, maintenanceMatchesFilter, sortMaintenanceTickets } from '@/lib/maintenanceQueue';
import { MaintenanceIssueAnalytics } from './MaintenanceIssueAnalytics';
import { TicketCard } from './TicketCard';
import { CreateTicketDialog } from './CreateTicketDialog';
import { TicketPermissionDialog } from './TicketPermissionDialog';
import { TicketDetailDialog } from './TicketDetailDialog';
import { UserManagementDialog } from './UserManagementDialog';
import { AccessManagementDialog } from './AccessManagementDialog';
import { AutoAssignmentService } from './AutoAssignmentService';
import { RoomManagement } from './RoomManagement';
import { HotelRoomOverview } from './HotelRoomOverview';
import { CompanySettings } from './CompanySettings';
import { HousekeepingTab } from './HousekeepingTab';
import { MinibarTrackingView } from './MinibarTrackingView';
import { LostAndFoundManagement } from './LostAndFoundManagement';
import { MaintenanceStaffView } from './MaintenanceStaffView';
import { AttendanceTracker } from './AttendanceTracker';
import { AttendanceReports } from './AttendanceReports';
import { NotificationPermissionBanner } from './NotificationPermissionBanner';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';

import { AdminTabs } from '@/components/admin/AdminTabs';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Users, Home, Ticket, Settings, Shield, Clock, Building2, Package as PackageIcon, TrendingUp, Receipt, CarFront } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'completed';
  on_hold: boolean | null;
  hold_reason: string | null;
  sla_due_date: string | null;
  created_at: string;
  updated_at: string;
  department?: string;
  hotel?: string;
  attachment_urls?: string[] | null;
  completion_photos?: string[] | null;
  pending_supervisor_approval: boolean | null;
  resolution_text: string | null;
  closed_at?: string | null;
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
  const noMinibar = isGozsduCourtHotel(profile?.assigned_hotel);
  const { t, language } = useTranslation();
  const { organization, hotels } = useTenant();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticketLoadError, setTicketLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('work');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [ticketPermissionDialogOpen, setTicketPermissionDialogOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [userManagementOpen, setUserManagementOpen] = useState(false);
  const [accessManagementOpen, setAccessManagementOpen] = useState(false);
  const [companySettingsOpen, setCompanySettingsOpen] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<string | null>(null);
  const [hotelDisplayName, setHotelDisplayName] = useState<string | null>(null);
  const [receptionStaffMap, setReceptionStaffMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchStaffForReception = async () => {
      if (profile?.role !== 'reception' || !profile?.assigned_hotel) return;
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['housekeeping', 'housekeeping_manager', 'manager'])
        .eq('assigned_hotel', profile.assigned_hotel);
      if (data) setReceptionStaffMap(Object.fromEntries(data.map(s => [s.id, s.full_name])));
    };
    fetchStaffForReception();
  }, [profile?.role, profile?.assigned_hotel]);

  useEffect(() => {
    const resolveHotelName = async () => {
      if (!profile?.assigned_hotel) return;
      const { data } = await supabase
        .from('hotel_configurations')
        .select('hotel_name')
        .eq('hotel_id', profile.assigned_hotel)
        .limit(1);
      setHotelDisplayName(data && data.length > 0 ? data[0].hotel_name : profile.assigned_hotel);
    };
    resolveHotelName();
  }, [profile?.assigned_hotel]);

  const canCreateTickets = profile?.role && [
    'housekeeping', 'reception', 'manager', 'admin', 'maintenance',
    'housekeeping_manager', 'maintenance_manager', 'marketing_manager',
    'reception_manager', 'back_office_manager', 'control_manager',
    'finance_manager', 'top_management', 'top_management_manager'
  ].includes(profile.role);
  const canManageUsers = profile?.role === 'admin' || profile?.is_super_admin;
  const isManager = profile?.role && [
    'manager', 'admin', 'housekeeping_manager', 'maintenance_manager',
    'marketing_manager', 'reception_manager', 'back_office_manager',
    'control_manager', 'finance_manager', 'top_management', 'top_management_manager'
  ].includes(profile.role);

  const fetchTickets = async () => {
    setLoading(true);
    setTicketLoadError(null);
    if (!profile?.id || !profile.organization_slug || !profile.assigned_hotel) {
      setTickets([]);
      setTicketLoadError('Select a hotel to view its maintenance issues.');
      setLoading(false);
      return;
    }
    try {
      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);
      if (!hotelKeys.length) throw new Error('The selected hotel could not be resolved.');
      const selectColumns = `
        *,
        created_by_profile:profiles!tickets_created_by_fkey(full_name, role),
        assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, role),
        closed_by_profile:profiles!tickets_closed_by_fkey(full_name, role)
      `;
      const pageSize = 1000;
      const all: any[] = [];
      for (let offset = 0; ; offset += pageSize) {
        if (offset >= 50000) throw new Error('Too many maintenance issues to load. Narrow the reporting period.');
        const { data, error } = await (supabase as any).from('tickets')
          .select(selectColumns)
          .eq('organization_slug', profile.organization_slug)
          .eq('department', 'maintenance')
          .in('hotel', hotelKeys)
          .order('created_at', { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        all.push(...(data || []));
        if ((data || []).length < pageSize) break;
      }
      const parsed: Ticket[] = all.map((d: any) => ({
        id: d.id, ticket_number: d.ticket_number, title: d.title,
        description: d.description, room_number: d.room_number,
        priority: d.priority, status: d.status, on_hold: d.on_hold, hold_reason: d.hold_reason,
        sla_due_date: d.sla_due_date, created_at: d.created_at,
        updated_at: d.updated_at, department: d.department, hotel: d.hotel,
        attachment_urls: d.attachment_urls, completion_photos: d.completion_photos,
        resolution_text: d.resolution_text, closed_at: d.closed_at,
        pending_supervisor_approval: d.pending_supervisor_approval,
        created_by: d.created_by_profile ? { full_name: d.created_by_profile.full_name, role: d.created_by_profile.role } : undefined,
        assigned_to: d.assigned_to_profile ? { full_name: d.assigned_to_profile.full_name } : undefined,
      }));
      setTickets(sortMaintenanceTickets(parsed));
    } catch (error: any) {
      setTickets([]);
      setTicketLoadError(error?.message || 'Maintenance issues could not be loaded.');
      toast({ title: 'Maintenance issues unavailable', description: 'Retry the selected hotel.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const openCreatedMaintenanceIssue = async (ticketId: string) => {
    if (!profile?.organization_slug) return;
    const { data, error } = await (supabase as any).from('tickets')
      .select(`*, created_by_profile:profiles!tickets_created_by_fkey(full_name, role), assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, role), closed_by_profile:profiles!tickets_closed_by_fkey(full_name, role)`)
      .eq('id', ticketId).eq('organization_slug', profile.organization_slug)
      .eq('department', 'maintenance').maybeSingle();
    if (error || !data) {
      toast({ title: language === 'hu' ? 'Nem sikerült megnyitni a hibát' : 'Could not open issue',
        description: error?.message || 'Check hotel permissions and refresh the issue list.', variant: 'destructive' });
      return;
    }
    setSelectedTicket({
      id: data.id, ticket_number: data.ticket_number, title: data.title,
      description: data.description, room_number: data.room_number,
      priority: data.priority, status: data.status, on_hold: data.on_hold,
      hold_reason: data.hold_reason, sla_due_date: data.sla_due_date,
      created_at: data.created_at, updated_at: data.updated_at,
      department: data.department, hotel: data.hotel, attachment_urls: data.attachment_urls,
      completion_photos: data.completion_photos, resolution_text: data.resolution_text,
      closed_at: data.closed_at, pending_supervisor_approval: data.pending_supervisor_approval,
      created_by: data.created_by_profile ? { full_name: data.created_by_profile.full_name, role: data.created_by_profile.role } : undefined,
      assigned_to: data.assigned_to_profile ? { full_name: data.assigned_to_profile.full_name } : undefined,
    });
  };

  useEffect(() => {
    if (!profile?.id) return;
    fetchTickets();
    checkTodayAttendance();
  }, [profile?.id, profile?.role, profile?.assigned_hotel, profile?.organization_slug]);

  useEffect(() => { checkTodayAttendance(); }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id || !profile.organization_slug || !profile.assigned_hotel) return;
    const refresh = () => void fetchTickets();
    const channel = supabase.channel(`maintenance-main-${profile.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tickets',
        filter: `organization_slug=eq.${profile.organization_slug}`,
      }, (event: any) => {
        const record = event.new || event.old;
        if (!record?.department || record.department === 'maintenance') refresh();
      }).subscribe();
    window.addEventListener('maintenance-ticket-created', refresh);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('maintenance-ticket-created', refresh);
    };
  }, [profile?.id, profile?.assigned_hotel, profile?.organization_slug]);

  const filteredTickets = tickets.filter(ticket => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = ticket.ticket_number.toLowerCase().includes(query) ||
      ticket.title.toLowerCase().includes(query) ||
      ticket.room_number.toLowerCase().includes(query);
    const matchesStatus = maintenanceMatchesFilter(ticket, statusFilter);
    const matchesPriority = priorityFilter === 'all' || ticket.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });
  const counts = maintenanceQueueCounts(tickets);

  const checkTodayAttendance = async () => {
    if (!profile?.id) return;
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('staff_attendance')
      .select('status')
      .eq('user_id', profile.id)
      .eq('work_date', today)
      .single();
    setAttendanceStatus(!error && data ? data.status : null);
  };

  const getDefaultTab = (role?: string) => {
    if (!role) return 'rooms';
    switch (role) {
      case 'housekeeping': return attendanceStatus === 'checked_in' ? 'housekeeping' : 'attendance';
      case 'housekeeping_manager':
      case 'manager':
      case 'admin':
      case 'top_management':
      case 'top_management_manager': return 'housekeeping';
      case 'maintenance': return 'maintenance-tasks';
      case 'reception':
      case 'front_office': return noMinibar ? 'rooms' : 'minibar';
      default: return 'rooms';
    }
  };

  const [activeTab, setActiveTab] = useState<string>(getDefaultTab(profile?.role));
  const [activeHousekeepingSubTab, setActiveHousekeepingSubTab] = useState<string>('');
  const [activeInnerTab, setActiveInnerTab] = useState<string>('team');

  useEffect(() => { setActiveTab(getDefaultTab(profile?.role)); }, [profile?.role, attendanceStatus, noMinibar]);

  useEffect(() => {
    const urlTab = searchParams.get('tab');
    const valid = ['tickets', 'rooms', 'housekeeping', 'attendance', 'minibar', 'lost-found', 'maintenance-tasks', 'admin'];
    if (urlTab && valid.includes(urlTab)) {
      setActiveTab(urlTab === 'minibar' && noMinibar ? 'rooms' : urlTab);
      searchParams.delete('tab');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const mainTabLabels: Record<string, string> = useMemo(() => ({
    tickets: 'Maintenance issues', rooms: t('dashboard.rooms'), housekeeping: t('dashboard.housekeeping'),
    attendance: t('dashboard.workStatus'), admin: 'Admin', 'maintenance-tasks': t('dashboard.myTasks'),
    minibar: 'Minibar', 'lost-found': 'Lost & Found',
  }), [t]);
  const housekeepingSubTabLabels: Record<string, string> = useMemo(() => ({
    'staff-management': t('housekeeping.tabs.staffManagement'), 'supervisor': t('housekeeping.tabs.pendingApprovals'),
    'manage': t('housekeeping.tabs.teamView'), 'performance': t('housekeeping.tabs.performance'),
    'pms-upload': t('housekeeping.tabs.pmsUpload'), 'completion-photos': t('housekeeping.tabs.roomPhotos'),
    'dnd-photos': t('housekeeping.tabs.dndPhotos'), 'maintenance-photos': t('housekeeping.tabs.maintenance'),
    'lost-and-found': t('housekeeping.tabs.lostFound'), 'dirty-linen': t('housekeeping.tabs.dirtyLinen'),
    'attendance': t('housekeeping.tabs.hrManagement'), 'staff-schedule': 'Staff schedule',
    'minibar': t('housekeeping.tabs.minibarTracking'), 'tab-order': t('housekeeping.tabs.tabSettings'),
    'assignments': t('housekeeping.myTasks'),
  }), [t]);
  const innerTabLabels: Record<string, string> = useMemo(() => ({
    team: t('manager.teamView'), 'early-signout': t('manager.earlySignOutApprovals'),
  }), [t]);

  useEffect(() => {
    const handleTrainingNavigate = (event: CustomEvent<{ mainTab?: string; tab?: string; subTab?: string }>) => {
      const detail = event.detail || {};
      const mainTab = detail.mainTab || detail.tab;
      if (mainTab) setActiveTab(mainTab === 'minibar' && noMinibar ? 'rooms' : mainTab);
    };
    window.addEventListener('training-navigate', handleTrainingNavigate as EventListener);
    window.addEventListener('tour:navigate', handleTrainingNavigate as EventListener);
    return () => {
      window.removeEventListener('training-navigate', handleTrainingNavigate as EventListener);
      window.removeEventListener('tour:navigate', handleTrainingNavigate as EventListener);
    };
  }, [noMinibar]);

  const operationalFilters = [
    { id: 'overdue', label: language === 'hu' ? 'Lejárt' : 'Overdue', count: counts.overdue, emphasis: 'text-red-600' },
    { id: 'due_soon', label: language === 'hu' ? 'Hamarosan esedékes' : 'Due soon', count: counts.dueSoon, emphasis: 'text-amber-600' },
    { id: 'active', label: language === 'hu' ? 'Nyitott' : 'Open', count: counts.active, emphasis: '' },
    { id: 'progress', label: language === 'hu' ? 'Folyamatban' : 'In progress', count: counts.progress, emphasis: 'text-blue-600' },
    { id: 'hold', label: language === 'hu' ? 'Várakozik' : 'On hold', count: counts.hold, emphasis: '' },
    { id: 'approval', label: language === 'hu' ? 'Jóváhagyásra vár' : 'Awaiting approval', count: counts.approval, emphasis: '' },
  ] as const;

  return (
    <div className="min-h-screen bg-background">
      <AutoAssignmentService />
      <NotificationPermissionBanner />
      {(profile?.role === 'admin' || profile?.is_super_admin) && organization && (
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-background border-b">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-primary" />
                <div><h2 className="font-semibold text-sm">{organization.name}</h2><p className="text-xs text-muted-foreground">{hotels.length} {hotels.length === 1 ? 'Hotel' : 'Hotels'} • Organization Slug: /{organization.slug}</p></div>
              </div>
              {profile?.is_super_admin && <Badge variant="destructive" className="flex items-center gap-1"><Shield className="h-3 w-3" />Super Admin Access</Badge>}
            </div>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 py-6">
        <div className="mb-4">
          <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbPage className="text-xs text-primary font-medium">{mainTabLabels[activeTab] || activeTab}</BreadcrumbPage></BreadcrumbItem>
            {activeTab === 'housekeeping' && activeHousekeepingSubTab && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage className="text-xs text-primary font-medium">{housekeepingSubTabLabels[activeHousekeepingSubTab] || activeHousekeepingSubTab}</BreadcrumbPage></BreadcrumbItem>
              {activeHousekeepingSubTab === 'manage' && activeInnerTab && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage className="text-xs text-primary font-medium">{innerTabLabels[activeInnerTab] || activeInnerTab}</BreadcrumbPage></BreadcrumbItem></>}
            </>}
          </BreadcrumbList></Breadcrumb>
        </div>

        <Tabs value={noMinibar && activeTab === 'minibar' ? 'rooms' : activeTab} onValueChange={(val) => { setActiveTab(val); setActiveHousekeepingSubTab(''); setActiveInnerTab('team'); }} className="space-y-6">
          <div className="flex flex-col gap-4 justify-between items-start">
            <div><h1 className="text-2xl sm:text-3xl font-bold text-foreground">{hotelDisplayName || t('dashboard.title')}</h1>
              <p className="text-sm sm:text-base text-muted-foreground">{hotelDisplayName ? t('dashboard.managementSystem').replace('{hotel}', hotelDisplayName) : t('dashboard.subtitle')}</p></div>
            <div className="w-full overflow-x-auto">
              {profile?.role === 'housekeeping' ? (
                <TabsList className="grid w-full min-w-[320px] max-w-md grid-cols-3 h-10 sm:h-12" data-training="main-tabs">
                  <TabsTrigger value="tickets" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm" data-training="tickets-tab"><Ticket className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.tickets')}</span></TabsTrigger>
                  <TabsTrigger value="housekeeping" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm" data-training="housekeeping-tab"><Users className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.myTasks')}</span></TabsTrigger>
                  <TabsTrigger value="attendance" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm" data-training="attendance-tab"><Clock className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.workStatus')}</span></TabsTrigger>
                </TabsList>
              ) : profile?.role === 'maintenance' ? (
                <TabsList className="grid w-full min-w-[320px] max-w-md grid-cols-3 h-10 sm:h-12">
                  <TabsTrigger value="tickets" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"><Ticket className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.tickets')}</span></TabsTrigger>
                  <TabsTrigger value="maintenance-tasks" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"><Ticket className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.myTasks')}</span></TabsTrigger>
                  <TabsTrigger value="attendance" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"><Clock className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.workStatus')}</span></TabsTrigger>
                </TabsList>
              ) : ['manager','housekeeping_manager','admin','top_management','top_management_manager'].includes(profile?.role || '') ? (
                <TabsList className="inline-flex w-auto h-10 sm:h-12 gap-1" data-training="main-tabs">
                  <TabsTrigger value="tickets" className="shrink-0 whitespace-nowrap flex items-center justify-center gap-1 sm:gap-2 text-[11px] sm:text-sm px-2 sm:px-3" data-training="tickets-tab"><Ticket className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" /><span>Maintenance issues</span></TabsTrigger>
                  <button type="button" onClick={() => navigate(`/${organizationSlug || 'rdhotels'}/reception`)} className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-1 sm:gap-2 rounded-md px-2 sm:px-3 py-1.5 text-[11px] sm:text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors" data-training="rooms-tab"><Home className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" /><span>Reception</span></button>
                  <button type="button" onClick={() => navigate(`/${organizationSlug || 'rdhotels'}/parking-tickets`)} className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-1 sm:gap-2 rounded-md px-2 sm:px-3 py-1.5 text-[11px] sm:text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"><CarFront className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" /><span>Parking Tickets</span></button>
                  <TabsTrigger value="housekeeping" className="shrink-0 whitespace-nowrap flex items-center justify-center gap-1 sm:gap-2 text-[11px] sm:text-sm px-2 sm:px-3" data-training="housekeeping-tab"><Users className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" /><span>Housekeeping</span></TabsTrigger>
                  <TabsTrigger value="attendance" className="shrink-0 whitespace-nowrap flex items-center justify-center gap-1 sm:gap-2 text-[11px] sm:text-sm px-2 sm:px-3" data-training="attendance-tab"><Clock className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" /><span>HR</span></TabsTrigger>
                  {['admin','top_management','top_management_manager'].includes(profile?.role || '') && <>
                    <button type="button" onClick={() => navigate(`/${organizationSlug || 'rdhotels'}/revenue`)} className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-1 sm:gap-2 rounded-md px-2 sm:px-3 py-1.5 text-[11px] sm:text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"><TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" /><span>Revenue Management</span></button>
                    <button type="button" onClick={() => navigate(`/${organizationSlug || 'rdhotels'}/purchase-invoices`)} className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-1 sm:gap-2 rounded-md px-2 sm:px-3 py-1.5 text-[11px] sm:text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"><Receipt className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" /><span>Invoices</span></button>
                  </>}
                  {profile?.role === 'admin' && <TabsTrigger value="admin" className="shrink-0 whitespace-nowrap flex items-center justify-center gap-1 sm:gap-2 text-[11px] sm:text-sm px-2 sm:px-3" data-training="admin-tab"><Settings className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" /><span>Admin</span></TabsTrigger>}
                </TabsList>
              ) : profile?.role === 'reception' ? (
                <TabsList className="flex w-full min-w-[320px] max-w-lg h-10 sm:h-12">
                  <TabsTrigger value="tickets" className="flex-1 flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"><Ticket className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.tickets')}</span></TabsTrigger>
                  <TabsTrigger value="rooms" className="flex-1 flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"><Home className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.rooms')}</span></TabsTrigger>
                  <TabsTrigger value="housekeeping" className="flex-1 flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"><Users className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.housekeeping')}</span></TabsTrigger>
                  {!noMinibar && <TabsTrigger value="minibar" className="flex-1 flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"><PackageIcon className="h-3 w-3 sm:h-4 sm:w-4" /><span>Minibar</span></TabsTrigger>}
                  <TabsTrigger value="lost-found" className="flex-1 flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"><PackageIcon className="h-3 w-3 sm:h-4 sm:w-4" /><span>Lost & Found</span></TabsTrigger>
                </TabsList>
              ) : (
                <TabsList className="grid w-full min-w-[320px] max-w-md grid-cols-3 h-10 sm:h-12" data-training="main-tabs">
                  <TabsTrigger value="tickets" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm" data-training="tickets-tab"><Ticket className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.tickets')}</span></TabsTrigger>
                  <TabsTrigger value="rooms" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm" data-training="rooms-tab"><Home className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.rooms')}</span></TabsTrigger>
                  <TabsTrigger value="attendance" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm" data-training="attendance-tab"><Clock className="h-3 w-3 sm:h-4 sm:w-4" /><span>{t('dashboard.workStatus')}</span></TabsTrigger>
                </TabsList>
              )}
            </div>
          </div>

          <TabsContent value="maintenance-tasks" className="space-y-6"><MaintenanceStaffView /></TabsContent>

          <TabsContent value="tickets" className="space-y-6">
            <div className="flex flex-col gap-3 sm:gap-4 justify-between items-start">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                  {profile?.role === 'maintenance' ? 'My maintenance issues' : 'Maintenance issues'}
                  {profile?.assigned_hotel && <span className="block sm:inline text-base sm:text-lg font-normal text-muted-foreground sm:ml-2">{profile.assigned_hotel}</span>}
                </h2>
                <p className="text-sm sm:text-base text-muted-foreground">{profile?.role === 'maintenance' ? t('tickets.assignedToYou') : profile?.assigned_hotel && profile?.role !== 'admin' && profile?.role !== 'top_management' ? `${t('tickets.manageFor')} ${profile.assigned_hotel}` : t('tickets.manageAllHotels')}</p>
              </div>
              <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                {canManageUsers && <Button variant="outline" size="sm" onClick={() => setUserManagementOpen(true)} className="text-xs sm:text-sm"><Users className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" /><span className="hidden sm:inline">{t('dashboard.manageUsers')}</span><span className="sm:hidden">{t('dashboard.manageUsersShort')}</span></Button>}
                {canManageUsers && <>
                  <Button variant="outline" size="sm" onClick={() => setAccessManagementOpen(true)} className="text-xs sm:text-sm"><Shield className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" /><span className="hidden sm:inline">Access Control</span><span className="sm:hidden">Access</span></Button>
                  <Button variant="outline" size="sm" onClick={() => setTicketPermissionDialogOpen(true)} className="text-xs sm:text-sm"><Ticket className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" /><span className="hidden sm:inline">Ticket Permissions</span><span className="sm:hidden">Tickets</span></Button>
                  <Button variant="outline" size="sm" onClick={() => setCompanySettingsOpen(true)} className="text-xs sm:text-sm"><Settings className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" /><span className="hidden sm:inline">Company Settings</span><span className="sm:hidden">Settings</span></Button>
                </>}
                {canCreateTickets && <Button onClick={() => setCreateDialogOpen(true)} size="sm" className="text-xs sm:text-sm"><Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" /><span className="hidden sm:inline">Report maintenance issue</span><span className="sm:hidden">New</span></Button>}
              </div>
            </div>

            {ticketLoadError && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{ticketLoadError} <Button variant="outline" size="sm" onClick={() => void fetchTickets()}>Retry</Button></div>}

            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Maintenance quick filters">
              {operationalFilters.map(item => <button key={item.id} type="button" onClick={() => setStatusFilter(item.id)} aria-pressed={statusFilter === item.id}
                className={`rounded-lg border bg-card p-3 text-left transition hover:border-primary/50 hover:shadow-sm ${statusFilter === item.id ? 'ring-2 ring-primary border-primary' : ''}`}>
                <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
                <div className={`mt-1 text-2xl font-bold ${item.emphasis}`}>{ticketLoadError ? '—' : item.count}</div>
              </button>)}
            </div>

            <div className="flex flex-col gap-3 sm:gap-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder={t('tickets.searchPlaceholder')} className="pl-8" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
                <div className="flex gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-[170px] truncate"><SelectValue placeholder={t('common.status')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="work">{language === 'hu' ? 'Aktív munkák' : 'Active work'}</SelectItem>
                      <SelectItem value="overdue">{language === 'hu' ? 'Lejárt' : 'Overdue'}</SelectItem>
                      <SelectItem value="due_soon">{language === 'hu' ? 'Hamarosan esedékes' : 'Due soon'}</SelectItem>
                      <SelectItem value="active">{language === 'hu' ? 'Nyitott' : 'Open'}</SelectItem>
                      <SelectItem value="progress">{t('tickets.inProgress')}</SelectItem>
                      <SelectItem value="hold">{language === 'hu' ? 'Várakozik' : 'On hold'}</SelectItem>
                      <SelectItem value="approval">{language === 'hu' ? 'Jóváhagyásra vár' : 'Awaiting approval'}</SelectItem>
                      <SelectItem value="done">{language === 'hu' ? 'Befejezett előzmények' : 'Completed history'}</SelectItem>
                      <SelectItem value="all">{language === 'hu' ? 'Összes, befejezettekkel' : 'All including completed'}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                    <SelectTrigger className="w-full sm:w-[140px] truncate"><SelectValue placeholder={t('common.priority')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('tickets.allPriority')}</SelectItem>
                      <SelectItem value="low">{t('tickets.priority.low')}</SelectItem>
                      <SelectItem value="medium">{t('tickets.priority.medium')}</SelectItem>
                      <SelectItem value="high">{t('tickets.priority.high')}</SelectItem>
                      <SelectItem value="urgent">{t('tickets.priority.urgent')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{ticketLoadError ? '—' : counts.work} active · {ticketLoadError ? '—' : counts.done} completed</span>
                {statusFilter !== 'work' && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setStatusFilter('work')}>Clear status filter</Button>}
              </div>
            </div>

            {ticketLoadError ? null : loading ? (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="rounded-lg border p-4 space-y-3"><div className="flex items-center justify-between gap-2"><div className="h-4 w-32 rounded bg-muted animate-pulse" /><div className="h-5 w-16 rounded-full bg-muted animate-pulse" /></div><div className="h-3 w-full rounded bg-muted animate-pulse" /><div className="h-3 w-2/3 rounded bg-muted animate-pulse" /><div className="flex gap-2 pt-1"><div className="h-6 w-20 rounded bg-muted animate-pulse" /><div className="h-6 w-14 rounded bg-muted animate-pulse" /></div></div>)}
              </div>
            ) : filteredTickets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">{searchQuery || statusFilter !== 'work' || priorityFilter !== 'all' ? (t('tickets.noMatchFilters') || 'No tickets match your filters') : t('tickets.noResults')}</div>
            ) : (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {filteredTickets.map((ticket, idx) => <div key={ticket.id} data-training={idx === 0 ? 'ticket-row' : undefined}><TicketCard ticket={ticket} onClick={() => setSelectedTicket(ticket)} onUpdated={() => void fetchTickets()} /></div>)}
              </div>
            )}

            {isManager && <MaintenanceIssueAnalytics />}
          </TabsContent>

          <TabsContent value="rooms" className="space-y-6">
            {profile?.role === 'reception' ? <HotelRoomOverview selectedDate={new Date().toISOString().split('T')[0]} hotelName={profile?.assigned_hotel || ''} staffMap={receptionStaffMap} /> : <RoomManagement />}
          </TabsContent>

          <TabsContent value="housekeeping" className="space-y-6"><HousekeepingTab onActiveSubTabChange={setActiveHousekeepingSubTab} onActiveInnerTabChange={setActiveInnerTab} /></TabsContent>

          <TabsContent value="attendance" className="space-y-6">
            {(() => {
              const isExecutive = ['admin', 'top_management', 'top_management_manager', 'hr'].includes(profile?.role || '');
              if (isExecutive) return <div className="space-y-6"><div><h2 className="text-2xl font-bold">{t('dashboard.workStatusAttendance')}</h2>{hotelDisplayName && <p className="text-sm text-muted-foreground">{hotelDisplayName}</p>}</div><AttendanceReports /></div>;
              if (profile?.role === 'housekeeping' || profile?.role === 'maintenance' || isManager) return <div className="space-y-6"><h2 className="text-2xl font-bold">{t('dashboard.workStatusAttendance')}</h2><AttendanceTracker /><AttendanceReports /></div>;
              return null;
            })()}
          </TabsContent>

          {profile?.role === 'reception' && <>{!noMinibar && <TabsContent value="minibar" className="space-y-6"><MinibarTrackingView /></TabsContent>}<TabsContent value="lost-found" className="space-y-6"><LostAndFoundManagement /></TabsContent></>}
          {profile?.role === 'admin' && <TabsContent value="admin" className="space-y-6"><AdminTabs /></TabsContent>}
        </Tabs>

        <CreateTicketDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} onTicketCreated={fetchTickets} onOpenTicket={id => void openCreatedMaintenanceIssue(id)} />
        {selectedTicket && <TicketDetailDialog ticket={selectedTicket} open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)} onTicketUpdated={() => { fetchTickets(); setSelectedTicket(null); }} />}
        {canManageUsers && <>
          <UserManagementDialog open={userManagementOpen} onOpenChange={setUserManagementOpen} />
          <AccessManagementDialog open={accessManagementOpen} onOpenChange={setAccessManagementOpen} />
          <TicketPermissionDialog open={ticketPermissionDialogOpen} onOpenChange={setTicketPermissionDialogOpen} />
          <CompanySettings open={companySettingsOpen} onOpenChange={setCompanySettingsOpen} />
        </>}
      </div>
    </div>
  );
}
