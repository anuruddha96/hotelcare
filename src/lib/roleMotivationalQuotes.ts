// Only verbatim, source-checked quotations by named people belong here.
// Never attribute an internally written operational tip to a real person.
// The takeaway is HotelCare's own interpretation, deliberately separate from the quote.
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

const QUOTES = {
  habits: {
    id: 'clear-habits',
    quote: 'Habits are the compound interest of self-improvement.',
    by: 'James Clear',
    takeaway: 'A small, careful habit each day adds up.',
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
    takeaway: 'Report small problems before they become big ones.',
    sourceUrl: 'https://www.ushistory.org/franklin/philadelphia/fire.htm',
  },
  hospitality: {
    id: 'meyer-hospitality',
    quote: 'Hospitality exists when you believe the other person is on your side.',
    by: 'Danny Meyer',
    takeaway: 'Help guests feel that you are working with them.',
    sourceUrl: 'https://www.kqed.org/bayareabites/431/danny-meyer-at-the-commonwealth-club',
  },
  strategy: {
    id: 'drucker-strategy',
    quote: 'Strategy is a commodity. Execution is an art.',
    by: 'Peter Drucker',
    takeaway: 'Turn a good plan into clear daily actions.',
    sourceUrl: 'https://drucker.institute/quote-library/',
  },
  time: {
    id: 'drucker-time',
    quote: 'Time is the scarcest resource. Unless it is managed, nothing else can be managed.',
    by: 'Peter Drucker',
    takeaway: 'Choose the most important task first.',
    sourceUrl: 'https://drucker.institute/quote-library/',
  },
  colleagues: {
    id: 'marriott-colleagues',
    quote: "Take care of associates and they'll take care of your customers.",
    by: 'J. Willard Marriott',
    takeaway: 'Supporting colleagues helps them serve guests well.',
    sourceUrl: 'https://www.marriott.com/en-gb/culture-and-values/j-willard-marriott.mi',
  },
  listen: {
    id: 'covey-listen',
    quote: 'Seek first to understand, then to be understood.',
    by: 'Stephen R. Covey',
    takeaway: 'Listen to the whole issue before answering.',
    sourceUrl: 'https://www.franklincovey.com/courses/the-7-habits/habit-5/',
  },
  notes: {
    id: 'allen-notes',
    quote: 'Your mind is for having ideas, not holding them.',
    by: 'David Allen',
    takeaway: 'Record important details for the next shift.',
    sourceUrl: 'https://gettingthingsdone.com/about/',
  },
  culture: {
    id: 'godin-culture',
    quote: 'People like us do things like this.',
    by: 'Seth Godin',
    takeaway: 'Your daily actions shape team standards.',
    sourceUrl: 'https://seths.blog/2013/07/people-like-us-do-stuff-like-this/',
  },
  simplicity: {
    id: 'jobs-simplicity',
    quote: 'Simple can be harder than complex.',
    by: 'Steve Jobs',
    takeaway: 'Make instructions and handovers easier to follow.',
    sourceUrl: 'https://books.apple.com/gb/book/insanely-simple/id512538141',
  },
} as const satisfies Record<string, MotivationalQuote>;

type QuoteId = keyof typeof QUOTES;

// Every role gets a focused selection. Deliberately no anonymous shared pool:
// it used to make role-specific selections feel unrelated to someone's work.
const QUOTE_POOLS: Record<QuoteAudience, readonly QuoteId[]> = {
  housekeeping: ['habits', 'prevention', 'systems', 'colleagues', 'simplicity'],
  housekeeping_leadership: ['systems', 'colleagues', 'listen', 'time', 'habits', 'simplicity'],
  reception: ['hospitality', 'listen', 'notes', 'colleagues', 'habits'],
  reception_leadership: ['listen', 'hospitality', 'colleagues', 'notes', 'time', 'systems'],
  maintenance: ['prevention', 'systems', 'notes', 'habits', 'simplicity'],
  maintenance_leadership: ['prevention', 'systems', 'time', 'colleagues', 'notes', 'strategy'],
  breakfast: ['hospitality', 'colleagues', 'habits', 'prevention', 'listen'],
  marketing: ['culture', 'hospitality', 'listen', 'strategy', 'simplicity'],
  marketing_leadership: ['strategy', 'culture', 'hospitality', 'systems', 'time', 'simplicity'],
  finance: ['time', 'notes', 'habits', 'prevention', 'systems'],
  finance_leadership: ['time', 'strategy', 'systems', 'notes', 'colleagues', 'prevention'],
  hr: ['colleagues', 'listen', 'culture', 'notes', 'habits'],
  hotel_management: ['colleagues', 'systems', 'hospitality', 'time', 'listen', 'strategy'],
  executive: ['systems', 'strategy', 'colleagues', 'time', 'culture', 'hospitality', 'simplicity'],
  admin: ['simplicity', 'systems', 'notes', 'prevention', 'habits'],
  supervisor: ['colleagues', 'listen', 'notes', 'habits', 'time', 'systems'],
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
