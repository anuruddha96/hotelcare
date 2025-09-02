import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { TicketCard } from './TicketCard';
import { CreateTicketDialog } from './CreateTicketDialog';
import { TicketDetailDialog } from './TicketDetailDialog';
import { UserManagementDialog } from './UserManagementDialog';
import { AutoAssignmentService } from './AutoAssignmentService';
import { RoomManagement } from './RoomManagement';
import { ArchivedTickets } from './ArchivedTickets';
import { CompanySettings } from './CompanySettings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Users, Filter, Home, Ticket, Settings } from 'lucide-react';
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
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [userManagementOpen, setUserManagementOpen] = useState(false);
  const [companySettingsOpen, setCompanySettingsOpen] = useState(false);

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
    
    // Guard: wait for profile to be available to avoid null access during initial load
    if (!profile || !profile.id) {
      setTickets([]);
      setLoading(false);
      return;
    }

    try {
      const selectColumns = (isManager || profile?.role === 'admin')
        ? `*, created_by_profile:profiles!tickets_created_by_fkey(full_name, role), assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, role)`
        : `*`;
      let query = supabase
        .from('tickets')
        .select(selectColumns as any)
        .not('status', 'eq', 'completed') // Exclude completed/archived tickets
        .order('created_at', { ascending: false });

      // Role-based filtering - using correct Supabase syntax
      if (profile?.role === 'maintenance') {
        // Maintenance users see maintenance tickets, plus their assigned/created tickets
        query = query.or(`department.eq.maintenance,assigned_to.eq.${profile.id},created_by.eq.${profile.id}`);
      } else if (profile?.role === 'housekeeping') {
        // Housekeeping users see housekeeping tickets, plus their assigned/created tickets
        query = query.or(`department.eq.housekeeping,assigned_to.eq.${profile.id},created_by.eq.${profile.id}`);
      } else if (profile?.role === 'reception') {
        // Reception users see reception tickets, plus their assigned/created tickets
        query = query.or(`department.eq.reception,assigned_to.eq.${profile.id},created_by.eq.${profile.id}`);
      } else if (profile?.role === 'marketing') {
        // Marketing users see marketing tickets, plus their assigned/created tickets
        query = query.or(`department.eq.marketing,assigned_to.eq.${profile.id},created_by.eq.${profile.id}`);
      } else if (profile?.role === 'control_finance') {
        // Finance users see finance tickets, plus their assigned/created tickets
        query = query.or(`department.eq.finance,assigned_to.eq.${profile.id},created_by.eq.${profile.id}`);
      } else if (profile?.role === 'hr') {
        // HR users see HR tickets, plus their assigned/created tickets
        query = query.or(`department.eq.hr,assigned_to.eq.${profile.id},created_by.eq.${profile.id}`);
      } else if (profile?.role === 'front_office') {
        // Front office users see reception tickets, plus their assigned/created tickets
        query = query.or(`department.eq.reception,assigned_to.eq.${profile.id},created_by.eq.${profile.id}`);
      } else if (profile?.role === 'top_management') {
        // Top management users see all tickets
        // No additional filter needed
      } else if (profile?.role === 'housekeeping_manager') {
        // Housekeeping managers see housekeeping and maintenance tickets
        query = query.in('department', ['housekeeping', 'maintenance']);
      } else if (profile?.role === 'maintenance_manager') {
        // Maintenance managers see only maintenance tickets
        query = query.eq('department', 'maintenance');
      } else if (profile?.role === 'marketing_manager') {
        // Marketing managers see only marketing tickets
        query = query.eq('department', 'marketing');
      } else if (profile?.role === 'reception_manager') {
        // Reception managers see only reception tickets
        query = query.eq('department', 'reception');
      } else if (profile?.role === 'back_office_manager') {
        // Back office managers see only back office tickets
        query = query.eq('department', 'back_office');
      } else if (profile?.role === 'control_manager') {
        // Control managers see only control tickets
        query = query.eq('department', 'control');
      } else if (profile?.role === 'finance_manager') {
        // Finance managers see only finance tickets
        query = query.eq('department', 'finance');
      } else if (profile?.role === 'top_management_manager') {
        // Top management managers see only top management tickets
        query = query.eq('department', 'top_management');
      } else {
        // For any other roles, if we have a profile id, show tickets assigned to or created by the user
        if (profile?.id) {
          query = query.or(`assigned_to.eq.${profile.id},created_by.eq.${profile.id}`);
        }
      }
      // Admins and general managers see all tickets (no additional filter)

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

  useEffect(() => {
    if (!profile?.id) return;
    fetchTickets();
  }, [profile?.id, profile?.role]);

  const filteredTickets = tickets
    .filter((t) => t.status !== 'completed')
    .filter(ticket => {
    const matchesSearch = ticket.ticket_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         ticket.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         ticket.room_number.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || ticket.priority === priorityFilter;
    
    return matchesSearch && matchesStatus && matchesPriority;
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

  return (
    <div className="min-h-screen bg-background">
      <AutoAssignmentService />
      
      <div className="container mx-auto px-4 py-6">
        <Tabs defaultValue="tickets" className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Hotel Care Hub</h1>
              <p className="text-muted-foreground">Complete hotel management system</p>
            </div>
            
            <TabsList className="grid w-full max-w-lg grid-cols-3">
              <TabsTrigger value="tickets" className="flex items-center gap-2">
                <Ticket className="h-4 w-4" />
                Tickets
              </TabsTrigger>
              <TabsTrigger value="rooms" className="flex items-center gap-2">
                <Home className="h-4 w-4" />
                Rooms
              </TabsTrigger>
              <TabsTrigger value="archive" className="flex items-center gap-2">
                <Ticket className="h-4 w-4" />
                Archive
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="tickets" className="space-y-6">
            {/* Ticket Management Header */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-foreground">
                  {profile?.role === 'maintenance' ? 'My Tickets' : 'All Tickets'}
                </h2>
                <p className="text-muted-foreground">
                  {profile?.role === 'maintenance' 
                    ? 'Tickets assigned to you' 
                    : 'Manage maintenance requests across the hotel'
                  }
                </p>
              </div>
              
              <div className="flex gap-2">
                {canManageUsers && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setUserManagementOpen(true)}
                    >
                      <Users className="h-4 w-4 mr-2" />
                      Manage Users
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setCompanySettingsOpen(true)}
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Company Settings
                    </Button>
                  </>
                )}
                
                {canCreateTickets && (
                  <Button onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    New Ticket
                  </Button>
                )}
              </div>
            </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-2xl font-bold">{counts.total}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Open</p>
          <p className="text-2xl font-bold text-blue-600">{counts.open}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">In Progress</p>
          <p className="text-2xl font-bold text-yellow-600">{counts.inProgress}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Completed</p>
          <p className="text-2xl font-bold text-green-600">{counts.completed}</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by ticket number, title, or room..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <Filter className="h-4 w-4 mr-2" />
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
            <SelectTrigger className="w-[140px]">
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
        </div>
      </div>

      {/* Tickets Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchQuery || statusFilter !== 'all' || priorityFilter !== 'all' 
              ? 'No tickets match your filters' 
              : 'No tickets found'
            }
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

          <TabsContent value="rooms">
            <RoomManagement />
          </TabsContent>

          <TabsContent value="archive">
            <ArchivedTickets />
          </TabsContent>
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
            onTicketUpdated={fetchTickets}
          />
        )}
        
        {canManageUsers && (
          <>
            <UserManagementDialog
              open={userManagementOpen}
              onOpenChange={setUserManagementOpen}
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