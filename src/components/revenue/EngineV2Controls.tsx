import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface EngineV2WindowRule {
  id: string;
  min_days_out: number;
  max_days_out: number | null;
  max_daily_decrease: number;
  max_daily_increase: number;
  no_pickup_wait_hours: number | null;
  require_above_anchor: boolean;
  min_hours_between_decreases: number;
}

export interface EngineV2ConfigPatch {
  future_booking_window_days: number;
  min_movement_eur: number;
  direction_change_hours: number;
  manual_hold_hours: number;
  date_column_lockstep_enabled: boolean;
  adr_guard_enabled: boolean;
  adr_target_eur: number;
  adr_window_days: number;
  window_rules: EngineV2WindowRule[];
}

interface Props extends EngineV2ConfigPatch {
  currency: string;
  engineVersion: number;
  mode: string | null;
  onChange: (patch: Partial<EngineV2ConfigPatch>) => void;
}

function NumberField({
  label,
  value,
  suffix,
  min = 0,
  max,
  step = 1,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={value ?? ""}
          className={suffix ? "pr-12" : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function rangeLabel(rule: EngineV2WindowRule) {
  return rule.max_days_out === null
    ? `D+${rule.min_days_out}+`
    : rule.min_days_out === rule.max_days_out
      ? `D+${rule.min_days_out}`
      : `D+${rule.min_days_out}–D+${rule.max_days_out}`;
}

export default function EngineV2Controls({
  currency,
  engineVersion,
  mode,
  future_booking_window_days,
  min_movement_eur,
  direction_change_hours,
  manual_hold_hours,
  date_column_lockstep_enabled,
  adr_guard_enabled,
  adr_target_eur,
  adr_window_days,
  window_rules,
  onChange,
}: Props) {
  const updateWindow = (index: number, patch: Partial<EngineV2WindowRule>) => {
    onChange({
      window_rules: window_rules.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row),
    });
  };

  return (
    <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Engine V2 — active pricing controls</p>
            <p className="text-[11px] text-muted-foreground">
              These are the saved values the pricing engine reads for this hotel. Changing them here changes the engine; there is no separate hidden preset once window rules are saved.
            </p>
          </div>
          <span className="rounded-full border bg-background px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            V{engineVersion} · {mode ?? "live"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumberField
          label="Pricing horizon"
          value={future_booking_window_days}
          suffix="days"
          min={1}
          max={730}
          onChange={(value) => value !== null && onChange({ future_booking_window_days: value })}
        />
        <NumberField
          label="Minimum automatic move"
          value={min_movement_eur}
          suffix={currency}
          min={0}
          max={100}
          step={1}
          onChange={(value) => value !== null && onChange({ min_movement_eur: value })}
        />
        <NumberField
          label="Direction-change cooldown"
          value={direction_change_hours}
          suffix="h"
          min={0}
          max={72}
          onChange={(value) => value !== null && onChange({ direction_change_hours: value })}
        />
        <NumberField
          label="Engine manual-edit hold"
          value={manual_hold_hours}
          suffix="h"
          min={0}
          max={168}
          onChange={(value) => value !== null && onChange({ manual_hold_hours: value })}
        />
      </div>

      <div className="flex items-start justify-between gap-3 rounded-lg border bg-background/70 p-3">
        <div>
          <Label className="text-xs font-semibold">Move the whole date column together</Label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Every room type and guest level on this stay date moves by the same € amount. A room-type floor or ceiling does not freeze the date; only the hotel's absolute safety boundary can stop the column.
          </p>
        </div>
        <Switch
          checked={date_column_lockstep_enabled}
          onCheckedChange={(checked) => onChange({ date_column_lockstep_enabled: checked })}
        />
      </div>

      <div className="space-y-3 rounded-lg border bg-background/70 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label className="text-xs font-semibold">Rolling ADR guard</Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Protect the blended rate target while still allowing tactical markdowns to fill rooms.
            </p>
          </div>
          <Switch
            checked={adr_guard_enabled}
            onCheckedChange={(checked) => onChange({ adr_guard_enabled: checked })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="ADR target"
            value={adr_target_eur}
            suffix={currency}
            min={0}
            max={1000}
            disabled={!adr_guard_enabled}
            onChange={(value) => value !== null && onChange({ adr_target_eur: value })}
          />
          <NumberField
            label="ADR guard window"
            value={adr_window_days}
            suffix="days"
            min={1}
            max={90}
            disabled={!adr_guard_enabled}
            onChange={(value) => value !== null && onChange({ adr_window_days: value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-xs font-semibold">Booking-window movement rules</p>
          <p className="text-[11px] text-muted-foreground">
            Each row is stored in <code>window_rules</code> and consumed directly by Engine V2. The daily limits and waiting times below are the actual active controls.
          </p>
        </div>

        {window_rules.length === 0 ? (
          <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            No explicit window rules are saved. Engine V2 may use its fallback preset until this hotel has saved window rules.
          </div>
        ) : (
          <div className="space-y-2">
            {window_rules.map((window, index) => (
              <div key={`${window.id}-${window.min_days_out}-${index}`} className="space-y-3 rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold">{rangeLabel(window)}</p>
                  <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Switch
                      checked={window.require_above_anchor}
                      onCheckedChange={(checked) => updateWindow(index, { require_above_anchor: checked })}
                    />
                    Require price above anchor before lowering
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <NumberField
                    label="Max decrease/day"
                    value={window.max_daily_decrease}
                    suffix={currency}
                    min={0}
                    max={200}
                    onChange={(value) => value !== null && updateWindow(index, { max_daily_decrease: value })}
                  />
                  <NumberField
                    label="Max increase/day"
                    value={window.max_daily_increase}
                    suffix={currency}
                    min={0}
                    max={200}
                    onChange={(value) => value !== null && updateWindow(index, { max_daily_increase: value })}
                  />
                  <NumberField
                    label="No-pickup wait"
                    value={window.no_pickup_wait_hours}
                    suffix="h"
                    min={0}
                    max={336}
                    onChange={(value) => updateWindow(index, { no_pickup_wait_hours: value })}
                  />
                  <NumberField
                    label="Between markdowns"
                    value={window.min_hours_between_decreases}
                    suffix="h"
                    min={0}
                    max={336}
                    onChange={(value) => value !== null && updateWindow(index, { min_hours_between_decreases: value })}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Existing V2 close-in policy:</strong> D+1–D+7 prioritises selling remaining rooms and does not automatically increase an unsold date. Same-day D+0 is handled by the separate same-day sell-out automation. These are existing engine behaviours; the configurable budgets, waits, ADR protection and cadence are shown above and elsewhere in this Automation panel.
      </div>
    </div>
  );
}
