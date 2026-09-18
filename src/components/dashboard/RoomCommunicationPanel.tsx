import { useCallback, useEffect, useState } from 'react';
import { BedDouble, Loader2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface RoomCommunicationPanelProps {
  assignmentId: string;
  roomId: string;
  roomNumber: string;
  dateLabel?: string;
  readOnly?: boolean;
  hideWhenEmpty?: boolean;
}

// Keep the existing persisted values so older clients and housekeeper cards
// continue to receive the same instructions. Codes are presentation only.
const BED_SETUP_OPTIONS = [
  { value: 'Single Bed', label: 'Single beds', code: 'SB', icon: '🛏️' },
  { value: 'Twin Beds Together', label: 'Beds together', code: 'BT', icon: '🛌' },
  { value: 'Sofa Bed', label: 'Sofa bed', code: null, icon: '🛋️' },
  { value: 'Extra Bed', label: 'Extra bed', code: null, icon: '➕' },
  { value: 'Baby Bed', label: 'Baby bed', code: null, icon: '👶' },
  { value: 'Remove Baby Bed', label: 'Remove baby bed', code: null, icon: '🚫' },
] as const;

type BedSetupOption = (typeof BED_SETUP_OPTIONS)[number];

function isEquivalentBedSetup(current: string | null, option: string): boolean {
  if (!current) return false;
  const normalized = current.trim().toLowerCase();

  // The retired "Beds separated" control and old singular/plural values all
  // select the one SB control. Never silently erase existing instructions.
  if (option === 'Single Bed') {
    return [
      'single bed', 'single beds', 'twin beds separated',
      'beds separated', 'separate beds', 'separated beds',
    ].includes(normalized);
  }

  if (option === 'Twin Beds Together') {
    return ['twin beds together', 'twin beds', 'beds together'].includes(normalized);
  }

  if (option === 'Remove Baby Bed') {
    return ['remove baby bed', 'baby bed out', 'out baby bed'].includes(normalized);
  }

  return normalized === option.toLowerCase();
}

function instructionLabel(value: string): string {
  const option = BED_SETUP_OPTIONS.find((item) => isEquivalentBedSetup(value, item.value));
  if (!option) return value;
  return option.code ? `${option.code} · ${option.label}` : option.label;
}

/** Shared room setup component: no hotel or organization-specific feature gate. */
export function RoomCommunicationPanel({
  roomId,
  roomNumber,
  readOnly = false,
}: RoomCommunicationPanelProps) {
  const [bedConfiguration, setBedConfiguration] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingValue, setSavingValue] = useState<string | null>(null);

  const loadBedConfiguration = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('bed_configuration')
        .eq('id', roomId)
        .maybeSingle();

      if (error) throw error;
      setBedConfiguration(data?.bed_configuration || null);
    } catch (error) {
      console.error('Failed to load bed setup instruction:', error);
      toast.error(`Could not load bed instructions for room ${roomNumber}`);
    } finally {
      setLoading(false);
    }
  }, [roomId, roomNumber]);

  useEffect(() => {
    setBedConfiguration(null);
    void loadBedConfiguration();
  }, [loadBedConfiguration]);

  const saveBedConfiguration = async (nextValue: string | null) => {
    if (readOnly || savingValue !== null || loading) return;

    const savingKey = nextValue ?? '__clear__';
    setSavingValue(savingKey);
    try {
      const { data, error } = await supabase
        .from('rooms')
        .update({ bed_configuration: nextValue })
        .eq('id', roomId)
        .select('id, bed_configuration')
        .maybeSingle();

      if (error) throw error;
      if (!data?.id || (data.bed_configuration || null) !== nextValue) {
        throw new Error('Bed setup instruction was not applied. Please refresh and verify your hotel access.');
      }

      setBedConfiguration(data.bed_configuration || null);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));

      if (nextValue) {
        toast.success(`Room ${roomNumber}: ${instructionLabel(nextValue)} instruction sent to housekeeping`);
      } else {
        toast.success(`Room ${roomNumber}: bed setup instruction cleared`);
      }
    } catch (error: any) {
      console.error('Failed to save bed setup instruction:', error);
      toast.error(error?.message || 'Failed to save bed setup instruction');
      void loadBedConfiguration();
    } finally {
      setSavingValue(null);
    }
  };

  const selectOption = (option: BedSetupOption) => {
    // Pressing the selected option a second time deselects it, just like Clear.
    const active = isEquivalentBedSetup(bedConfiguration, option.value);
    void saveBedConfiguration(active ? null : option.value);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <BedDouble className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span className="text-[11px] font-semibold text-foreground">Housekeeper bed setup</span>
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Tap a setup to send it to housekeeping. Tap the selected setup again to remove it.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {BED_SETUP_OPTIONS.map((option) => {
          const active = isEquivalentBedSetup(bedConfiguration, option.value);
          const saving = savingValue === option.value;

          return (
            <button
              key={option.value}
              type="button"
              disabled={readOnly || savingValue !== null || loading}
              onClick={(event) => {
                event.stopPropagation();
                selectOption(option);
              }}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'border-blue-500 bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              }`}
              aria-pressed={active}
              aria-label={`${option.label}${option.code ? ` (${option.code})` : ''}${active ? ', selected; tap to remove' : ''}`}
            >
              <span aria-hidden="true">{option.icon}</span>
              <span>{option.label}</span>
              {option.code && <span className="rounded bg-current/10 px-1 font-bold">{option.code}</span>}
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            </button>
          );
        })}

        {bedConfiguration && (
          <button
            type="button"
            disabled={readOnly || savingValue !== null || loading}
            onClick={(event) => {
              event.stopPropagation();
              void saveBedConfiguration(null);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-rose-500 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-800 shadow-sm transition-colors hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 dark:bg-rose-950/50 dark:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Clear bed setup instruction"
          >
            {savingValue === '__clear__' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Clear setup
          </button>
        )}
      </div>

      {bedConfiguration && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
          Current instruction: <span className="font-semibold">{instructionLabel(bedConfiguration)}</span>
        </div>
      )}

      {readOnly && (
        <p className="text-[10px] italic text-muted-foreground">Past dates are read-only.</p>
      )}
    </div>
  );
}
