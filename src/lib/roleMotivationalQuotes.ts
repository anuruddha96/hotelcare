export type MotivationalQuote = {
  id: string;
  quote: string;
  by: string;
};

export type QuoteAudience =
  | 'housekeeping'
  | 'reception'
  | 'maintenance'
  | 'leadership'
  | 'breakfast'
  | 'marketing'
  | 'finance'
  | 'hr'
  | 'hospitality';

const QUOTE_POOLS: Record<QuoteAudience, MotivationalQuote[]> = {
  housekeeping: [
    { id: 'hk-1', quote: 'A room feels cared for when the details are cared for.', by: 'Housekeeping principle' },
    { id: 'hk-2', quote: 'Consistency turns clean rooms into guest confidence.', by: 'Housekeeping principle' },
    { id: 'hk-3', quote: 'Every reset is a fresh welcome for the next guest.', by: 'Housekeeping principle' },
    { id: 'hk-4', quote: 'Small details make a clean room feel truly ready.', by: 'Housekeeping principle' },
    { id: 'hk-5', quote: 'Good teamwork makes a busy floor lighter for everyone.', by: 'Housekeeping teamwork' },
    { id: 'hk-6', quote: 'Take pride in the room you leave ready for someone else.', by: 'Housekeeping principle' },
    { id: 'hk-7', quote: 'Steady work, careful checks, and a clean finish make the difference.', by: 'Housekeeping principle' },
    { id: 'hk-8', quote: 'A well-prepared room is one of the quietest forms of great service.', by: 'Housekeeping principle' },
  ],
  reception: [
    { id: 'rec-1', quote: 'A calm welcome can set the tone for an entire stay.', by: 'Front desk principle' },
    { id: 'rec-2', quote: 'Every arrival is a chance to make a guest feel expected.', by: 'Front desk principle' },
    { id: 'rec-3', quote: 'Great service starts with listening clearly.', by: 'Guest service principle' },
    { id: 'rec-4', quote: 'Clear information and a warm welcome solve more than they seem to.', by: 'Front desk principle' },
    { id: 'rec-5', quote: 'The best front desk moments make difficult situations feel manageable.', by: 'Guest service principle' },
    { id: 'rec-6', quote: 'Be accurate, be helpful, and make the next step easy for the guest.', by: 'Front desk principle' },
    { id: 'rec-7', quote: 'A thoughtful answer is part of the guest experience.', by: 'Guest service principle' },
    { id: 'rec-8', quote: 'Good handovers create smooth stays.', by: 'Front desk teamwork' },
  ],
  maintenance: [
    { id: 'mnt-1', quote: 'A small repair today prevents a bigger problem tomorrow.', by: 'Maintenance principle' },
    { id: 'mnt-2', quote: 'Reliable hotels are built one well-finished fix at a time.', by: 'Maintenance principle' },
    { id: 'mnt-3', quote: 'Safety first, quality always, shortcuts never.', by: 'Maintenance principle' },
    { id: 'mnt-4', quote: 'The best maintenance work is the problem guests never have to notice.', by: 'Maintenance principle' },
    { id: 'mnt-5', quote: 'Fix the cause, not only the symptom.', by: 'Maintenance principle' },
    { id: 'mnt-6', quote: 'A clear update is part of a complete repair.', by: 'Maintenance teamwork' },
  ],
  leadership: [
    { id: 'lead-1', quote: 'Clear expectations make strong teams stronger.', by: 'Leadership principle' },
    { id: 'lead-2', quote: 'Good leadership removes obstacles before adding pressure.', by: 'Leadership principle' },
    { id: 'lead-3', quote: 'A team performs best when everyone knows what success looks like.', by: 'Team leadership principle' },
    { id: 'lead-4', quote: 'Build the system, support the people, improve the result.', by: 'Management principle' },
    { id: 'lead-5', quote: 'Strong teams share information early and solve problems together.', by: 'Teamwork principle' },
    { id: 'lead-6', quote: 'The standard you reinforce becomes the standard the team follows.', by: 'Management principle' },
    { id: 'lead-7', quote: 'Good managers make priorities clear when everything feels urgent.', by: 'Management principle' },
    { id: 'lead-8', quote: 'Recognition, clarity, and follow-through build dependable teams.', by: 'Leadership principle' },
  ],
  breakfast: [
    { id: 'bf-1', quote: 'A good morning starts with a table that feels ready before the guest arrives.', by: 'Breakfast service principle' },
    { id: 'bf-2', quote: 'Fresh, clean, ready: simple standards create a strong first impression.', by: 'Breakfast service principle' },
    { id: 'bf-3', quote: 'Friendly service can be the best part of a guest morning.', by: 'Hospitality principle' },
    { id: 'bf-4', quote: 'Good preparation keeps busy service calm.', by: 'Breakfast teamwork' },
    { id: 'bf-5', quote: 'Notice what needs doing before the guest needs to ask.', by: 'Hospitality principle' },
    { id: 'bf-6', quote: 'A smooth breakfast is built on many small jobs done well.', by: 'Breakfast teamwork' },
  ],
  marketing: [
    { id: 'mkt-1', quote: 'Good marketing makes the right guest understand the value quickly.', by: 'Marketing principle' },
    { id: 'mkt-2', quote: 'Clear stories are easier to trust, remember, and act on.', by: 'Marketing principle' },
    { id: 'mkt-3', quote: 'Consistency across every channel strengthens the brand.', by: 'Brand principle' },
    { id: 'mkt-4', quote: 'Useful content earns attention better than noise does.', by: 'Marketing principle' },
    { id: 'mkt-5', quote: 'Test, learn, improve, and keep the guest at the center.', by: 'Marketing principle' },
    { id: 'mkt-6', quote: 'A strong message connects the promise with the real guest experience.', by: 'Brand principle' },
  ],
  finance: [
    { id: 'fin-1', quote: 'Accurate numbers make better decisions possible.', by: 'Finance principle' },
    { id: 'fin-2', quote: 'Good control protects the team from surprises later.', by: 'Control principle' },
    { id: 'fin-3', quote: 'Clarity in the details creates confidence in the totals.', by: 'Finance principle' },
    { id: 'fin-4', quote: 'Reconcile early, document clearly, and close the loop.', by: 'Finance principle' },
    { id: 'fin-5', quote: 'Reliable reporting starts with reliable inputs.', by: 'Control principle' },
    { id: 'fin-6', quote: 'Good financial discipline gives good ideas room to grow.', by: 'Finance principle' },
  ],
  hr: [
    { id: 'hr-1', quote: 'People do their best work when expectations and support are both clear.', by: 'People principle' },
    { id: 'hr-2', quote: 'A good workplace is built in everyday conversations.', by: 'People principle' },
    { id: 'hr-3', quote: 'Listen carefully, communicate clearly, and follow through.', by: 'HR principle' },
    { id: 'hr-4', quote: 'Strong culture is what teams practice, not only what they say.', by: 'People principle' },
    { id: 'hr-5', quote: 'Fair processes help people trust the decisions around them.', by: 'HR principle' },
    { id: 'hr-6', quote: 'Helping the right person succeed in the right role strengthens the whole team.', by: 'People principle' },
  ],
  hospitality: [
    { id: 'gen-1', quote: 'Good hospitality is many small things done with care.', by: 'Hospitality principle' },
    { id: 'gen-2', quote: 'A smooth guest experience starts with teams helping one another.', by: 'Teamwork principle' },
    { id: 'gen-3', quote: 'Do the next useful thing well.', by: 'Service principle' },
    { id: 'gen-4', quote: 'Clear communication makes good work easier to continue.', by: 'Teamwork principle' },
    { id: 'gen-5', quote: 'Reliable service is built through consistent everyday actions.', by: 'Hospitality principle' },
    { id: 'gen-6', quote: 'Care, clarity, and follow-through make a strong shift.', by: 'Service principle' },
  ],
};

const ROLE_AUDIENCE: Record<string, QuoteAudience> = {
  housekeeping: 'housekeeping',
  reception: 'reception',
  front_office: 'reception',
  maintenance: 'maintenance',
  breakfast_staff: 'breakfast',
  marketing: 'marketing',
  control_finance: 'finance',
  hr: 'hr',

  manager: 'leadership',
  admin: 'leadership',
  top_management: 'leadership',
  housekeeping_manager: 'leadership',
  maintenance_manager: 'leadership',
  marketing_manager: 'leadership',
  reception_manager: 'leadership',
  back_office_manager: 'leadership',
  control_manager: 'leadership',
  finance_manager: 'leadership',
  top_management_manager: 'leadership',
  supervisor: 'leadership',
};

export function quoteAudienceForRole(role?: string | null): QuoteAudience {
  if (!role) return 'hospitality';
  return ROLE_AUDIENCE[role] ?? 'hospitality';
}

export function quotePoolForAudience(audience: QuoteAudience): MotivationalQuote[] {
  return QUOTE_POOLS[audience];
}

export function quotePoolForRole(role?: string | null): MotivationalQuote[] {
  return quotePoolForAudience(quoteAudienceForRole(role));
}
