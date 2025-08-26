import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Calendar, User, MapPin, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'completed';
  created_at: string;
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

interface TicketCardProps {
  ticket: Ticket;
  onClick: () => void;
}

export function TicketCard({ ticket, onClick }: TicketCardProps) {
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getDepartmentColor = (department?: string) => {
    switch (department) {
      case 'maintenance': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'housekeeping': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'reception': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'marketing': return 'bg-pink-100 text-pink-800 border-pink-200';
      case 'back_office': return 'bg-cyan-100 text-cyan-800 border-cyan-200';
      case 'control': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'finance': return 'bg-teal-100 text-teal-800 border-teal-200';
      case 'top_management': return 'bg-violet-100 text-violet-800 border-violet-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'completed': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const formatStatus = (status: string) => {
    return status.replace('_', ' ').toUpperCase();
  };

  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow duration-200"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-sm text-foreground">
              {ticket.ticket_number}
            </h3>
            <p className="text-sm font-medium text-foreground mt-1">
              {ticket.title}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Badge className={getPriorityColor(ticket.priority)} variant="secondary">
              {ticket.priority.toUpperCase()}
            </Badge>
            {ticket.department && (
              <Badge className={getDepartmentColor(ticket.department)}>
                {ticket.department.replace('_', ' ').toUpperCase()}
              </Badge>
            )}
            <Badge className={getStatusColor(ticket.status)} variant="outline">
              {formatStatus(ticket.status)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0 space-y-2">
        <p className="text-sm text-muted-foreground line-clamp-2">
          {ticket.description}
        </p>
        
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            Room {ticket.room_number}
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {format(new Date(ticket.created_at), 'MMM dd')}
          </div>
        </div>
        
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            {ticket.created_by?.full_name ?? 'Unknown'}
          </div>
          
          {ticket.hotel && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="text-xs">🏨</span>
              <span>{ticket.hotel.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
            </div>
          )}
          
          {ticket.assigned_to && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <AlertCircle className="h-3 w-3" />
              Assigned to {ticket.assigned_to.full_name}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}