import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AssistantAccessRequests from "@/components/assistant/AssistantAccessRequests";

interface FeedbackRow {
  id: string;
  helpful: boolean;
  reason: string | null;
  created_at: string;
}

interface IssueRow {
  id: string;
  title: string;
  user_description: string | null;
  category: string | null;
  severity: string | null;
  status: string | null;
  current_route: string | null;
  created_at: string;
}

interface UsageAlert {
  id: string;
  user_id: string;
  message: string;
  alert_type: string;
  created_at: string;
  emailed_at: string | null;
}
const OPERATOR_ACTIONS = [
  { label: "Send guest items to housekeeping", example: "Send 3 extra towels to room 202.", mode: "Automatic", access: "Reception, housekeeping, managers" },
  { label: "Change bed setup", example: "Room 108 beds together.", mode: "Automatic", access: "Reception and managers" },
  { label: "Create maintenance tickets", example: "Create a maintenance ticket for the leaking sink in room 301.", mode: "Automatic", access: "Operations teams" },
  { label: "Update ticket status", example: "Mark verified ticket as in progress.", mode: "Automatic", access: "Maintenance and managers" },
  { label: "Adjust rates by whole euros", example: "Decrease every published rate by €2 for the next two days.", mode: "Automatic, verified PMS queue", access: "Admin and top management only" },
  { label: "Set minimum stay", example: "Set a 2-night minimum stay for the weekend.", mode: "Confirmation required", access: "Admin and top management only" },
  { label: "Assign housekeeping rooms", example: "Assign room 215 to the named housekeeper.", mode: "Confirmation required", access: "Housekeeping supervisors and managers" },
  { label: "Change individual price cells", example: "Set room type and occupancy for a specific night.", mode: "Confirmation required", access: "Admin and top management only" },
  { label: "Read hotel operations", example: "Show today's arrivals, open repairs or occupancy.", mode: "Verified read-only", access: "Role-scoped property data" },
] as const;

interface AuditRow {
  id: string;
  role: string | null;
  question: string;
  refused: boolean;
  scopes_used: string[];
  created_at: string;
  hotel_id: string | null;
}

/** Admin / top-management view of what people ask the assistant. */
export default function AssistantInsights() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [usageAlerts, setUsageAlerts] = useState<UsageAlert[]>([]);
  const allowed = profile?.role === "admin" || profile?.role?.startsWith("top_management");

  useEffect(() => {
    document.title = "Assistant insights";
    if (!allowed) return;
    supabase
      .from("assistant_audit_log")
      .select("id,role,question,refused,scopes_used,created_at,hotel_id")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setRows((data ?? []) as AuditRow[]));
    supabase
      .from("assistant_feedback")
      .select("id,helpful,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setFeedback((data ?? []) as FeedbackRow[]));
    supabase
      .from("assistant_issue_reports")
      .select("id,title,user_description,category,severity,status,current_route,created_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setIssues((data ?? []) as IssueRow[]));
    if (profile?.role === "admin") {
      (supabase as any).from("assistant_usage_alert_events")
        .select("id,user_id,message,alert_type,created_at,emailed_at")
        .order("created_at", { ascending: false }).limit(50)
        .then(({ data }: { data: UsageAlert[] | null }) => setUsageAlerts(data ?? []));
    }
  }, [allowed, profile?.role]);

  if (!allowed) {
    return <div className="p-6 text-sm text-muted-foreground">This page is for administrators.</div>;
  }

  const refused = rows.filter((r) => r.refused).length;
  const helpful = feedback.filter((f) => f.helpful).length;
  const helpfulPct = feedback.length ? Math.round((helpful / feedback.length) * 100) : null;
  const openIssues = issues.filter((i) => (i.status ?? "open") !== "closed").length;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-semibold">HotelCare AI Operator · Admin centre</h1>
        <p className="text-xs text-muted-foreground">
          What your teams are asking. Use it to spot training gaps — staff never see this page.
        </p>
      </div>

      {profile?.role === "admin" && (
        <>
          <Card className="p-3 sm:p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Available actions and access</h2>
              <p className="text-xs text-muted-foreground mt-1">
                HotelCare verifies the signed-in role and hotel again before every action. Automatic means no
                extra confirmation; pricing still uses the safe publishing queue, not a direct PMS override.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Action</th>
                  <th className="px-2 py-2 font-medium">Execution</th>
                  <th className="px-2 py-2 font-medium">Roles</th>
                </tr></thead>
                <tbody>{OPERATOR_ACTIONS.map((action) => (
                  <tr key={action.label} className="border-b last:border-0">
                    <td className="px-2 py-2 align-top"><span className="font-medium">{action.label}</span>
                      <div className="mt-1 text-muted-foreground">{action.example}</div></td>
                    <td className="px-2 py-2 align-top">{action.mode}</td>
                    <td className="px-2 py-2 align-top">{action.access}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Message policy: 20 per user each calendar month, resetting on the 1st in Budapest time;
              admin and Anu_000 accounts are exempt. Admins can select Auto / Fast / Balanced / Deep in chat.
              Unverified results must not be presented as completed.
            </p>
          </Card>
          <Card className="p-3 sm:p-4 space-y-2">
            <h2 className="text-sm font-semibold">Monthly limits and token alerts</h2>
            {usageAlerts.length === 0 && <p className="text-xs text-muted-foreground">No usage alerts recorded.</p>}
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {usageAlerts.map((alert) => (
                <div key={alert.id} className="rounded-lg border p-2 text-xs">
                  <div className="flex flex-wrap gap-2 items-center">
                    <Badge variant="outline">{alert.alert_type.replaceAll("_", " ")}</Badge>
                    <span className="text-muted-foreground">{new Date(alert.created_at).toLocaleString()}</span>
                    <span className="text-muted-foreground">{alert.emailed_at ? "Email sent" : "Email not confirmed"}</span>
                  </div>
                  <p className="mt-1">{alert.message}</p>
                  <p className="mt-1 text-muted-foreground">User ID: {alert.user_id}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Questions (last 200)</p>
          <p className="text-2xl font-semibold">{rows.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Blocked by role</p>
          <p className="text-2xl font-semibold">{refused}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Used live data</p>
          <p className="text-2xl font-semibold">{rows.filter((r) => (r.scopes_used ?? []).length > 0).length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Rated helpful</p>
          <p className="text-2xl font-semibold">{helpfulPct === null ? "—" : `${helpfulPct}%`}</p>
          <p className="text-[11px] text-muted-foreground">{feedback.length} ratings</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Open problem reports</p>
          <p className="text-2xl font-semibold">{openIssues}</p>
        </Card>
      </div>

      <Card className="p-3 space-y-2">
        <p className="text-sm font-medium">Problems reported from the assistant</p>
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {issues.map((issue) => (
            <div key={issue.id} className="border-b py-1.5 last:border-0">
              <div className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground w-28 shrink-0">
                  {new Date(issue.created_at).toLocaleString()}
                </span>
                <span className="text-sm flex-1">{issue.title}</span>
                <div className="flex gap-1 shrink-0">
                  {issue.severity && <Badge variant="outline">{issue.severity}</Badge>}
                  {issue.status && <Badge variant="secondary">{issue.status}</Badge>}
                </div>
              </div>
              {issue.user_description && (
                <p className="text-xs text-muted-foreground pl-[7.5rem] line-clamp-2">{issue.user_description}</p>
              )}
            </div>
          ))}
          {issues.length === 0 && <p className="text-sm text-muted-foreground">No problems reported.</p>}
        </div>
      </Card>

      <Card className="p-3">
        <p className="text-sm font-medium mb-2">Access requests</p>
        <AssistantAccessRequests />
      </Card>

      <Card className="p-3 space-y-2">
        <p className="text-sm font-medium">Recent questions</p>
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-2 border-b py-1.5 last:border-0">
              <span className="text-xs text-muted-foreground w-28 shrink-0">
                {new Date(r.created_at).toLocaleString()}
              </span>
              <span className="text-sm flex-1">{r.question}</span>
              <div className="flex gap-1 shrink-0">
                {r.role && <Badge variant="outline">{r.role}</Badge>}
                {r.refused && <Badge variant="destructive">blocked</Badge>}
                {(r.scopes_used ?? []).map((s) => (
                  <Badge key={s} variant="secondary">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
          {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
        </div>
      </Card>
    </div>
  );
}
