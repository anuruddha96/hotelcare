import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { RefreshCw, Bell, CheckCircle2, RotateCcw, Users } from 'lucide-react';
import { ALL_CURRICULA } from '@/components/training/v2/TrainingV2Provider';
import { TrainingAnalytics } from '@/components/training/v2/TrainingAnalytics';

interface User {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
}

interface ProgressRow {
  user_id: string;
  tour_key: string;
  status: string;
  current_step: number;
}

type Action = 'reset' | 'retrigger' | 'mark_complete';

export function TrainingAdminPanel() {
  const [users, setUsers] = useState<User[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedCurricula, setSelectedCurricula] = useState<Set<string>>(
    new Set(ALL_CURRICULA.map((c) => c.slug)),
  );
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [u, p] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role').limit(500),
      supabase.from('user_tour_progress').select('user_id, tour_key, status, current_step'),
    ]);
    setUsers(((u.data as any) || []) as User[]);
    setProgress(((p.data as any) || []) as ProgressRow[]);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q),
    );
  }, [users, search]);

  const progressByUser: Record<string, Record<string, ProgressRow>> = {};
  progress.forEach((r) => {
    progressByUser[r.user_id] = progressByUser[r.user_id] || {};
    progressByUser[r.user_id][r.tour_key] = r;
  });

  const toggleUser = (id: string) => {
    const ns = new Set(selected);
    if (ns.has(id)) ns.delete(id);
    else ns.add(id);
    setSelected(ns);
  };

  const toggleCurriculum = (slug: string) => {
    const ns = new Set(selectedCurricula);
    if (ns.has(slug)) ns.delete(slug);
    else ns.add(slug);
    setSelectedCurricula(ns);
  };

  const runAction = async (action: Action) => {
    if (selected.size === 0 || selectedCurricula.size === 0) {
      toast.error('Pick at least one user and one curriculum.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke('training-admin-action', {
        body: {
          action,
          userIds: Array.from(selected),
          curriculumSlugs: Array.from(selectedCurricula),
        },
      });
      if (error) throw error;
      toast.success('Done.');
      setSelected(new Set());
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Manage user training
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search by name, email, role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction('retrigger')}>
              <Bell className="h-4 w-4 mr-1" /> Re-trigger auto-start
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction('mark_complete')}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Mark complete
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => runAction('reset')}>
              <RotateCcw className="h-4 w-4 mr-1" /> Reset
            </Button>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Curricula to affect
            </div>
            <div className="flex flex-wrap gap-2">
              {ALL_CURRICULA.map((c) => (
                <button
                  type="button"
                  key={c.slug}
                  onClick={() => toggleCurriculum(c.slug)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    selectedCurricula.has(c.slug)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border'
                  }`}
                >
                  {c.name.en}
                </button>
              ))}
            </div>
          </div>

          <div className="border rounded-md max-h-[460px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const prog = progressByUser[u.id] || {};
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(u.id)}
                          onCheckedChange={() => toggleUser(u.id)}
                          aria-label={`Select ${u.full_name || u.email}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{u.full_name || '—'}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{u.role || '—'}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {Object.values(prog).map((p) => (
                            <Badge
                              key={p.tour_key}
                              variant={p.status === 'completed' ? 'default' : 'secondary'}
                              className="text-[10px]"
                            >
                              {p.tour_key.replace('v2_', '')} · {p.status === 'completed' ? '✓' : p.current_step}
                            </Badge>
                          ))}
                          {Object.keys(prog).length === 0 && (
                            <span className="text-xs text-muted-foreground">No activity</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      No users found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <TrainingAnalytics />
    </div>
  );
}
