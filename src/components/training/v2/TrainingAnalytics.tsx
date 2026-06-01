import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { BarChart3, Pause, BellOff } from 'lucide-react';

interface CompletionRow {
  role: string;
  curriculum_slug: string;
  completed_users: number;
  in_progress_users: number;
  total_users: number;
  completion_pct: number | null;
}

interface FunnelRow {
  curriculum_slug: string;
  role: string;
  step_idx: number;
  users_reached: number;
}

interface DismissalRow {
  dismissed_count: number;
  paused_count: number;
}

export function TrainingAnalytics() {
  const [completion, setCompletion] = useState<CompletionRow[]>([]);
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [dismissals, setDismissals] = useState<DismissalRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [c, f, d] = await Promise.all([
        supabase.from('v_training_completion_by_role' as any).select('*'),
        supabase.from('v_training_step_funnel' as any).select('*'),
        supabase.from('v_training_dismissals' as any).select('*').maybeSingle(),
      ]);
      setCompletion(((c.data as any) || []) as CompletionRow[]);
      setFunnel(((f.data as any) || []) as FunnelRow[]);
      setDismissals(((d.data as any) || null) as DismissalRow | null);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground p-4">Loading analytics…</div>;
  }

  const funnelBySlug: Record<string, FunnelRow[]> = {};
  funnel.forEach((r) => {
    funnelBySlug[r.curriculum_slug] = funnelBySlug[r.curriculum_slug] || [];
    funnelBySlug[r.curriculum_slug].push(r);
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Dismissed</CardTitle>
            <BellOff className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dismissals?.dismissed_count ?? 0}</div>
            <p className="text-xs text-muted-foreground">Users muted for 30 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Paused</CardTitle>
            <Pause className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dismissals?.paused_count ?? 0}</div>
            <p className="text-xs text-muted-foreground">Mid-tour pauses (hotel switch etc.)</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Completion by role
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Curriculum</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">In progress</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-40">Completion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {completion.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{r.curriculum_slug}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.role}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{r.completed_users}</TableCell>
                  <TableCell className="text-right">{r.in_progress_users}</TableCell>
                  <TableCell className="text-right">{r.total_users}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={Number(r.completion_pct) || 0} className="flex-1" />
                      <span className="text-xs w-10 text-right">{r.completion_pct ?? 0}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {completion.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No training data yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step funnel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(funnelBySlug).map(([slug, rows]) => {
            const byStep: Record<number, number> = {};
            rows.forEach((r) => {
              byStep[r.step_idx] = (byStep[r.step_idx] || 0) + r.users_reached;
            });
            const max = Math.max(...Object.values(byStep), 1);
            const ordered = Object.entries(byStep).sort(([a], [b]) => Number(a) - Number(b));
            return (
              <div key={slug}>
                <div className="text-xs font-mono mb-2 text-muted-foreground">{slug}</div>
                <div className="space-y-1">
                  {ordered.map(([idx, count]) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs w-16 text-muted-foreground">Step {Number(idx) + 1}</span>
                      <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${(count / max) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs w-10 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {Object.keys(funnelBySlug).length === 0 && (
            <div className="text-sm text-muted-foreground">No funnel data yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
