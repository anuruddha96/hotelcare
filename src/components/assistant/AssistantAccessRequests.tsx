import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const APPROVER_ROLES = ["admin", "top_management", "top_management_manager", "manager"];

export function canApproveAssistantAccess(role?: string | null) {
  return !!role && APPROVER_ROLES.includes(role);
}

interface RequestRow {
  id: string;
  user_id: string;
  requested_scope: string;
  question: string;
  status: string;
  created_at: string;
  hotel_id: string | null;
}

/** Managers decide who may temporarily see data above their role. */
export default function AssistantAccessRequests() {
  const { profile, user } = useAuth();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("assistant_access_requests")
      .select("id,user_id,requested_scope,question,status,created_at,hotel_id")
      .order("created_at", { ascending: false })
      .limit(50);
    const list = (data ?? []) as RequestRow[];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.user_id))];
    if (ids.length) {
      const { data: profiles } = await supabase.from("profiles").select("id,full_name,nickname").in("id", ids);
      const map: Record<string, string> = {};
      for (const p of profiles ?? []) map[p.id] = p.full_name || p.nickname || "Staff member";
      setNames(map);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id: string, status: "approved" | "declined") => {
    setBusy(id);
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const { error } = await supabase
      .from("assistant_access_requests")
      .update({
        status,
        decided_by: user?.id ?? null,
        decided_at: new Date().toISOString(),
        expires_at: status === "approved" ? expires : null,
      })
      .eq("id", id);
    setBusy(null);
    if (error) toast.error("Could not save the decision");
    else {
      toast.success(status === "approved" ? "Access approved for 24 hours" : "Request declined");
      load();
    }
  };

  if (!canApproveAssistantAccess(profile?.role)) {
    return <p className="text-sm text-muted-foreground p-3">Only managers can review access requests.</p>;
  }

  return (
    <div className="space-y-2 p-1">
      {rows.length === 0 && <p className="text-sm text-muted-foreground p-3">No access requests.</p>}
      {rows.map((r) => (
        <div key={r.id} className="rounded-lg border p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{names[r.user_id] ?? "Staff member"}</span>
            <Badge variant={r.status === "pending" ? "secondary" : r.status === "approved" ? "default" : "outline"}>
              {r.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Wants <span className="font-medium text-foreground">{r.requested_scope}</span> access
            {r.hotel_id ? ` · ${r.hotel_id}` : ""}
          </p>
          {r.question && <p className="text-xs italic">“{r.question}”</p>}
          {r.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, "approved")}>
                Approve 24h
              </Button>
              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => decide(r.id, "declined")}>
                Decline
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
