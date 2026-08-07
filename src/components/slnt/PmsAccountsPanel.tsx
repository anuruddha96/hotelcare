import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Cable, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type PmsAccount = {
  id: string;
  label: string;
  pms_hotel_id: string | null;
  credentials_secret_name: string | null;
  is_active: boolean;
  is_primary: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
};

const EMPTY = { label: '', pms_hotel_id: '', credentials_secret_name: '' };

/**
 * SLNT-only: one property can aggregate several Previo accounts. Staff still
 * see a single merged portfolio; each account just carries its own PMS hotel
 * id and its own credentials secret.
 */
export const PmsAccountsPanel: React.FC = () => {
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState<PmsAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const orgSlug = profile?.organization_slug ?? '';
  const hotelId = profile?.assigned_hotel ?? orgSlug;

  const load = async () => {
    if (!orgSlug) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('pms_accounts')
      .select('id, label, pms_hotel_id, credentials_secret_name, is_active, is_primary, last_sync_at, last_sync_status')
      .eq('organization_slug', orgSlug)
      .order('is_primary', { ascending: false })
      .order('label');
    if (error) toast.error('Could not load PMS accounts');
    setAccounts((data ?? []) as PmsAccount[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  const save = async () => {
    if (!form.label.trim()) return toast.error('Give the account a name');
    setSaving(true);
    const { error } = await supabase.from('pms_accounts').insert({
      hotel_id: hotelId,
      organization_slug: orgSlug,
      label: form.label.trim(),
      pms_type: 'previo',
      pms_hotel_id: form.pms_hotel_id.trim() || null,
      credentials_secret_name: form.credentials_secret_name.trim() || null,
      is_primary: accounts.length === 0,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('PMS account added');
    setForm(EMPTY);
    setOpen(false);
    load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Cable className="h-5 w-5" /> PMS accounts
          </CardTitle>
          <CardDescription>
            Several Previo accounts feed one merged portfolio. Credentials live in project
            secrets — only the secret name is stored here.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add account
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No PMS accounts yet. Add both Previo accounts to merge them into one view.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {accounts.map((a) => (
              <div key={a.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{a.label}</p>
                  {a.is_primary && <Badge>Primary</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  PMS hotel id: {a.pms_hotel_id || '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Secret: {a.credentials_secret_name || 'not set'}
                </p>
                <Badge variant="secondary" className="mt-2">
                  {a.last_sync_status ?? 'never synced'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add PMS account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="acc-label">Account name</Label>
              <Input
                id="acc-label"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. SLNT Previo (new)"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-hotel">Previo hotel id</Label>
              <Input
                id="acc-hotel"
                value={form.pms_hotel_id}
                onChange={(e) => setForm({ ...form, pms_hotel_id: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-secret">Credentials secret name</Label>
              <Input
                id="acc-secret"
                value={form.credentials_secret_name}
                onChange={(e) => setForm({ ...form, credentials_secret_name: e.target.value })}
                placeholder="PREVIO_CREDS_SLNT_A"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default PmsAccountsPanel;
