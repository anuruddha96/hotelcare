from pathlib import Path

path = Path("src/components/revenue/TodaysSalesAdrGoal.tsx")
text = path.read_text()


def rep(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    text = text.replace(old, new, 1)


rep(
    'import { convert, currencySymbol, toBaseCurrency, useRevenueCurrency } from "@/lib/revenueCurrency";\nimport { useIsMobile } from "@/hooks/use-mobile";',
    'import { convert, currencySymbol, toBaseCurrency, useRevenueCurrency } from "@/lib/revenueCurrency";\nimport { buildPeriodRevenueSalesGoals, periodTotalToDaily } from "@/lib/revenueSalesGoals";\nimport { useIsMobile } from "@/hooks/use-mobile";',
    "goal helper import",
)

rep(
    '''    const { error } = await (supabase.from("hotel_revenue_settings") as any).upsert({
      hotel_id: hotelId,
      target_adr: next.targetAdr,
      target_room_nights: next.targetRoomNights,
      target_booking_value: next.targetValue,
      promo_budget: next.promoBudget,
    } as any, { onConflict: "hotel_id" });

    if (error) {
      setGoalsError("Could not save the targets. Your previous shared targets are still active.");''',
    '''    // The settings row already exists for every revenue-enabled property. Using
    // UPDATE instead of UPSERT avoids the INSERT RLS path, which requires
    // organization_slug and was rejecting otherwise-valid manager saves.
    const { data: savedRow, error } = await (supabase.from("hotel_revenue_settings") as any)
      .update({
        target_adr: next.targetAdr,
        target_room_nights: next.targetRoomNights,
        target_booking_value: next.targetValue,
        promo_budget: next.promoBudget,
      } as any)
      .eq("hotel_id", hotelId)
      .select("hotel_id")
      .maybeSingle();

    if (error || !savedRow) {
      setGoalsError("Could not save the targets for this property. Your previous shared targets are still active.");''',
    "safe target save",
)

rep(
    '''  /** Only the live ones drive every KPI. */
  const liveBookings = useMemo(() => periodBookings.filter((b) => !b.cancelled), [periodBookings]);

  // Revenue goals are management inputs. Booking data must never infer, overwrite,
  // or persist ADR/room-night/value targets automatically.

  const kpi = useMemo(() => {''',
    '''  /** Only the live ones drive every KPI. */
  const liveBookings = useMemo(() => periodBookings.filter((b) => !b.cancelled), [periodBookings]);

  // Targets are stored as DAILY management baselines. The selected booking-created
  // range scales room-night, booking-value and optional promotion totals in real time;
  // ADR stays a rate and therefore never scales with the number of days.
  const periodGoals = useMemo(
    () => buildPeriodRevenueSalesGoals(goals, bookedFrom, bookedTo),
    [goals, bookedFrom, bookedTo],
  );
  const draftPeriodGoals = useMemo(
    () => buildPeriodRevenueSalesGoals(goalDraft, bookedFrom, bookedTo),
    [goalDraft, bookedFrom, bookedTo],
  );

  // Revenue goals are management inputs. Booking data must never infer, overwrite,
  // or persist ADR/room-night/value targets automatically.

  const kpi = useMemo(() => {''',
    "period goals memo",
)

rep(
    '      valueGoalPct: goals.targetValue ? (revenue / goals.targetValue) * 100 : 0,\n      nightsGoalPct: goals.targetRoomNights ? (roomNights / goals.targetRoomNights) * 100 : 0,',
    '      valueGoalPct: periodGoals.targetValue ? (revenue / periodGoals.targetValue) * 100 : 0,\n      nightsGoalPct: periodGoals.targetRoomNights ? (roomNights / periodGoals.targetRoomNights) * 100 : 0,',
    "period KPI denominators",
)
rep(
    '  }, [liveBookings, allBookings, bookedFrom, bookedTo, goals]);',
    '  }, [liveBookings, allBookings, bookedFrom, bookedTo, goals, periodGoals]);',
    "kpi dependencies",
)
rep(
    '      compare: cmp ? cmp[i].value : goals.targetValue ? Math.round((goals.targetValue * (m + 1)) / (24 * 60)) : null,',
    '      compare: cmp ? cmp[i].value : periodGoals.targetValue ? Math.round((periodGoals.targetValue * (m + 1)) / (24 * 60)) : null,',
    "chart target pace",
)
rep(
    '  }, [liveBookings, allBookings, compare, today, goals.targetValue, isTodayPeriod, nowMinutes]);',
    '  }, [liveBookings, allBookings, compare, today, periodGoals.targetValue, isTodayPeriod, nowMinutes]);',
    "chart dependencies",
)
rep(
    '  const compareLabel = compare === "yesterday" ? "Yesterday" : compare === "lastweek" ? "Same weekday last week" : "Daily goal pace";',
    '  const compareLabel = compare === "yesterday" ? "Yesterday" : compare === "lastweek" ? "Same weekday last week" : periodGoals.days === 1 ? "Daily goal pace" : `${periodGoals.days}-day goal pace`;',
    "period compare label",
)
rep(
    '    if (!goals.targetAdr || kpi.adr === null || kpi.adr >= goals.targetAdr) return null;',
    '    if (!isTodayPeriod || !goals.targetAdr || kpi.adr === null || kpi.adr >= goals.targetAdr) return null;',
    "historical ADR recovery guard",
)
rep(
    '  }, [kpi, goals.targetAdr, futureNights]);',
    '  }, [kpi, goals.targetAdr, futureNights, isTodayPeriod]);',
    "recovery dependencies",
)
rep(
    '            Today’s Sales &amp; ADR Goal',
    '            {preset === "today" ? "Today’s Sales & ADR Goal" : "Sales & ADR Goal"}',
    "period-aware title",
)
rep(
    '''            <strong className="text-foreground">What this panel shows:</strong> everything your team
            <strong> sold today</strong> — reservations filtered by the date the{" "}
            <strong>booking was created</strong> (Budapest time), whatever date the guest arrives
            {stayFilterOn ? ", unless you narrow the guest stay dates above" : ""}. It answers
            "what did we sell today, at what rate, and how far is that from the target?".''',
    '''            <strong className="text-foreground">What this panel shows:</strong> everything your team
            sold in the <strong>selected booking-created period</strong> (Budapest time), whatever date the guest arrives
            {stayFilterOn ? ", unless you narrow the guest stay dates above" : ""}. It answers
            "what did we sell in this period, at what rate, and how far is that from the matching period target?".''',
    "period explanation",
)
rep(
    '<span className="flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Goals · ADR {eur(goals.targetAdr)}</span>',
    '<span className="flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Goals · ADR {goals.targetAdr ? eur(goals.targetAdr) : "—"} · {periodGoals.days}-day target</span>',
    "goals summary",
)
rep(
    '''            <GoalInput
              label="Room-night target"
              value={goalDraft.targetRoomNights}
              disabled={goalsLoading || goalsSaving}
              onChange={(v) => updateGoalDraft({ targetRoomNights: v })}
            />''',
    '''            <GoalInput
              label={`Room-night target · selected ${draftPeriodGoals.days}-day period`}
              value={Math.round(draftPeriodGoals.targetRoomNights * 100) / 100}
              disabled={goalsLoading || goalsSaving}
              onChange={(v) => updateGoalDraft({ targetRoomNights: periodTotalToDaily(v, draftPeriodGoals.days) })}
            />''',
    "room-night period input",
)
rep(
    '''            <GoalInput
              label={`Booking value target (${currencySymbol(revenueCurrency.displayCode)})`}
              value={goalDisplayValue(goalDraft.targetValue)}
              disabled={goalsLoading || goalsSaving}
              onChange={(v) => {
                const base = toBaseCurrency(v);
                if (base !== null) updateGoalDraft({ targetValue: base });
              }}
            />''',
    '''            <GoalInput
              label={`Booking value target · selected ${draftPeriodGoals.days}-day period (${currencySymbol(revenueCurrency.displayCode)})`}
              value={goalDisplayValue(draftPeriodGoals.targetValue)}
              disabled={goalsLoading || goalsSaving}
              onChange={(v) => {
                const basePeriodTotal = toBaseCurrency(v);
                if (basePeriodTotal !== null) updateGoalDraft({
                  targetValue: periodTotalToDaily(basePeriodTotal, draftPeriodGoals.days),
                });
              }}
            />''',
    "booking value period input",
)
rep(
    '''            <GoalInput
              label={`Max promotion budget (${currencySymbol(revenueCurrency.displayCode)})`}
              value={goalDisplayValue(goalDraft.promoBudget)}
              disabled={goalsLoading || goalsSaving}
              onChange={(v) => {
                const base = toBaseCurrency(v);
                if (base !== null) updateGoalDraft({ promoBudget: base });
              }}
            />''',
    '''            <GoalInput
              label={`Max promotion budget · optional · selected ${draftPeriodGoals.days}-day period (${currencySymbol(revenueCurrency.displayCode)})`}
              value={draftPeriodGoals.promoBudget === null ? "" : goalDisplayValue(draftPeriodGoals.promoBudget)}
              optional
              disabled={goalsLoading || goalsSaving}
              onChange={(v) => {
                const basePeriodTotal = toBaseCurrency(v);
                if (basePeriodTotal !== null) updateGoalDraft({
                  promoBudget: periodTotalToDaily(basePeriodTotal, draftPeriodGoals.days),
                });
              }}
            />''',
    "optional promo period input",
)
rep(
    '''              <p className="text-[11px] text-muted-foreground">
                Shared property targets · shown in {currencySymbol(revenueCurrency.displayCode)}
                {revenueCurrency.displayCode !== revenueCurrency.code
                  ? ` · stored in ${currencySymbol(revenueCurrency.code)}`
                  : ""}. Changes apply only after Save.
              </p>''',
    '''              <p className="text-[11px] text-muted-foreground">
                Shared daily baselines are scaled live to the selected {draftPeriodGoals.days}-day period · ADR stays unchanged.
                {draftPeriodGoals.targetValueIsDerived
                  ? " Booking value is automatic: ADR × room-night target."
                  : " Booking value uses the management override."}
                {" "}Shown in {currencySymbol(revenueCurrency.displayCode)}
                {revenueCurrency.displayCode !== revenueCurrency.code
                  ? ` · stored in ${currencySymbol(revenueCurrency.code)}`
                  : ""}. Changes apply only after Save.
              </p>''',
    "goal explanation",
)
rep(
    '''              <Kpi
                label="Revenue goal"
                value={goals.targetValue ? pct(kpi.valueGoalPct) : "—"}
                sub={goals.targetValue ? `of ${eur(goals.targetValue)}` : "Set a booking-value target in Goals"}
                info="Booking value as a share of the booking-value target set in Goals."
              />''',
    '''              <Kpi
                label="Revenue goal"
                value={periodGoals.targetValue ? pct(kpi.valueGoalPct) : "—"}
                sub={periodGoals.targetValue ? `of ${eur(periodGoals.targetValue)} · ${periodGoals.days}-day target` : "Set ADR and room-night targets in Goals"}
                info="Booking value as a share of the target for the selected booking-created period. Multi-day targets scale automatically from the shared daily baseline."
              />
              <Kpi
                label="Room-night goal"
                value={periodGoals.targetRoomNights ? pct(kpi.nightsGoalPct) : "—"}
                sub={periodGoals.targetRoomNights ? `${kpi.roomNights} of ${Math.round(periodGoals.targetRoomNights * 10) / 10} · ${periodGoals.days}-day target` : "Set a room-night target in Goals"}
                info="Room nights sold as a share of the target for the selected booking-created period. The daily room-night baseline is multiplied by the number of selected days."
              />''',
    "period KPI cards",
)
rep(
    '''                {goals.targetValue || goals.targetRoomNights
                  ? ` End-of-day goal: ${goals.targetValue ? eur(goals.targetValue) : "—"} value · ${goals.targetRoomNights || "—"} room nights.`
                  : " End-of-day goals are not set yet."}''',
    '''                {periodGoals.targetValue || periodGoals.targetRoomNights
                  ? ` Selected-period goal (${periodGoals.days} day${periodGoals.days === 1 ? "" : "s"}): ${periodGoals.targetValue ? eur(periodGoals.targetValue) : "—"} value · ${periodGoals.targetRoomNights ? Math.round(periodGoals.targetRoomNights * 10) / 10 : "—"} room nights.`
                  : " Goals are not set yet."}''',
    "period chart goal copy",
)
rep(
    '''function GoalInput({ label, value, onChange, disabled = false }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input type="number" inputMode="decimal" min={0} step="any" className="h-9" value={value} disabled={disabled}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
    </div>
  );
}''',
    '''function GoalInput({ label, value, onChange, disabled = false, optional = false }: {
  label: string;
  value: number | "";
  onChange: (v: number) => void;
  disabled?: boolean;
  optional?: boolean;
}) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        className="h-9"
        value={value}
        placeholder={optional ? "Optional" : undefined}
        disabled={disabled}
        onChange={(e) => {
          if (optional && e.target.value === "") { onChange(0); return; }
          onChange(Math.max(0, Number(e.target.value) || 0));
        }}
      />
    </div>
  );
}''',
    "optional goal input",
)

# Empty-state copy should respect historical/custom selections.
rep(
    '    if (!kpi.bookings) return "No bookings have been created today yet.";',
    '    if (!kpi.bookings) return preset === "today" ? "No bookings have been created today yet." : "No bookings were created in the selected period.";',
    "headline empty state",
)
rep(
    '<p className="text-sm text-muted-foreground">No bookings have been created today yet.</p>',
    '<p className="text-sm text-muted-foreground">{preset === "today" ? "No bookings have been created today yet." : "No bookings were created in the selected period."}</p>',
    "list empty state",
)

path.write_text(text)
