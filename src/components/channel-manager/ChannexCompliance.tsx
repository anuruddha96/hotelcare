import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GATE_LABEL, NTAK_OPTIONS, type ChannexStatus, type NtakPath, type ProductionGate } from '@/integrations/channex/api';
import type { RunAction } from './ChannexPanel';

type Props = { status: ChannexStatus; run: RunAction; busy: string | null };

const CHECKS: { key: 'viza_document_scan_confirmed' | 'tax_settings_confirmed' | 'dpa_signed' | 'single_publisher_confirmed'; label: string; help: string }[] = [
  {
    key: 'viza_document_scan_confirmed',
    label: 'VIZA guest registration happens at check-in',
    help: 'OTA bookings carry name and contact only. Guest ID data is captured with the document reader at check-in and sent to VIZA through the NTAK-registered software, never taken from the OTA.',
  },
  {
    key: 'tax_settings_confirmed',
    label: 'Invoicing handles VAT, IFA and TFH',
    help: '5% VAT on accommodation, the local tourist tax (idegenforgalmi adó, set by the municipality) and the tourism development contribution (TFH) are calculated by HotelCare invoicing. OTA tax lines are stored for reference only. Rates change: check with the accountant.',
  },
  {
    key: 'dpa_signed',
    label: 'Data processing agreement with Channex signed (GDPR Art. 28)',
    help: 'Channex processes guest personal data for the hotel. HotelCare stores no card data and removes guest data from raw OTA payloads 90 days after departure.',
  },
  {
    key: 'single_publisher_confirmed',
    label: 'Only one system publishes to the OTAs',
    help: 'Disconnect the OTA channels from Previo/YieldPlanet before going live here, so two systems never overwrite each other’s rates and availability.',
  },
];

export function ChannexCompliance({ status, run, busy }: Props) {
  const conn = status.connection!;
  const gate = status.gate as ProductionGate;
  const canEdit = status.permissions.owner;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Production live is blocked by the database until every item below is complete. Staging can go live only on a hotel marked as a sandbox.
      </p>

      <div className="space-y-1">
        <Label htmlFor="cx-ntak">NTAK reporting</Label>
        <Select value={conn.ntak_reporting_path} onValueChange={(v) => void run('set_compliance', { ntak_reporting_path: v as NtakPath }, 'NTAK reporting path saved')} disabled={!canEdit || busy !== null}>
          <SelectTrigger id="cx-ntak" className="max-w-xl"><SelectValue /></SelectTrigger>
          <SelectContent>{NTAK_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground max-w-xl">
          Every Hungarian accommodation must report through its NTAK-registered accommodation software. OTA bookings received here must reach that software so occupancy and tourist-tax data stay complete. Note: HotelCare does not yet create Channex bookings in Previo automatically, so choose the Previo option only once that is in place.
        </p>
      </div>

      <div className="space-y-3">
        {CHECKS.map((c) => (
          <label key={c.key} className="flex items-start gap-3 cursor-pointer">
            <Checkbox className="mt-0.5" checked={conn[c.key]} disabled={!canEdit || busy !== null}
              onCheckedChange={(v) => void run('set_compliance', { [c.key]: v === true }, 'Compliance checklist updated')} />
            <span>
              <span className="text-sm font-medium">{c.label}</span>
              <span className="block text-xs text-muted-foreground max-w-xl">{c.help}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="rounded-lg border p-3 space-y-1.5">
        <p className="text-sm font-semibold">Production go-live gate</p>
        {(Object.keys(GATE_LABEL) as (keyof ProductionGate)[]).map((k) => (
          <p key={k} className="text-xs flex items-center gap-2">
            {gate[k] ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label="done" /> : <XCircle className="h-3.5 w-3.5 text-muted-foreground" aria-label="missing" />}
            {GATE_LABEL[k]}
          </p>
        ))}
        <div className="flex flex-wrap gap-2 pt-2">
          {status.permissions.super_admin && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('record_certification', { certified: !conn.certified_at }, conn.certified_at ? 'Certification removed' : 'Certification recorded')}>
              {conn.certified_at ? 'Remove certification' : 'Record Channex certification'}
            </Button>
          )}
          {status.permissions.owner && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('owner_approval', { approve: !conn.owner_approved_at }, conn.owner_approved_at ? 'Approval withdrawn' : 'Owner approval recorded')}>
              {conn.owner_approved_at ? 'Withdraw owner approval' : 'Record owner approval'}
            </Button>
          )}
        </div>
      </div>
      {!canEdit && <p className="text-xs text-muted-foreground">Only admins and top management can change the compliance checklist.</p>}
    </div>
  );
}
