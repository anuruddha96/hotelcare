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
  }, [allowed]);

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
        <h1 className="text-lg font-semibold">Assistant insights</h1>
        <p className="text-xs text-muted-foreground">
          What your teams are asking. Use it to spot training gaps — staff never see this page.
        </p>
      </div>

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
