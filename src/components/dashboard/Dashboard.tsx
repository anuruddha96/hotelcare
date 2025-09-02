import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { TicketCard } from './TicketCard';
import { CreateTicketDialog } from './CreateTicketDialog';
import { TicketDetailDialog } from './TicketDetailDialog';
import { UserManagementDialog } from './UserManagementDialog';
import { AccessManagementDialog } from './AccessManagementDialog';
import { AutoAssignmentService } from './AutoAssignmentService';
import { RoomManagement } from './RoomManagement';
import { ArchivedTickets } from './ArchivedTickets';
import { CompanySettings } from './CompanySettings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Users, Filter, Home, Ticket, Settings, Shield } from 'lucide-react';
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
  const [accessManagementOpen, setAccessManagementOpen] = useState(false);
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
    
    console.log('fetchTickets called with profile:', profile);
    console.log('Profile role:', profile?.role);
    console.log('Profile id:', profile?.id);
    
    // Guard: wait for profile to be available to avoid null access during initial load
    if (!profile || !profile.id) {
      console.log('No profile or profile.id, returning empty tickets');
      setTickets([]);
      setLoading(false);
      return;
    }

    try {
      const selectColumns = (isManager || profile?.role === 'admin')
        ? `*, created_by_profile:profiles!tickets_created_by_fkey(full_name, role), assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, role)`
        : `*`;
      
      // Simplified query - RLS policy now handles all access control
      let query = supabase
        .from('tickets')
        .select(selectColumns as any)
        .not('status', 'eq', 'completed') // Exclude completed/archived tickets
        .order('created_at', { ascending: false });

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
          <div className="flex flex-col gap-4 justify-between items-start">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                {profile?.assigned_hotel || 'Hotel Care Hub'}
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground">
                {profile?.assigned_hotel ? `${profile.assigned_hotel} Management System` : 'Complete hotel management system'}
              </p>
            </div>
            
            <TabsList className="grid w-full max-w-lg grid-cols-3 h-8 sm:h-10">
              <TabsTrigger value="tickets" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                <Ticket className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Tickets</span>
                <span className="sm:hidden">T</span>
              </TabsTrigger>
              <TabsTrigger value="rooms" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                <Home className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Rooms</span>
                <span className="sm:hidden">R</span>
              </TabsTrigger>
              <TabsTrigger value="archive" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                <Ticket className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Archive</span>
                <span className="sm:hidden">A</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="tickets" className="space-y-6">
            {/* Ticket Management Header */}
            <div className="flex flex-col gap-3 sm:gap-4 justify-between items-start">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                  {profile?.role === 'maintenance' ? 'My Tickets' : 'All Tickets'}
                  {profile?.assigned_hotel && (
                    <span className="block sm:inline text-base sm:text-lg font-normal text-muted-foreground sm:ml-2">
                      {profile.assigned_hotel}
                    </span>
                  )}
                </h2>
                <p className="text-sm sm:text-base text-muted-foreground">
                  {profile?.role === 'maintenance' 
                    ? 'Tickets assigned to you' 
                    : profile?.assigned_hotel && profile?.role !== 'admin' && profile?.role !== 'top_management'
                      ? `Manage tickets for ${profile.assigned_hotel}`
                      : 'Manage maintenance requests across all hotels'
                  }
                </p>
              </div>
              
              <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                {canManageUsers && (
                  <>
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
                  <Button onClick={() => setCreateDialogOpen(true)} size="sm" className="text-xs sm:text-sm">
                    <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">New Ticket</span>
                    <span className="sm:hidden">New</span>
                  </Button>
                )}
              </div>
            </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-card border rounded-lg p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-muted-foreground">Total</p>
          <p className="text-xl sm:text-2xl font-bold">{counts.total}</p>
        </div>
        <div className="bg-card border rounded-lg p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-muted-foreground">Open</p>
          <p className="text-xl sm:text-2xl font-bold text-blue-600">{counts.open}</p>
        </div>
        <div className="bg-card border rounded-lg p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-muted-foreground">In Progress</p>
          <p className="text-xl sm:text-2xl font-bold text-yellow-600">{counts.inProgress}</p>
        </div>
        <div className="bg-card border rounded-lg p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-muted-foreground">Completed</p>
          <p className="text-xl sm:text-2xl font-bold text-green-600">{counts.completed}</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tickets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-9 sm:h-10 text-sm"
          />
        </div>
        
        <div className="flex gap-2 overflow-x-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[110px] sm:w-[140px] h-9 text-xs sm:text-sm">
              <Filter className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
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
            <SelectTrigger className="w-[110px] sm:w-[140px] h-9 text-xs sm:text-sm">
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
      ) : profile?.role === 'admin' ? (
        // Admin view: Group tickets by hotel
        <div className="space-y-6">
          {Object.entries(
            filteredTickets.reduce((acc, ticket) => {
              const hotel = ticket.hotel || 'Unassigned Hotel';
              if (!acc[hotel]) acc[hotel] = [];
              acc[hotel].push(ticket);
              return acc;
            }, {} as Record<string, Ticket[]>)
          ).map(([hotelName, hotelTickets]) => (
            <Card key={hotelName} className="overflow-hidden">
              <CardHeader className="bg-muted/30 pb-3">
                <CardTitle className="flex items-center justify-between">
                  <span className="text-lg">{hotelName}</span>
                  <Badge variant="secondary" className="ml-2">
                    {hotelTickets.length} ticket{hotelTickets.length !== 1 ? 's' : ''}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {hotelTickets.map((ticket) => (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      onClick={() => setSelectedTicket(ticket)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        // Regular view: Simple grid
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
            <AccessManagementDialog
              open={accessManagementOpen}
              onOpenChange={setAccessManagementOpen}
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