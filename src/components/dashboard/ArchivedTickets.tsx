import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Calendar, User, MapPin } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface ArchivedTicket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'completed';
  created_at: string;
  closed_at: string;
  resolution_text: string;
  hotel?: string;
  created_by_profile?: {
    full_name: string;
    role: string;
  };
  assigned_to_profile?: {
    full_name: string;
  };
  closed_by_profile?: {
    full_name: string;
  };
}

export function ArchivedTickets() {
  const { profile } = useAuth();
  const [tickets, setTickets] = useState<ArchivedTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchArchivedTickets();
  }, [profile]);

  const fetchArchivedTickets = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          *,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, role),
          assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, role),
          closed_by_profile:profiles!tickets_closed_by_fkey(full_name, role)
        `)
        .eq('status', 'completed')
        .order('closed_at', { ascending: false });

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
        closed_at: d.closed_at,
        resolution_text: d.resolution_text,
        hotel: d.hotel,
        created_by_profile: d.created_by_profile,
        assigned_to_profile: d.assigned_to_profile,
        closed_by_profile: d.closed_by_profile,
      })) as ArchivedTicket[];

      setTickets(parsed);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch archived tickets',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredTickets = tickets.filter(ticket => {
    const searchTerm = searchQuery.toLowerCase();
    return (
      ticket.ticket_number.toLowerCase().includes(searchTerm) ||
      ticket.room_number.toLowerCase().includes(searchTerm) ||
      ticket.title.toLowerCase().includes(searchTerm)
    );
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Archived Tickets</h2>
          <p className="text-muted-foreground">
            Search and view completed tickets by room number or case ID
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by ticket number or room..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchQuery ? 'No archived tickets match your search' : 'No archived tickets found'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredTickets.map((ticket) => (
            <Card key={ticket.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{ticket.ticket_number}</CardTitle>
                    <p className="text-sm text-muted-foreground">{ticket.title}</p>
                  </div>
                  <Badge className={getPriorityColor(ticket.priority)}>
                    {ticket.priority}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>Room {ticket.room_number}</span>
                  {ticket.hotel && (
                    <>
                      <span>•</span>
                      <span>{ticket.hotel}</span>
                    </>
                  )}
                </div>

                <p className="text-sm">{ticket.description}</p>

                {ticket.resolution_text && (
                  <div className="bg-green-50 p-3 rounded-lg">
                    <p className="text-sm font-medium text-green-800 mb-1">Resolution:</p>
                    <p className="text-sm text-green-700">{ticket.resolution_text}</p>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span>Closed {new Date(ticket.closed_at).toLocaleDateString()}</span>
                  </div>
                  {ticket.closed_by_profile && (
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      <span>by {ticket.closed_by_profile.full_name}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}