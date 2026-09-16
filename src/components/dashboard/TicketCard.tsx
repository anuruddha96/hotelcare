import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Calendar, User, MapPin, AlertCircle, PauseCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';
import { MaintenanceTicketTranslation } from './MaintenanceTicketTranslation';
import { maintenanceHoldReasonLabel, maintenanceMissingHoldReasonLabel, maintenanceTicketStatusClass, maintenanceTicketStatusLabel, type MaintenanceTicketStatus } from '@/lib/maintenanceTicketStatus';

interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: MaintenanceTicketStatus;
  hold_reason?: string | null;
  created_at: string;
  department?: string;
  hotel?: string;
  created_by?: { full_name: string; role: string };
  assigned_to?: { full_name: string };
}

interface TicketCardProps {
  ticket: Ticket;
  onClick: () => void;
}

export function TicketCard({ ticket, onClick }: TicketCardProps) {
  const { t, language } = useTranslation();

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
  const getTranslatedStatus = (status: MaintenanceTicketStatus) => {
    if (language === 'hu') return maintenanceTicketStatusLabel(status, language);
    switch (status) {
      case 'open': return t('tickets.openStatus');
      case 'in_progress': return t('tickets.inProgressStatus');
      case 'completed': return t('tickets.completedStatus');
      default: return maintenanceTicketStatusLabel(status, language);
    }
  };
  const getTranslatedPriority = (priority: string) => {
    switch (priority) {
      case 'urgent': return t('tickets.urgentPriority');
      case 'high': return t('tickets.highPriority');
      case 'medium': return t('tickets.mediumPriority');
      case 'low': return t('tickets.lowPriority');
      default: return priority.toUpperCase();
    }
  };

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow duration-200"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); }
      }}
      aria-label={`${ticket.ticket_number}: ${ticket.title}`}
      data-training="ticket-card"
      data-training-priority={ticket.priority}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-foreground">{ticket.ticket_number}</h3>
            <p className="text-sm font-medium text-foreground mt-1 whitespace-pre-wrap">{ticket.title}</p>
          </div>
          <div className="flex flex-col gap-1 shrink-0 items-end">
            <Badge className={getPriorityColor(ticket.priority)} variant="secondary">{getTranslatedPriority(ticket.priority)}</Badge>
            {ticket.department && <Badge className={getDepartmentColor(ticket.department)}>{ticket.department.replace('_', ' ').toUpperCase()}</Badge>}
            <Badge className={maintenanceTicketStatusClass(ticket.status)} variant="outline">{getTranslatedStatus(ticket.status)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <p className="text-sm text-muted-foreground line-clamp-2">{ticket.description}</p>
        {ticket.status === 'on_hold' && (
          <div className="flex items-start gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2 py-1.5 text-xs text-orange-900" role="note">
            <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span><strong>{maintenanceHoldReasonLabel(language)}</strong> {ticket.hold_reason?.trim() || maintenanceMissingHoldReasonLabel(language)}</span>
          </div>
        )}
        {ticket.department === 'maintenance' && <MaintenanceTicketTranslation ticketId={ticket.id} title={ticket.title} description={ticket.description} />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1"><MapPin className="h-3 w-3" />{t('ticketCard.room')} {ticket.room_number}</div>
          <div className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(ticket.created_at), 'MMM dd')}</div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground"><User className="h-3 w-3" />{ticket.created_by?.full_name ?? t('ticketCard.unknown')}</div>
          {ticket.hotel && <div className="flex items-center gap-1 text-xs text-muted-foreground"><span className="text-xs">🏨</span><span>{ticket.hotel.replace('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase())}</span></div>}
          {ticket.assigned_to && <div className="flex items-center gap-1 text-xs text-muted-foreground"><AlertCircle className="h-3 w-3" />{t('ticketCard.assignedTo')} {ticket.assigned_to.full_name}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
