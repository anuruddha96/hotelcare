// Internal tool names never reach the user. Each one maps to a plain sentence
// that describes what Hotel Care is doing while the answer is being prepared.

const LABELS: Record<string, string> = {
  get_context_now: "Checking today's date…",
  get_my_properties: "Checking your properties…",
  get_app_howto: "Looking up how Hotel Care works…",
  find_destination: "Finding the right page…",
  get_training_guide: "Looking up the walkthrough…",
  suggest_actions: "Preparing your next steps…",
  get_revenue_metrics: "Reviewing revenue figures…",
  get_pickup_and_pace: "Analysing pickup and pace…",
  get_rate_calendar: "Checking prices and restrictions…",
  get_automation_rules: "Reading your automation setup…",
  get_automation_activity: "Reviewing recent pricing activity…",
  get_demand_context: "Checking demand and events…",
  propose_automation_change: "Preparing a change for your approval…",
  get_housekeeping_status: "Checking today's housekeeping…",
  get_maintenance_tickets: "Checking maintenance…",
  get_reception_overview: "Reviewing today's arrivals and departures…",
  get_housekeeping_team: "Checking who is on the housekeeping team…",
  get_lost_and_found: "Checking lost and found…",
  get_staff_on_duty: "Checking who is on duty…",
  get_my_day: "Checking your shift and your rooms…",
  get_room_detail: "Looking up that room…",
  get_purchase_invoices: "Reviewing purchase invoices…",
  propose_action: "Preparing this for your confirmation…",
};

export function activityLabel(toolName: string): string {
  return LABELS[toolName] ?? "Working on it…";
}

/** True for the tool whose output is rendered as a card rather than hidden. */
export function isRenderedTool(toolName: string): boolean {
  return toolName === "suggest_actions" || toolName === "propose_automation_change" || toolName === "propose_action";
}
