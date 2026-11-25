import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, Save, ShieldCheck, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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

type GrantableParkingAccess = Exclude<ParkingAccess, 'manage'>;

const DEFAULT_SENDER = 'tickets@notify.hotelcare.app';
const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const HOTELCARE_SENDER_PATTERN = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)*hotelcare\.app$/i;

export function ParkingSettingsPanel({ organizationSlug, hotelId, settings, onSaved }: Props) {
  const [providerName, setProviderName] = useState('Done Park');
  const [emails, setEmails] = useState('');
  const [validityDays, setValidityDays] = useState('1');
  const [vendorAutoEmail, setVendorAutoEmail] = useState(false);
  const [guestEmailEnabled, setGuestEmailEnabled] = useState(false);
  const [senderEmail, setSenderEmail] = useState(DEFAULT_SENDER);
  const [replyTo, setReplyTo] = useState('');
  const [brandName, setBrandName] = useState('');
  const [parkingInstructions, setParkingInstructions] = useState('');
  const [users, setUsers] = useState<ParkingAccessUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [usersLoading, setUsersLoading] = useState(true);
  const [changingUser, setChangingUser] = useState('');

  useEffect(() => {
    setProviderName(settings?.provider_name || 'Done Park');
    setEmails((settings?.notification_emails || []).join('\n'));
    setValidityDays(String(settings?.default_validity_days || 1));
    setVendorAutoEmail(Boolean(settings?.vendor_auto_email));
    setGuestEmailEnabled(Boolean(settings?.guest_email_enabled));
    setSenderEmail(settings?.sender_email || DEFAULT_SENDER);
    setReplyTo(settings?.reply_to || '');
    setBrandName(settings?.brand_name || '');
    setParkingInstructions(settings?.parking_instructions || '');
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
    const vendorEmails = parseNotificationEmails(emails);
    const cleanSender = senderEmail.trim().toLowerCase();
    const cleanReplyTo = replyTo.trim();

    if (!providerName.trim()) return toast.error('Enter the parking provider name.');
    if (!Number.isInteger(days) || days < 1 || days > 90) return toast.error('Default validity must be between 1 and 90 days.');
    if (vendorEmails.length > 5) return toast.error('Use at most five parking vendor email addresses.');
    if (vendorAutoEmail && vendorEmails.length === 0) return toast.error('Add a vendor email before enabling automatic notifications.');
    if (!HOTELCARE_SENDER_PATTERN.test(cleanSender)) return toast.error('Use a sender address on a verified HotelCare domain.');
    if (cleanReplyTo && !EMAIL_PATTERN.test(cleanReplyTo)) return toast.error('Enter a valid reply-to email address.');
    if (brandName.trim().length > 100) return toast.error('Hotel email name must be 100 characters or fewer.');
    if (parkingInstructions.trim().length > 2000) return toast.error('Parking instructions must be 2,000 characters or fewer.');

    setBusy(true);
    try {
      const next = await saveParkingSettings({
        organizationSlug,
        hotelId,
        providerName: providerName.trim(),
        notificationEmails: vendorEmails,
        defaultValidityDays: days,
        vendorAutoEmail,
        guestEmailEnabled,
        senderEmail: cleanSender,
        replyTo: cleanReplyTo || null,
        brandName: brandName.trim(),
        parkingInstructions: parkingInstructions.trim(),
      });
      onSaved(next);
      toast.success('Parking settings saved.');
    } catch (error) {
      toast.error(parkingErrorMessage(error, 'Could not save parking settings.'));
    } finally {
      setBusy(false);
    }
  }

  async function changeAccess(user: ParkingAccessUser, accessLevel: GrantableParkingAccess) {
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-primary" />Parking setup</CardTitle>
            <p className="text-sm text-muted-foreground">Each hotel has independent inventory, issuing rules and communication settings.</p>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={save}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="parking-provider">Parking provider</Label>
                  <Input id="parking-provider" value={providerName} onChange={(event) => setProviderName(event.target.value)} maxLength={100} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="parking-validity-default">Default validity (days)</Label>
                  <Input id="parking-validity-default" type="number" min={1} max={90} value={validityDays} onChange={(event) => setValidityDays(event.target.value)} />
                  <p className="text-xs text-muted-foreground">Reception can still change dates for an individual guest.</p>
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">Automatic vendor email</p>
                    <p className="mt-1 text-xs text-muted-foreground">Send the parking operator a minimal ticket update when a ticket is issued, amended or voided. Guest name, room, reservation number and internal notes are not shared.</p>
                  </div>
                  <Switch checked={vendorAutoEmail} onCheckedChange={setVendorAutoEmail} aria-label="Automatic vendor email" />
                </div>
                <div className="mt-4 space-y-1.5">
                  <Label htmlFor="parking-emails">Vendor email address(es)</Label>
                  <Textarea id="parking-emails" value={emails} onChange={(event) => setEmails(event.target.value)} placeholder={'vendor@example.com\nparking.manager@example.com'} />
                  <p className="text-xs text-muted-foreground">Up to five addresses, one per line or separated by commas/semicolons. Stored independently for this hotel.</p>
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-2 font-medium"><Mail className="h-4 w-4 text-primary" />Guest parking voucher email</p>
                    <p className="mt-1 text-xs text-muted-foreground">When enabled, reception can enter a guest email while issuing the ticket. HotelCare queues a branded voucher email and retries temporary delivery failures.</p>
                  </div>
                  <Switch checked={guestEmailEnabled} onCheckedChange={setGuestEmailEnabled} aria-label="Guest parking voucher email" />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="parking-sender">Sender email</Label>
                    <Input id="parking-sender" type="email" value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)} placeholder={DEFAULT_SENDER} />
                    <p className="text-xs text-muted-foreground">Must use a verified <span className="font-medium">hotelcare.app</span> sender domain.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="parking-reply-to">Reply-to</Label>
                    <Input id="parking-reply-to" type="email" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="Hotel reception email (optional)" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="parking-brand-name">Hotel name shown in email</Label>
                    <Input id="parking-brand-name" value={brandName} onChange={(event) => setBrandName(event.target.value)} maxLength={100} placeholder="Leave blank to use the configured hotel name" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="parking-instructions">Guest parking instructions</Label>
                    <Textarea id="parking-instructions" value={parkingInstructions} onChange={(event) => setParkingInstructions(event.target.value)} maxLength={2000} placeholder="Where to park, what to show, entrance or exit instructions, reception contact details…" />
                    <p className="text-xs text-muted-foreground">The voucher clearly states that the physical ticket remains required unless the parking operator accepts digital vouchers.</p>
                  </div>
                </div>
              </div>

              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save settings
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><UserCog className="h-5 w-5 text-primary" />Eligible users</CardTitle>
          <p className="text-sm text-muted-foreground">Reception/front-office roles can issue and search automatically. Inventory, ticket batches and settings remain manager-only. Other hotel users can be granted issue/search access only.</p>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="flex min-h-32 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading users…</div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hotel users found.</p>
          ) : (
            <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1">
              {users.map((user) => {
                const includedByRole = user.role_access !== 'none';
                const grantedValue: GrantableParkingAccess = user.granted_access === 'issue' ? 'issue' : 'none';
                return (
                  <div key={user.user_id} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{user.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      <Badge variant="secondary" className="mt-1 text-[10px]">{user.role.replaceAll('_', ' ')}</Badge>
                    </div>
                    {includedByRole ? (
                      <Badge variant="outline" className="shrink-0">{user.role_access === 'manage' ? 'Manage' : 'Issue'} · role</Badge>
                    ) : (
                      <Select
                        value={grantedValue}
                        onValueChange={(value) => void changeAccess(user, value as GrantableParkingAccess)}
                        disabled={changingUser === user.user_id}
                      >
                        <SelectTrigger className="w-[118px] shrink-0"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No access</SelectItem>
                          <SelectItem value="issue">Issue</SelectItem>
                        </SelectContent>
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
