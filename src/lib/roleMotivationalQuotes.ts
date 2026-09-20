// Short, attributable quotations with a separate, optional internal takeaway.
// The welcome screen intentionally displays only the quotation and its speaker.
export type MotivationalQuote = {
  id: string;
  quote: string;
  by: string;
  takeaway: string;
  sourceUrl: string;
};

export type QuoteAudience =
  | 'housekeeping'
  | 'housekeeping_leadership'
  | 'reception'
  | 'reception_leadership'
  | 'maintenance'
  | 'maintenance_leadership'
  | 'breakfast'
  | 'marketing'
  | 'marketing_leadership'
  | 'finance'
  | 'finance_leadership'
  | 'hr'
  | 'hotel_management'
  | 'executive'
  | 'admin'
  | 'supervisor'
  | 'hospitality';

// Keep quotations concise, relevant and attributed to a person, not an invented
// department. Preserve source details in the data without cluttering the card.
const QUOTES = {
  habits: {
    id: 'clear-habits',
    quote: 'Habits are the compound interest of self-improvement.',
    by: 'James Clear',
    takeaway: 'A careful daily habit adds up.',
    sourceUrl: 'https://jamesclear.com/quote/atomic-habits',
  },
  systems: {
    id: 'clear-systems',
    quote: 'Goals are good for setting a direction, but systems are best for making progress.',
    by: 'James Clear',
    takeaway: 'Improve the daily process, not only the target.',
    sourceUrl: 'https://jamesclear.com/quote/atomic-habits',
  },
  prevention: {
    id: 'franklin-prevention',
    quote: 'An ounce of prevention is worth a pound of cure.',
    by: 'Benjamin Franklin',
    takeaway: 'Report small problems early.',
    sourceUrl: 'https://www.ushistory.org/franklin/philadelphia/fire.htm',
  },
  hospitality: {
    id: 'meyer-hospitality',
    quote: 'Hospitality exists when you believe the other person is on your side.',
    by: 'Danny Meyer',
    takeaway: 'Help guests feel supported.',
    sourceUrl: 'https://www.kqed.org/bayareabites/431/danny-meyer-at-the-commonwealth-club',
  },
  time: {
    id: 'drucker-time',
    quote: 'Time is the scarcest resource. Unless it is managed, nothing else can be managed.',
    by: 'Peter Drucker',
    takeaway: 'Start with the highest-priority task.',
    sourceUrl: 'https://drucker.institute/quote-library/',
  },
  colleagues: {
    id: 'marriott-colleagues',
    quote: "Take care of associates and they'll take care of your customers.",
    by: 'J. Willard Marriott',
    takeaway: 'Support colleagues so they can support guests.',
    sourceUrl: 'https://www.marriott.com/en-gb/culture-and-values/j-willard-marriott.mi',
  },
  listen: {
    id: 'covey-listen',
    quote: 'Seek first to understand, then to be understood.',
    by: 'Stephen R. Covey',
    takeaway: 'Listen before you answer.',
    sourceUrl: 'https://www.franklincovey.com/courses/the-7-habits/habit-5/',
  },
  notes: {
    id: 'allen-notes',
    quote: 'Your mind is for having ideas, not holding them.',
    by: 'David Allen',
    takeaway: 'Write down important details for the next shift.',
    sourceUrl: 'https://gettingthingsdone.com/about/',
  },
  culture: {
    id: 'godin-culture',
    quote: 'People like us do things like this.',
    by: 'Seth Godin',
    takeaway: 'Everyday actions shape team standards.',
    sourceUrl: 'https://seths.blog/2013/07/people-like-us-do-stuff-like-this/',
  },
} as const satisfies Record<string, MotivationalQuote>;

type QuoteId = keyof typeof QUOTES;

const QUOTE_POOLS: Record<QuoteAudience, readonly QuoteId[]> = {
  housekeeping: ['habits', 'prevention', 'systems', 'colleagues', 'notes'],
  housekeeping_leadership: ['systems', 'colleagues', 'listen', 'time', 'habits'],
  reception: ['hospitality', 'listen', 'notes', 'colleagues', 'habits'],
  reception_leadership: ['listen', 'hospitality', 'colleagues', 'notes', 'time'],
  maintenance: ['prevention', 'systems', 'notes', 'habits', 'time'],
  maintenance_leadership: ['prevention', 'systems', 'time', 'colleagues', 'notes'],
  breakfast: ['hospitality', 'colleagues', 'habits', 'prevention', 'listen'],
  marketing: ['culture', 'hospitality', 'listen', 'systems', 'colleagues'],
  marketing_leadership: ['culture', 'hospitality', 'systems', 'time', 'listen'],
  finance: ['time', 'notes', 'habits', 'prevention', 'systems'],
  finance_leadership: ['time', 'systems', 'notes', 'colleagues', 'prevention'],
  hr: ['colleagues', 'listen', 'culture', 'notes', 'habits'],
  hotel_management: ['colleagues', 'systems', 'hospitality', 'time', 'listen'],
  executive: ['systems', 'colleagues', 'time', 'culture', 'hospitality', 'listen'],
  admin: ['systems', 'notes', 'prevention', 'habits', 'time'],
  supervisor: ['colleagues', 'listen', 'notes', 'habits', 'time'],
  hospitality: ['hospitality', 'listen', 'colleagues', 'habits', 'prevention'],
};

const ROLE_AUDIENCE: Record<string, QuoteAudience> = {
  housekeeping: 'housekeeping',
  housekeeping_manager: 'housekeeping_leadership',
  reception: 'reception',
  front_office: 'reception',
  reception_manager: 'reception_leadership',
  maintenance: 'maintenance',
  maintenance_manager: 'maintenance_leadership',
  breakfast_staff: 'breakfast',
  marketing: 'marketing',
  marketing_manager: 'marketing_leadership',
  control_finance: 'finance',
  control_manager: 'finance_leadership',
  finance_manager: 'finance_leadership',
  hr: 'hr',
  manager: 'hotel_management',
  back_office_manager: 'hotel_management',
  top_management: 'executive',
  top_management_manager: 'executive',
  admin: 'admin',
  supervisor: 'supervisor',
};

const AUDIENCE_LABELS: Record<QuoteAudience, string> = {
  housekeeping: 'Housekeeping',
  housekeeping_leadership: 'Housekeeping leadership',
  reception: 'Reception & guest care',
  reception_leadership: 'Front office leadership',
  maintenance: 'Maintenance',
  maintenance_leadership: 'Maintenance leadership',
  breakfast: 'Breakfast & service',
  marketing: 'Sales & marketing',
  marketing_leadership: 'Marketing leadership',
  finance: 'Finance',
  finance_leadership: 'Finance leadership',
  hr: 'Human resources',
  hotel_management: 'Hotel management',
  executive: 'Leadership & operations',
  admin: 'Systems & administration',
  supervisor: 'Team supervision',
  hospitality: 'Hospitality',
};

export function quoteAudienceForRole(role?: string | null): QuoteAudience {
  if (!role) return 'hospitality';
  return ROLE_AUDIENCE[role] ?? 'hospitality';
}

export function quoteAudienceLabel(audience: QuoteAudience): string {
  return AUDIENCE_LABELS[audience];
}

export function quotePoolForAudience(audience: QuoteAudience): MotivationalQuote[] {
  return (QUOTE_POOLS[audience] ?? QUOTE_POOLS.hospitality).map((key) => QUOTES[key]);
}

export function quotePoolForRole(role?: string | null): MotivationalQuote[] {
  return quotePoolForAudience(quoteAudienceForRole(role));
}
