/** Explain the SLNT roster's actual state without treating a failed API call as an empty roster. */
export type SlntRosterNotice = {
  kind: 'missing' | 'setup' | 'permission' | 'error';
  message: string;
  action: 'schedule' | 'retry';
};

export function getSlntRosterNotice(
  publishedCount: number,
  selectedDate: string,
  error?: { code?: string | null; message?: string | null } | null,
): SlntRosterNotice | null {
  if (error) {
    const message = error.message ?? '';
    if (error.code === 'PGRST202' || error.code === '42883'
      || /could not find.*slnt_housekeeping_published_roster/i.test(message)) {
      return {
        kind: 'setup',
        message: 'The SLNT published-roster service is not installed. Ask your HotelCare administrator to complete the roster setup; creating shifts alone will not fix this.',
        action: 'retry',
      };
    }
    if (error.code === '42501' || error.code === 'PGRST301' || /not authorized|permission denied|venue access is not configured/i.test(message)) {
      return {
        kind: 'permission',
        message: 'You do not have access to the published roster for this SLNT property. Ask your manager to check your hotel and venue permissions.',
        action: 'retry',
      };
    }
    return {
      kind: 'error',
      message: 'The published SLNT roster could not be loaded. Your schedule may already exist. Check the connection and try again.',
      action: 'retry',
    };
  }
  if (publishedCount === 0) {
    return {
      kind: 'missing',
      message: `No published housekeeping shifts were found for ${selectedDate} at this SLNT property. Open Staff schedule, add the shifts and venues, then publish the roster before assigning rooms.`,
      action: 'schedule',
    };
  }
  return null;
}
