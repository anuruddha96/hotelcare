export type MotivationalQuote = {
  id: string;
  quote: string;
  by: string;
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

const SHARED_OPERATIONAL_QUOTES: MotivationalQuote[] = [
  { id: 'shared-1', quote: 'Make the next handover easier than the one you received.', by: 'Team continuity' },
  { id: 'shared-2', quote: 'When something changes, make the change visible.', by: 'Operational clarity' },
  { id: 'shared-3', quote: 'A repeated workaround is a signal that the process deserves a better answer.', by: 'Continuous improvement' },
  { id: 'shared-4', quote: 'Good service is easier when the system remembers what people should not have to.', by: 'Smart operations' },
];

const QUOTE_POOLS: Record<QuoteAudience, MotivationalQuote[]> = {
  housekeeping: [
    { id: 'hk-1', quote: 'A room is not ready when cleaning ends; it is ready when the next guest can enter without a question.', by: 'Room readiness' },
    { id: 'hk-2', quote: 'Guests may never see the checklist, but they feel the result when every detail is right.', by: 'Guest experience' },
    { id: 'hk-3', quote: 'A five-second final scan can protect the work of the whole clean.', by: 'Quality check' },
    { id: 'hk-4', quote: 'Report the small defect now; today\'s note can prevent tomorrow\'s room move.', by: 'Preventive care' },
    { id: 'hk-5', quote: 'Speed matters, but consistency is what makes a room dependable.', by: 'Housekeeping craft' },
    { id: 'hk-6', quote: 'The best room reset leaves no trace of the work, only the feeling that everything is ready.', by: 'Housekeeping craft' },
    { id: 'hk-7', quote: 'A clear linen count and a clear room status make the next person\'s job easier.', by: 'Team coordination' },
    { id: 'hk-8', quote: 'Small details become big memories when a guest notices they were cared for.', by: 'Guest care' },
  ],
  housekeeping_leadership: [
    { id: 'hk-lead-1', quote: 'A clean-room target matters only when the team also knows the quality standard behind it.', by: 'Housekeeping leadership' },
    { id: 'hk-lead-2', quote: 'The best assignment balances workload before the floor becomes stressful.', by: 'Floor planning' },
    { id: 'hk-lead-3', quote: 'Inspect patterns, not only rooms; repeated misses usually point to a process that needs help.', by: 'Quality leadership' },
    { id: 'hk-lead-4', quote: 'A fast team becomes a strong team when speed, quality, and fairness move together.', by: 'Team performance' },
    { id: 'hk-lead-5', quote: 'Give feedback while the room and the reason are still fresh.', by: 'Coaching' },
    { id: 'hk-lead-6', quote: 'If the same problem appears on three floors, solve the system before blaming the shift.', by: 'Operational leadership' },
    { id: 'hk-lead-7', quote: 'Good supervisors make priorities obvious before the busy hour begins.', by: 'Shift leadership' },
    { id: 'hk-lead-8', quote: 'Room status, linen, defects, and staffing tell one story; read them together.', by: 'Housekeeping operations' },
  ],
  reception: [
    { id: 'rec-1', quote: 'A guest remembers how uncertainty felt; a clear next step is part of the service.', by: 'Guest confidence' },
    { id: 'rec-2', quote: 'A good handover means the guest does not need to tell the same story twice.', by: 'Shift handover' },
    { id: 'rec-3', quote: 'Accuracy creates trust before friendliness has a chance to strengthen it.', by: 'Front desk discipline' },
    { id: 'rec-4', quote: 'The best answer is not only correct; it also makes the next action easy.', by: 'Guest service' },
    { id: 'rec-5', quote: 'A calm explanation can turn a difficult moment into a recoverable one.', by: 'Service recovery' },
    { id: 'rec-6', quote: 'Notice the request behind the question, not only the words in front of you.', by: 'Guest awareness' },
    { id: 'rec-7', quote: 'Every useful note you leave is time saved for the next colleague and the next guest.', by: 'Front desk teamwork' },
    { id: 'rec-8', quote: 'Fast check-in is good; a guest who knows exactly what happens next is better.', by: 'Arrival experience' },
  ],
  reception_leadership: [
    { id: 'rec-lead-1', quote: 'A strong front desk does not rely on memory; it relies on visible, shared information.', by: 'Front office leadership' },
    { id: 'rec-lead-2', quote: 'Escalate early enough that the team still has choices.', by: 'Service leadership' },
    { id: 'rec-lead-3', quote: 'The quality of a shift is often decided by the quality of its handover.', by: 'Shift management' },
    { id: 'rec-lead-4', quote: 'Teach the reason behind the rule and the team can make better decisions when the script runs out.', by: 'Front office coaching' },
    { id: 'rec-lead-5', quote: 'Watch the repeated guest question; it usually reveals an information gap worth fixing.', by: 'Guest journey' },
    { id: 'rec-lead-6', quote: 'A manager adds value when the team knows what they can solve alone and when to call for help.', by: 'Decision clarity' },
    { id: 'rec-lead-7', quote: 'Service recovery works best when ownership is clear from the first minute.', by: 'Guest recovery' },
    { id: 'rec-lead-8', quote: 'Good staffing matches the busiest guest moments, not only the clock.', by: 'Front office planning' },
  ],
  maintenance: [
    { id: 'mnt-1', quote: 'The fastest repair is useful; the repair that removes the cause is valuable.', by: 'Root-cause thinking' },
    { id: 'mnt-2', quote: 'The best maintenance work is often the problem a guest never has to notice.', by: 'Preventive maintenance' },
    { id: 'mnt-3', quote: 'A repair is complete when the fix, the safety check, and the update are all complete.', by: 'Maintenance discipline' },
    { id: 'mnt-4', quote: 'A small recurring fault is not small once it becomes part of the guest experience.', by: 'Reliability' },
    { id: 'mnt-5', quote: 'Document what failed and why; the next repair should start smarter than the last one.', by: 'Technical learning' },
    { id: 'mnt-6', quote: 'Temporary fixes need visible expiry dates, otherwise temporary becomes permanent.', by: 'Maintenance control' },
    { id: 'mnt-7', quote: 'Safety, function, finish: a good repair respects all three.', by: 'Maintenance quality' },
    { id: 'mnt-8', quote: 'The right priority is the issue with the greatest guest, safety, or operational impact.', by: 'Work prioritization' },
  ],
  maintenance_leadership: [
    { id: 'mnt-lead-1', quote: 'A maintenance backlog is a risk map; prioritize it by impact, not by age alone.', by: 'Engineering leadership' },
    { id: 'mnt-lead-2', quote: 'If a fault keeps returning, schedule time for the cause instead of paying repeatedly for the symptom.', by: 'Reliability management' },
    { id: 'mnt-lead-3', quote: 'The best preventive plan is built from real failures, not generic intervals alone.', by: 'Preventive strategy' },
    { id: 'mnt-lead-4', quote: 'Good maintenance leadership protects guest comfort before the complaint arrives.', by: 'Proactive operations' },
    { id: 'mnt-lead-5', quote: 'A closed ticket without a clear outcome is only a hidden open problem.', by: 'Ticket quality' },
    { id: 'mnt-lead-6', quote: 'Make critical spares, owners, and escalation paths obvious before the emergency.', by: 'Operational resilience' },
    { id: 'mnt-lead-7', quote: 'Measure repeat faults as carefully as response time; speed without permanence is expensive.', by: 'Maintenance performance' },
    { id: 'mnt-lead-8', quote: 'The team works faster when priorities are stable and exceptions are truly exceptional.', by: 'Team coordination' },
  ],
  breakfast: [
    { id: 'bf-1', quote: 'The calmest breakfast service starts before the first guest arrives.', by: 'Service preparation' },
    { id: 'bf-2', quote: 'Refill before the tray looks empty and the guest never experiences the shortage.', by: 'Guest awareness' },
    { id: 'bf-3', quote: 'Freshness, cleanliness, and pace are separate details that create one impression.', by: 'Breakfast quality' },
    { id: 'bf-4', quote: 'A warm greeting takes seconds and can shape the guest\'s whole morning.', by: 'Morning hospitality' },
    { id: 'bf-5', quote: 'The best busy service looks calm because preparation happened early.', by: 'Breakfast teamwork' },
    { id: 'bf-6', quote: 'Notice the table before the guest has to ask.', by: 'Attentive service' },
    { id: 'bf-7', quote: 'Small hygiene habits protect a much bigger promise of trust.', by: 'Food service discipline' },
    { id: 'bf-8', quote: 'A smooth close prepares tomorrow as much as it finishes today.', by: 'Shift continuity' },
  ],
  marketing: [
    { id: 'mkt-1', quote: 'A promise in an ad becomes a review after check-out.', by: 'Brand reality' },
    { id: 'mkt-2', quote: 'The strongest message makes the right guest understand the value quickly.', by: 'Positioning' },
    { id: 'mkt-3', quote: 'Do not make every channel louder; make the guest journey clearer.', by: 'Channel strategy' },
    { id: 'mkt-4', quote: 'Good content answers the question a guest is already trying to solve.', by: 'Useful marketing' },
    { id: 'mkt-5', quote: 'A beautiful campaign cannot repair a confusing offer.', by: 'Offer clarity' },
    { id: 'mkt-6', quote: 'Measure what changed after the click, not only how many clicks arrived.', by: 'Marketing effectiveness' },
    { id: 'mkt-7', quote: 'Consistency builds recognition; relevance earns attention.', by: 'Brand discipline' },
    { id: 'mkt-8', quote: 'The best creative idea still needs a clear next action.', by: 'Conversion thinking' },
  ],
  marketing_leadership: [
    { id: 'mkt-lead-1', quote: 'Strategy is choosing which guest, which promise, and which channel deserve focus now.', by: 'Marketing leadership' },
    { id: 'mkt-lead-2', quote: 'Brand strength grows when commercial promises and operational reality stay aligned.', by: 'Brand leadership' },
    { id: 'mkt-lead-3', quote: 'A campaign without a learning question is only spending with a deadline.', by: 'Growth discipline' },
    { id: 'mkt-lead-4', quote: 'Protect the message from unnecessary complexity; clarity scales better than explanation.', by: 'Communication strategy' },
    { id: 'mkt-lead-5', quote: 'Use data to decide where to look, then use judgment to decide what it means.', by: 'Marketing insight' },
    { id: 'mkt-lead-6', quote: 'The right promotion solves a demand problem without creating a value problem.', by: 'Commercial strategy' },
    { id: 'mkt-lead-7', quote: 'Strong teams know which metric matters before the campaign starts.', by: 'Performance marketing' },
    { id: 'mkt-lead-8', quote: 'A coherent guest story across website, OTA, email, and hotel is a competitive advantage.', by: 'Brand consistency' },
  ],
  finance: [
    { id: 'fin-1', quote: 'Every unreconciled number is a future decision made with less confidence.', by: 'Financial clarity' },
    { id: 'fin-2', quote: 'Accurate inputs are not administration; they are the foundation of useful reporting.', by: 'Finance discipline' },
    { id: 'fin-3', quote: 'Reconcile early while the transaction is still easy to explain.', by: 'Control practice' },
    { id: 'fin-4', quote: 'A number becomes useful when someone can trace where it came from.', by: 'Auditability' },
    { id: 'fin-5', quote: 'Small unexplained differences deserve attention before they become normal.', by: 'Control awareness' },
    { id: 'fin-6', quote: 'Good documentation turns tomorrow\'s question into today\'s answer.', by: 'Finance workflow' },
    { id: 'fin-7', quote: 'Close the loop: identify, verify, correct, and record.', by: 'Reconciliation discipline' },
    { id: 'fin-8', quote: 'Reliable reporting is built transaction by transaction.', by: 'Financial reliability' },
  ],
  finance_leadership: [
    { id: 'fin-lead-1', quote: 'Controls should make risk visible without making good work unnecessarily slow.', by: 'Finance leadership' },
    { id: 'fin-lead-2', quote: 'A good report does not only explain what happened; it helps decide what to do next.', by: 'Management reporting' },
    { id: 'fin-lead-3', quote: 'Investigate the pattern behind the variance, not only the variance itself.', by: 'Financial analysis' },
    { id: 'fin-lead-4', quote: 'Cash, margin, and revenue tell different stories; strong decisions read all three.', by: 'Commercial finance' },
    { id: 'fin-lead-5', quote: 'A control that nobody can follow on a busy day needs redesign, not more reminders.', by: 'Process control' },
    { id: 'fin-lead-6', quote: 'Make ownership of exceptions as clear as ownership of routine work.', by: 'Financial governance' },
    { id: 'fin-lead-7', quote: 'The earlier a discrepancy is visible, the cheaper it usually is to understand.', by: 'Risk management' },
    { id: 'fin-lead-8', quote: 'Finance adds value when accuracy becomes insight and insight becomes action.', by: 'Finance leadership' },
  ],
  hr: [
    { id: 'hr-1', quote: 'The clearest job description is the one a new colleague can use on the first busy day.', by: 'Role clarity' },
    { id: 'hr-2', quote: 'Culture is built most visibly in the moments when pressure is high.', by: 'People culture' },
    { id: 'hr-3', quote: 'Feedback is most useful when it is specific enough to act on.', by: 'People development' },
    { id: 'hr-4', quote: 'Fairness grows when expectations are clear before performance is judged.', by: 'People practice' },
    { id: 'hr-5', quote: 'A good onboarding answers not only what to do, but where to look when something changes.', by: 'Onboarding' },
    { id: 'hr-6', quote: 'Listen for the repeated frustration; it often points to a process problem, not a people problem.', by: 'Employee experience' },
    { id: 'hr-7', quote: 'Recognition is strongest when it names the behavior worth repeating.', by: 'Team recognition' },
    { id: 'hr-8', quote: 'The right person in the right role still needs the right information to succeed.', by: 'People operations' },
  ],
  hotel_management: [
    { id: 'mgr-1', quote: 'A manager\'s job is not to know everything; it is to make the next decision clear.', by: 'Hotel leadership' },
    { id: 'mgr-2', quote: 'What gets escalated late becomes expensive; make problems visible while they are still small.', by: 'Operational leadership' },
    { id: 'mgr-3', quote: 'The best shift handover answers three things: what changed, what matters now, and who owns the next step.', by: 'Management discipline' },
    { id: 'mgr-4', quote: 'A standard is useful only when the team can see it, understand it, and act on it.', by: 'Operational standards' },
    { id: 'mgr-5', quote: 'Do not manage every task; manage the priorities, ownership, and exceptions.', by: 'Management focus' },
    { id: 'mgr-6', quote: 'The guest experience is where every department\'s handover eventually becomes visible.', by: 'Cross-team operations' },
    { id: 'mgr-7', quote: 'A recurring problem deserves a process decision, not another one-time reminder.', by: 'Continuous improvement' },
    { id: 'mgr-8', quote: 'Good managers create enough clarity that the team can move well without waiting for them.', by: 'Team autonomy' },
  ],
  executive: [
    { id: 'exec-1', quote: 'Revenue is the result; the operating system is the cause.', by: 'Executive operations' },
    { id: 'exec-2', quote: 'A hotel grows stronger when its data, people, and decisions tell the same story.', by: 'Business alignment' },
    { id: 'exec-3', quote: 'Scale the process that works, not the workaround that survived.', by: 'Scalable operations' },
    { id: 'exec-4', quote: 'The best automation removes repetition while keeping judgment where judgment creates value.', by: 'Automation strategy' },
    { id: 'exec-5', quote: 'A dashboard is useful only when it changes a decision, a priority, or an action.', by: 'Management intelligence' },
    { id: 'exec-6', quote: 'Protect the guest promise, improve the economics, and simplify the operation whenever one decision can do all three.', by: 'Executive decision-making' },
    { id: 'exec-7', quote: 'Do not optimize one department in a way that creates hidden work for three others.', by: 'System thinking' },
    { id: 'exec-8', quote: 'The strongest businesses turn operational learning into a repeatable advantage.', by: 'Competitive operations' },
  ],
  admin: [
    { id: 'adm-1', quote: 'The best system is the one people can follow correctly on a busy day.', by: 'System design' },
    { id: 'adm-2', quote: 'Automation should remove repetition, not remove judgment.', by: 'Automation principle' },
    { id: 'adm-3', quote: 'Permissions are part of the workflow; give people exactly the access their responsibility needs.', by: 'Access design' },
    { id: 'adm-4', quote: 'A configuration is not finished until the next person can understand why it exists.', by: 'System stewardship' },
    { id: 'adm-5', quote: 'Make the correct action easier than the workaround.', by: 'Product operations' },
    { id: 'adm-6', quote: 'Every manual exception is useful evidence for the next system improvement.', by: 'Process design' },
    { id: 'adm-7', quote: 'Reliable systems fail visibly, recover safely, and leave enough information to learn from the failure.', by: 'Operational reliability' },
    { id: 'adm-8', quote: 'Good administration turns complexity into clear choices for everyone else.', by: 'Administrative excellence' },
  ],
  supervisor: [
    { id: 'sup-1', quote: 'Inspect the process early, not only the result at the end.', by: 'Shift supervision' },
    { id: 'sup-2', quote: 'The team moves faster when priorities are clear before the rush begins.', by: 'Shift planning' },
    { id: 'sup-3', quote: 'Correct a small misunderstanding before it becomes a repeated habit.', by: 'Team coaching' },
    { id: 'sup-4', quote: 'A good supervisor sees both the workload and the person carrying it.', by: 'People leadership' },
    { id: 'sup-5', quote: 'When you reassign work, make ownership unmistakable.', by: 'Operational clarity' },
    { id: 'sup-6', quote: 'The best check-in with a team member is short, specific, and useful.', by: 'Daily leadership' },
    { id: 'sup-7', quote: 'Escalate the exception, not every decision.', by: 'Supervisor judgment' },
    { id: 'sup-8', quote: 'Finish the shift by making tomorrow easier to start.', by: 'Shift continuity' },
  ],
  hospitality: [
    { id: 'gen-1', quote: 'Hospitality is the art of making the next step feel easy for someone else.', by: 'Service mindset' },
    { id: 'gen-2', quote: 'A smooth guest experience is usually the result of several good handovers nobody sees.', by: 'Hotel teamwork' },
    { id: 'gen-3', quote: 'Small problems stay small when the right person hears about them early.', by: 'Operational awareness' },
    { id: 'gen-4', quote: 'The details guests remember are often the moments when someone noticed before they had to ask.', by: 'Guest care' },
    { id: 'gen-5', quote: 'Consistency creates trust long before a guest knows how much work sits behind it.', by: 'Hospitality quality' },
    { id: 'gen-6', quote: 'Good teamwork turns separate tasks into one guest experience.', by: 'Hotel operations' },
    { id: 'gen-7', quote: 'When information travels well, service usually follows.', by: 'Team communication' },
    { id: 'gen-8', quote: 'Leave the room, task, note, or handover clearer than you found it.', by: 'Service discipline' },
  ],
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

export function quoteAudienceForRole(role?: string | null): QuoteAudience {
  if (!role) return 'hospitality';
  return ROLE_AUDIENCE[role] ?? 'hospitality';
}

export function quotePoolForAudience(audience: QuoteAudience): MotivationalQuote[] {
  return [...QUOTE_POOLS[audience], ...SHARED_OPERATIONAL_QUOTES];
}

export function quotePoolForRole(role?: string | null): MotivationalQuote[] {
  return quotePoolForAudience(quoteAudienceForRole(role));
}
