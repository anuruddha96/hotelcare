export interface RevenueAutomationMasterState {
  is_enabled?: boolean | null;
  auto_publish?: boolean | null;
  engine_version?: number | null;
  mode?: string | null;
}

export interface MinimumStayAutomationState extends RevenueAutomationMasterState {
  min_stay_automation_enabled?: boolean | null;
  min_stay_automation_live?: boolean | null;
}

/**
 * One shared kill-switch contract for every live revenue writer.
 *
 * Pre-provisioned hotels may carry the complete Ottofiori configuration while
 * the master is_enabled flag is false. That state must never be publishable.
 */
export function isRevenueAutomationLive(rule: RevenueAutomationMasterState | null | undefined): boolean {
  return Boolean(
    rule?.is_enabled === true &&
    rule?.auto_publish === true &&
    Number(rule?.engine_version ?? 0) >= 2 &&
    rule?.mode === "live"
  );
}

export function canRunLiveMinimumStay(rule: MinimumStayAutomationState | null | undefined): boolean {
  return Boolean(
    isRevenueAutomationLive(rule) &&
    rule?.min_stay_automation_enabled === true &&
    rule?.min_stay_automation_live === true
  );
}
