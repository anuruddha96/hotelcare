import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader2, Save, ShieldCheck, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  parkingErrorMessage,
  parseNotificationEmails,
  type ParkingAccess,
  type ParkingAccessUser,
  type ParkingSettings,
} from '@/lib/parking';
import {
  listParkingUsers,
  saveParkingSettings,
  setParkingUserAccess,
} from '@/lib/parkingApi';

interface Props {
  organizationSlug: string;
  hotelId: string;
  settings: ParkingSettings | null;
  onSaved: (settings: ParkingSettings) => void;
}
export function ParkingSettingsPanel({ organizationSlug, hotelId, settings, onSaved }: Props) {
  const [providerName, setProviderName] = useState('Done Park');
  const [emails, setEmails] = useState('');
  const [validityDays, setValidityDays] = useState('1');
  const [users, setUsers] = useState<ParkingAccessUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [usersLoading, setUsersLoading] = useState(true);
  const [changingUser, setChangingUser] = useState('');

  useEffect(() => {
    setProviderName(settings?.provider_name || 'Done Park');
    setEmails((settings?.notification_emails || []).join('\n'));
    setValidityDays(String(settings?.default_validity_days || 1));
  }, [settings, hotelId]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      setUsers(await listParkingUsers(organizationSlug, hotelId));
    } catch (error) {
      toast.error(parkingErrorMessage(error, 'Could not load eligible users.'));
    } finally {
      setUsersLoading(false);
    }
  }, [organizationSlug, hotelId]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const days = Number(validityDays);
    if (!providerName.trim()) return toast.error('Enter the parking provider name.');
    if (!Number.isInteger(days) || days < 1 || days > 90) return toast.error('Default validity must be between 1 and 90 days.');
    setBusy(true);
    try {
      const next = await saveParkingSettings({
        organizationSlug,
        hotelId,
        providerName: providerName.trim(),
        notificationEmails: parseNotificationEmails(emails),
        defaultValidityDays: days,
      });
      onSaved(next);
      toast.success('Parking settings saved.');
    } catch (error) {
      toast.error(parkingErrorMessage(error, 'Could not save parking settings.'));
    } finally {
      setBusy(false);
    }
  }

  async function changeAccess(user: ParkingAccessUser, accessLevel: ParkingAccess) {
    setChangingUser(user.user_id);
    try {
      await setParkingUserAccess({ organizationSlug, hotelId, userId: user.user_id, accessLevel });
      toast.success(`Parking access updated for ${user.full_name}.`);
      await loadUsers();
    } catch (error) {
      toast.error(parkingErrorMessage(error, 'Could not update parking access.'));
    } finally {
      setChangingUser('');
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="h-fit">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-primary" />Parking setup</CardTitle><p className="text-sm text-muted-foreground">Defaults used when reception issues a ticket. Notification addresses are stored now for cancellation reporting integration.</p></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={save}>
            <div className="space-y-1.5"><Label htmlFor="parking-provider">Provider</Label><Input id="parking-provider" value={providerName} onChange={(event) => setProviderName(event.target.value)} maxLength={100} /></div>
            <div className="space-y-1.5"><Label htmlFor="parking-validity-default">Default validity (days)</Label><Input id="parking-validity-default" type="number" min={1} max={90} value={validityDays} onChange={(event) => setValidityDays(event.target.value)} /><p className="text-xs text-muted-foreground">Reception can still change the dates for an individual guest.</p></div>
            <div className="space-y-1.5"><Label htmlFor="parking-emails">Cancellation notification emails</Label><Textarea id="parking-emails" value={emails} onChange={(event) => setEmails(event.target.value)} placeholder={'parking@example.com\nmanager@example.com'} /><p className="text-xs text-muted-foreground">One per line, or separated by commas or semicolons.</p></div>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save settings</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><UserCog className="h-5 w-5 text-primary" />Eligible users</CardTitle><p className="text-sm text-muted-foreground">Reception and management roles are included automatically. Grant individual access to other users assigned to this hotel.</p></CardHeader>
        <CardContent>
          {usersLoading ? <div className="flex min-h-32 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading users…</div> : users.length === 0 ? <p className="text-sm text-muted-foreground">No hotel users found.</p> : (
            <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {users.map((user) => {
                const includedByRole = user.role_access !== 'none';
                return (
                  <div key={user.user_id} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{user.full_name}</p><p className="truncate text-xs text-muted-foreground">{user.email}</p><Badge variant="secondary" className="mt-1 text-[10px]">{user.role.replaceAll('_', ' ')}</Badge></div>
                    {includedByRole ? (
                      <Badge variant="outline" className="shrink-0">{user.role_access === 'manage' ? 'Manage' : 'Issue'} · role</Badge>
                    ) : (
                      <Select value={user.granted_access} onValueChange={(value) => void changeAccess(user, value as ParkingAccess)} disabled={changingUser === user.user_id}>
                        <SelectTrigger className="w-[118px] shrink-0"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="none">No access</SelectItem><SelectItem value="issue">Issue</SelectItem><SelectItem value="manage">Manage</SelectItem></SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
