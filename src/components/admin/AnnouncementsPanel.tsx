import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Megaphone, Save, Trash2, Pencil, Plus } from 'lucide-react';

const db = supabase as any;

const ROLE_GROUPS: { label: string; roles: string[] }[] = [
  { label: 'Everyone', roles: [] },
  { label: 'Leadership', roles: ['admin', 'top_management', 'top_management_manager'] },
  {
    label: 'Managers',
    roles: [
      'manager',
      'housekeeping_manager',
      'maintenance_manager',
      'reception_manager',
      'marketing_manager',
      'back_office_manager',
      'control_manager',
      'finance_manager',
    ],
  },
  { label: 'Operations staff', roles: ['housekeeping', 'reception', 'maintenance', 'breakfast_staff', 'supervisor'] },
];

interface Draft {
  id?: string;
  title: string;
  body: string;
  tone: 'info' | 'warning' | 'critical';
  target_org_slugs: string[];
  target_roles: string[];
  starts_at: string;
  ends_at: string | null;
  published: boolean;
}

const BLANK: Draft = {
  title: '',
  body: '',
  tone: 'info',
  target_org_slugs: [],
  target_roles: [],
  starts_at: new Date().toISOString().slice(0, 16),
  ends_at: null,
  published: true,
};

export default function AnnouncementsPanel() {
  const { profile } = useAuth();
  const [orgs, setOrgs] = useState<{ slug: string; name: string }[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: orgRows }, { data: rows }] = await Promise.all([
      supabase.from('organizations').select('slug, name').order('name'),
      db.from('system_announcements').select('*').order('created_at', { ascending: false }),
    ]);
    setOrgs((orgRows ?? []) as { slug: string; name: string }[]);
    setItems(rows ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const roleGroupLabel = useMemo(() => {
    const match = ROLE_GROUPS.find(
      (g) => g.roles.length === draft.target_roles.length && g.roles.every((r) => draft.target_roles.includes(r)),
    );
    return match?.label ?? 'Custom';
  }, [draft.target_roles]);

  const save = async () => {
    if (!draft.title.trim() || !draft.body.trim()) {
      toast.error('Give the announcement a title and a message');
      return;
    }
    setSaving(true);
    const payload = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      tone: draft.tone,
      target_org_slugs: draft.target_org_slugs,
      target_roles: draft.target_roles,
      starts_at: new Date(draft.starts_at).toISOString(),
      ends_at: draft.ends_at ? new Date(draft.ends_at).toISOString() : null,
      published: draft.published,
      created_by: profile?.id ?? null,
    };
    const { error } = draft.id
      ? await db.from('system_announcements').update(payload).eq('id', draft.id)
      : await db.from('system_announcements').insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(draft.id ? 'Announcement updated' : 'Announcement published');
    setDraft(BLANK);
    void load();
  };

  const remove = async (id: string) => {
    const { error } = await db.from('system_announcements').delete().eq('id', id);
    if (error) toast.error(error.message);
    else {
      toast.success('Announcement deleted');
      void load();
    }
  };

  const togglePublished = async (row: any) => {
    const { error } = await db.from('system_announcements').update({ published: !row.published }).eq('id', row.id);
    if (error) toast.error(error.message);
    else void load();
  };

  const edit = (row: any) =>
    setDraft({
      id: row.id,
      title: row.title,
      body: row.body,
      tone: row.tone,
      target_org_slugs: row.target_org_slugs ?? [],
      target_roles: row.target_roles ?? [],
      starts_at: (row.starts_at ?? new Date().toISOString()).slice(0, 16),
      ends_at: row.ends_at ? row.ends_at.slice(0, 16) : null,
      published: row.published,
    });

  const toggleOrg = (slug: string) =>
    setDraft((d) => ({
      ...d,
      target_org_slugs: d.target_org_slugs.includes(slug)
        ? d.target_org_slugs.filter((s) => s !== slug)
        : [...d.target_org_slugs, slug],
    }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Megaphone className="h-6 w-6" /> Announcements
        </h2>
        <p className="text-muted-foreground mt-1">
          Send a message to selected organizations and roles. It appears as a dismissible banner and stays readable in
          the notification panel. Sender is always shown as Hotel Care System.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            {draft.id ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {draft.id ? 'Edit announcement' : 'New announcement'}
          </CardTitle>
          <CardDescription>Leave organizations or roles empty to reach everyone.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label>Title</Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Planned maintenance tonight"
              />
            </div>
            <div className="space-y-2">
              <Label>Tone</Label>
              <Select value={draft.tone} onValueChange={(v) => setDraft((d) => ({ ...d, tone: v as Draft['tone'] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Information</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              rows={4}
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              placeholder="The system may be briefly unavailable between 23:00 and 23:30."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Organizations</Label>
              <div className="rounded-lg border p-3 space-y-2 max-h-40 overflow-y-auto">
                {orgs.length === 0 && <p className="text-sm text-muted-foreground">No organizations</p>}
                {orgs.map((o) => (
                  <label key={o.slug} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={draft.target_org_slugs.includes(o.slug)}
                      onCheckedChange={() => toggleOrg(o.slug)}
                    />
                    {o.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {draft.target_org_slugs.length === 0 ? 'All organizations' : `${draft.target_org_slugs.length} selected`}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Who sees it</Label>
              <Select
                value={roleGroupLabel}
                onValueChange={(label) =>
                  setDraft((d) => ({ ...d, target_roles: ROLE_GROUPS.find((g) => g.label === label)?.roles ?? [] }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_GROUPS.map((g) => (
                    <SelectItem key={g.label} value={g.label}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {draft.target_roles.length === 0 ? 'Everyone in the selected organizations' : draft.target_roles.join(', ')}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 items-end">
            <div className="space-y-2">
              <Label>Show from</Label>
              <Input
                type="datetime-local"
                value={draft.starts_at}
                onChange={(e) => setDraft((d) => ({ ...d, starts_at: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Hide after (optional)</Label>
              <Input
                type="datetime-local"
                value={draft.ends_at ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, ends_at: e.target.value || null }))}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={draft.published} onCheckedChange={(v) => setDraft((d) => ({ ...d, published: v }))} />
              <Label>Published</Label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {draft.id && (
              <Button variant="outline" onClick={() => setDraft(BLANK)}>Cancel edit</Button>
            )}
            <Button onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Publish announcement'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Existing announcements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing published yet.</p>
          ) : (
            items.map((row) => (
              <div key={row.id} className="rounded-lg border p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{row.title}</span>
                    <Badge variant={row.published ? 'default' : 'secondary'}>
                      {row.published ? 'Live' : 'Unpublished'}
                    </Badge>
                    <Badge variant="outline" className="capitalize">{row.tone}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-line mt-1">{row.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(row.target_org_slugs?.length ? row.target_org_slugs.join(', ') : 'All organizations')} ·{' '}
                    {(row.target_roles?.length ? row.target_roles.join(', ') : 'all roles')}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => edit(row)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void togglePublished(row)}>
                    {row.published ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void remove(row.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
