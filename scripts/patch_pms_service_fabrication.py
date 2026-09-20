"""Apply the focused PMS service fix without replacing unrelated sync logic.

Run once from the branch-scoped maintenance workflow. Every replacement is
asserted against the exact current source, so source drift fails closed.
"""
from pathlib import Path

source = Path('src/lib/pmsRefresh.ts')
text = source.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    hits = text.count(old)
    if hits != 1:
        raise SystemExit(f'Expected exactly 1 instance of {old[:85]!r}; found {hits}')
    text = text.replace(old, new, 1)


replace_once(
    '.select("id, hotel, room_number, status, guest_count, is_checkout_room, pms_metadata, bed_configuration, notes")',
    '.select("id, hotel, room_number, status, guest_count, is_checkout_room, pms_metadata, bed_configuration, notes, last_cleaned_at, towel_change_required, linen_change_required, last_towel_change, last_linen_change")',
)

replace_once(
    '''      const nightTotal = classification.nightTotal;
      let guestNightsStayed = 0;
      let towel = false;
      let linen = false;
      if (nightTotal) {
        guestNightsStayed = nightTotal.currentNight;
        if (guestNightsStayed >= 3) {
          const cyc = (guestNightsStayed - 3) % 4;
          if (cyc === 0) towel = true;
          else if (cyc === 2) linen = true;
        }
      }
''',
    '''      const nightTotal = classification.nightTotal;
      // Previo provides guest nights, NOT a universal towel/linen schedule.
      // Every property owns its rules; neither due flags nor service-completion
      // dates may be inferred from this shared PMS refresh.
      const guestNightsStayed = nightTotal?.currentNight ?? 0;
''',
)

replace_once(
    '''      if (reservationDataAuthoritative && (towel || linen)) {
        changeFields.push({
          field: "Linen/towel", before: "-", after: `${linen ? "linen" : ""}${towel && linen ? " + " : ""}${towel ? "towel" : ""}`, category: "linen",
        });
      }
''',
    '',
)

replace_once(
    '''        updateData.towel_change_required = towel && !effectiveCheckoutFlag;
        updateData.linen_change_required = linen;
''',
    '''        // Preserve explicit manager/service requirements across PMS syncs;
        // a new, unoccupied arrival never inherits the previous guest's work.
        const newGuest = classification.isNotArrived || classification.isCancelled || classification.isNoShow;
        updateData.towel_change_required = newGuest ? false : !!room.towel_change_required;
        updateData.linen_change_required = newGuest ? false : !!room.linen_change_required;
''',
)

replace_once(
    '''        if (towel) updateData.last_towel_change = today;
        if (linen) updateData.last_linen_change = today;
''',
    '',
)

source.write_text(text, encoding='utf-8')
print('Patched PMS sync: no global guessed cadence, no fictitious completion dates, preserve manually due work.')
