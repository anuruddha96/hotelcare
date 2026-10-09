/**
 * UI-only aggregation of server-owned queue job status.
 * One SLNT hotel refresh comprises multiple account jobs. Never report the
 * hotel as fully refreshed until every account job has actually finished.
 */
export type PmsQueuedJob = {
  id: string;
  hotel_id: string;
  status: "pending" | "running" | "success" | "partial" | "failed" | "cancelled";
  error_message?: string | null;
};
export type PmsQueueProgress = {
  status: "queued" | "success" | "partial" | "error";
  complete: boolean;
  remaining: number;
  running: number;
  message: string;
};
export function aggregatePmsQueueJobs(jobs: PmsQueuedJob[]): PmsQueueProgress {
  if (!jobs.length) return {
    status: "error", complete: true, remaining: 0, running: 0,
    message: "The refresh request is missing from the queue.",
  };
  const running = jobs.filter(j => j.status === "running").length;
  const remaining = jobs.filter(j => j.status === "running" || j.status === "pending").length;
  if (remaining > 0) return {
    status: "queued", complete: false, remaining, running,
    message: running > 0
      ? `PMS refresh running — ${remaining} account(s) remaining`
      : `PMS refresh queued — ${remaining} account(s) waiting`,
  };
  const failed = jobs.filter(j => j.status === "failed" || j.status === "cancelled");
  if (failed.length) return {
    status: "error", complete: true, remaining: 0, running: 0,
    message: failed[0].error_message || "One or more PMS accounts failed to refresh.",
  };
  if (jobs.some(j => j.status === "partial")) return {
    status: "partial", complete: true, remaining: 0, running: 0,
    message: "PMS refresh completed with incomplete room coverage.",
  };
  return {
    status: "success", complete: true, remaining: 0, running: 0,
    message: "Full PMS refresh completed successfully.",
  };
}
