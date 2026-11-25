export type MaintenanceTicketStatus =
  | 'open'
  | 'in_progress'
  | 'on_hold'
  | 'pending_supervisor_approval'
  | 'completed';

export type MaintenanceTicketLanguage = 'en' | 'hu' | string;

const hungarianStatusLabels: Partial<Record<MaintenanceTicketStatus, string>> = {
  open: 'Nyitott',
  in_progress: 'Folyamatban',
  on_hold: 'Felfüggesztve',
  pending_supervisor_approval: 'Jóváhagyásra vár',
  completed: 'Befejezve',
};

export const maintenanceTicketStatusLabel = (
  status: string,
  language: MaintenanceTicketLanguage = 'en',
): string => {
  if (language === 'hu' && status in hungarianStatusLabels) {
    return hungarianStatusLabels[status as MaintenanceTicketStatus] ?? status;
  }

  switch (status) {
    case 'open': return 'Open';
    case 'in_progress': return 'In progress';
    case 'on_hold': return 'On hold';
    case 'pending_supervisor_approval': return 'Awaiting approval';
    case 'completed': return 'Completed';
    default: return status.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  }
};

export const maintenanceHoldReasonLabel = (language: MaintenanceTicketLanguage = 'en'): string =>
  language === 'hu' ? 'Felfüggesztés oka:' : 'Hold reason:';

export const maintenanceMissingHoldReasonLabel = (language: MaintenanceTicketLanguage = 'en'): string =>
  language === 'hu' ? 'Nincs rögzített ok' : 'Reason not recorded';

export const maintenanceTicketStatusClass = (status: string): string => {
  switch (status) {
    case 'open': return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'in_progress': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'on_hold': return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'pending_supervisor_approval': return 'bg-violet-100 text-violet-800 border-violet-300';
    case 'completed': return 'bg-green-100 text-green-800 border-green-300';
    default: return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};
