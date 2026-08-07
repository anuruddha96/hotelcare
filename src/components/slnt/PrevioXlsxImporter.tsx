import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { deriveSuggestion, extractRoomNames, normalizeUnitName } from '@/lib/slntUnitMapping';

type Account = { id: string; label: string; pms_hotel_id: string };

type Props = {
  accounts: Account[];
  orgSlug: string;
  hotelId: string;
  onImported: () => void;
};

/**
 * SLNT-only: import a Previo housekeeping XLSX export into the draft mapping
 * staging table. Only the `Room` column is read — no guest data is stored —
 * and re-importing the same file is idempotent.
 */
export const PrevioXlsxImporter: React.FC<Props> = ({ accounts, orgSlug, hotelId, onImported }) => {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      toast.error('Select the Previo account this export belongs to');
      return;
    }
    setBusy(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const names = extractRoomNames(rows);

      if (!names.length) {
        toast.error('No accommodation rows found in this file');
        return;
      }

      const payload = names.map((name) => {
        const s = deriveSuggestion(name);
        return {
          organization_slug: orgSlug,
          hotel_id: hotelId,
          pms_account_id: account.id,
          pms_hotel_id: account.pms_hotel_id,
          source_name: name,
          normalized_name: normalizeUnitName(name),
          canonical_room_name: s.unit,
          suggested_venue_name: s.venue,
          status: 'suggested',
          confidence: s.confidence,
          source_kind: 'xlsx',
          source_file: file.name,
          source_date: new Date().toISOString().slice(0, 10),
        };
      });

      const { error } = await supabase
        .from('pms_unit_mappings')
        .upsert(payload, { onConflict: 'pms_account_id,normalized_name', ignoreDuplicates: true });

      if (error) throw error;
      toast.success(`${names.length} unit row(s) imported for ${account.label}`);
      setOpen(false);
      onImported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4 mr-1" /> Import Previo housekeeping export
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Previo housekeeping export</DialogTitle>
            <DialogDescription>
              Only the Room column is read. Rows named “Technikai” and blanks are skipped, and re-importing the
              same file will not duplicate anything.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Previo account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Which account is this export from?" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label} · {a.pms_hotel_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="slnt-xlsx">XLSX file</Label>
              <input
                id="slnt-xlsx"
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                disabled={!accountId || busy}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Close
            </Button>
            {busy && <Loader2 className="h-4 w-4 animate-spin self-center" />}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PrevioXlsxImporter;
