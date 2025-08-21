import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { hotels } from './HotelFilter';

interface Ticket {
  id: string;
  hotel: string;
  status: 'open' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

interface TicketSummaryCardsProps {
  tickets: Ticket[];
  selectedHotel: string;
}

export const TicketSummaryCards: React.FC<TicketSummaryCardsProps> = ({
  tickets,
  selectedHotel,
}) => {
  const filteredTickets = selectedHotel === 'all' 
    ? tickets 
    : tickets.filter(ticket => ticket.hotel === selectedHotel);

  const getStatusCounts = () => {
    const counts = {
      total: filteredTickets.length,
      open: filteredTickets.filter(t => t.status === 'open').length,
      in_progress: filteredTickets.filter(t => t.status === 'in_progress').length,
      completed: filteredTickets.filter(t => t.status === 'completed').length,
      urgent: filteredTickets.filter(t => t.priority === 'urgent').length,
    };
    return counts;
  };

  const counts = getStatusCounts();

  const getHotelBreakdown = () => {
    if (selectedHotel !== 'all') return null;
    
    return hotels.slice(1).map(hotel => ({
      name: hotel.name,
      count: tickets.filter(t => t.hotel === hotel.id).length,
    }));
  };

  const hotelBreakdown = getHotelBreakdown();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6 mb-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Tickets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{counts.total}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Open</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-destructive">{counts.open}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">In Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-yellow-600">{counts.in_progress}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Completed</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{counts.completed}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Urgent</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">{counts.urgent}</div>
        </CardContent>
      </Card>

      {hotelBreakdown && (
        <Card className="col-span-full">
          <CardHeader>
            <CardTitle className="text-lg">Hotel Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {hotelBreakdown.map((hotel) => (
                <div key={hotel.name} className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="text-sm font-medium">{hotel.name}</span>
                  <Badge variant="secondary">{hotel.count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};