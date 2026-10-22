import { AlertTriangle, BedDouble, CheckCircle2, Clock3, CircleDashed, DoorClosed, DoorOpen, Info, MapPin, Play, Waves } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HoldButton } from '@/components/ui/hold-button';
import { isSlntRtcReady, slntTeamBDisplayGroup, type SlntTeamBCardRoom } from '@/lib/slntTeamBQueue';
import { slntTeamBRoomInstructions, type SlntRoomCardDetails } from '@/lib/slntTeamBRoomPresentation';

export type SlntTeamBPreviewItem = SlntTeamBCardRoom & SlntRoomCardDetails & {
  room_id: string;
  room_name: string | null;
  room_status: string | null;
  guest_count: number | null;
  is_checkout_room: boolean;
  towel_change_required: boolean;
  linen_change_required: boolean;
  is_optional: boolean;
  floor_number: number | null;
  guest_nights_stayed: number | null;
  assignment_id: string | null;
  assigned_to: string | null;
  assignment_status: string | null;
  supervisor_approved: boolean;
};

type Props = {
  item: SlntTeamBPreviewItem;
  date: string;
  hu: boolean;
  userId: string | undefined;
  busy: boolean;
  managerView: boolean;
  startedAt?: string | null;
  duration?: string | null;
  onStart: () => void;
  onOpen: () => void;
};

function localTime(iso: string, hu: boolean) {
  return new Intl.DateTimeFormat(hu ? 'hu-HU' : 'en-GB', {
    timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

/** SLNT-only unclaimed shared-pool room card. Reuses the full HotelCare
 * AssignedRoomCard AFTER claiming, while showing its actionable instructions
 * BEFORE the cleaner starts. The atomic claim RPC remains authoritative. */
export function SlntTeamBRoomPreview({
  item, date, hu, userId, busy, managerView, startedAt, duration, onStart, onOpen,
}: Props) {
  const checkout = item.is_checkout_room;
  const rtcReady = checkout && isSlntRtcReady(item, date);
  const waiting = checkout && !rtcReady;
  const category = slntTeamBDisplayGroup(item, date);
  const completed = item.assignment_status === 'completed';
  const mine = !!userId && item.assigned_to === userId;
  const claimed = !!item.assignment_id;
  const working = item.assignment_status === 'in_progress';
  // Muted styling applies ONLY to optional, unclaimed stayovers. Once started,
  // the room should look active again, and an actual due service is never muted.
  const optionalUnstarted = category === 'optional' && !claimed && !completed;
  const service = slntTeamBRoomInstructions(item);
  const meta = item.pms_metadata || {};
  const arrival = typeof meta.arrivalDate === 'string' ? meta.arrivalDate : null;
  const departure = typeof meta.departureDate === 'string' ? meta.departureDate : null;

  // Keep checkout and due-service colors strong. Optional stayovers are visually
  // quieter WITHOUT dimming or disabling the start action or critical notes.
  const accent = waiting
    ? 'border-l-4 border-l-orange-500 bg-orange-50/40 dark:bg-orange-950/20'
    : optionalUnstarted
      ? 'border-l-4 border-l-slate-300 bg-slate-50/80 shadow-none dark:border-l-slate-600 dark:bg-slate-900/30'
      : checkout
        ? 'border-l-4 border-l-sky-500'
        : 'border-l-4 border-l-emerald-500';
  const typeBadge = checkout
    ? 'border-orange-400 bg-orange-500 text-white'
    : optionalUnstarted
      ? 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
      : 'border-emerald-400 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100';

  const statusText = completed
    ? item.supervisor_approved ? (hu ? 'Jóváhagyva' : 'Approved') : (hu ? 'Jóváhagyásra vár' : 'Pending approval')
    : waiting ? (hu ? 'RTC-re vár' : 'Awaiting RTC')
    : claimed
      ? mine ? (working ? (hu ? 'Folyamatban' : 'In progress') : (hu ? 'Saját szobám' : 'My room'))
        : (hu ? 'Másik takarító' : 'Other cleaner')
      : (hu ? 'Elérhető' : 'Available');

  return (
    <Card data-training="slnt-team-b-room" data-room-state={waiting ? 'waiting-rtc' : category}
      data-optional-unstarted={optionalUnstarted ? 'true' : undefined}
      className={'overflow-hidden rounded-xl shadow-sm ' + accent}>
      <CardHeader className="space-y-3 pb-2">
        {waiting && (
          <div role="status" className="flex items-start gap-3 rounded-lg border border-orange-300 bg-orange-100 p-3 text-orange-900 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-100"
            data-training="slnt-team-b-locked-banner">
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-extrabold">{hu ? 'Várakozás a kijelentkezésre / RTC-re' : 'Waiting for guest checkout / RTC'}</p>
              <p className="mt-0.5 text-xs font-semibold">{hu ? 'A szoba nem kezdhető el, amíg a PMS nem igazolja a takarítható állapotot.' :
                'Cleaning cannot start until the PMS confirms ready-to-clean.'}</p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className={"break-words text-xl font-extrabold leading-tight tracking-tight sm:text-2xl " + (optionalUnstarted ? "text-slate-700 dark:text-slate-100" : "")}>
              {item.room_name || item.room_number}
            </CardTitle>
            {item.room_name && item.room_name !== item.room_number && (
              <p className={"mt-1 text-sm " + (optionalUnstarted ? "text-slate-500 dark:text-slate-400" : "text-muted-foreground")}>{item.room_number}</p>
            )}
          </div>
          <Badge variant={waiting || claimed ? 'secondary' : 'outline'}
            className={'max-w-[50%] shrink-0 whitespace-normal text-center text-xs ' +
              (waiting ? 'border-orange-400 bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100' :
                optionalUnstarted ? 'border-slate-300 bg-slate-100/80 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200' : '')}>
            {statusText}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={'gap-1 border px-3 py-1 font-bold ' + typeBadge}>
            {checkout ? <DoorOpen className="h-4 w-4" /> : <Waves className="h-4 w-4" />}
            {checkout ? (hu ? 'Kijelentkező szoba' : 'CHECKOUT CLEAN')
              : (hu ? 'Napi szoba' : 'DAILY / STAYOVER')}
          </Badge>
          {!checkout && (item.linen_change_required || item.towel_change_required) && (
            <Badge className="border border-violet-300 bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100">
              {item.linen_change_required ? (hu ? 'Ágyneműcsere' : 'Linen change') : (hu ? 'Törölközőcsere' : 'Towel change')}
            </Badge>
          )}
          {!checkout && category === 'optional' && (
            <Badge variant="outline" className={optionalUnstarted
              ? 'border-slate-300 bg-white/80 text-slate-600 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-200'
              : ''}>
              <CircleDashed className="mr-1 h-3 w-3" />
              {hu ? 'Opcionális · nem kötelező' : 'Optional · not required'}
            </Badge>
          )}
          {item.guest_nights_stayed != null && item.guest_nights_stayed > 0 && (
            <Badge variant="outline" className="bg-muted text-foreground">🌙 {hu ? 'Éj' : 'Night'} {item.guest_nights_stayed}</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 p-4 pt-2 sm:p-5 sm:pt-2">
        {optionalUnstarted && (
          <div data-training="slnt-team-b-optional-hint"
            className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-100/70 p-3 text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
            <CircleDashed aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-semibold">
                {hu ? 'Opcionális napi szoba – nem kötelező feladat' : 'Optional stayover — not a required task'}
              </p>
              <p className="mt-1 text-xs">
                {hu ? 'Nincs mára előírt törölköző- vagy ágyneműcsere. Csak szükség esetén kezdj takarítani.' :
                  'No towel or linen change is due today. Start cleaning only if needed.'}
              </p>
            </div>
          </div>
        )}
        {checkout && <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sky-950 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100" data-training="slnt-checkout-guest-count">
          <p className="text-sm font-extrabold">{hu ? 'Távozó vendégek' : 'Guests checking out'}: {item.guest_count != null ? item.guest_count : (hu ? 'Nem ismert' : 'Unknown')}</p>
          <p className="mt-1 text-xs">{hu ? 'Érkező vendégek száma: nincs megerősítve a jelenlegi PMS-adatokban.' : 'Incoming guest count: not confirmed in current PMS data.'}</p>
          {!service.bedInstruction && <p className="mt-1 text-xs">{hu ? 'Ágyelrendezés: nincs külön utasítás megadva.' : 'Bed configuration: no specific instruction recorded.'}</p>}
        </div>}

        {/* Mirrors the prominent RD hotel instruction boxes for actionable
            requirements; only real manager/PMS values are shown. */}
        {!checkout && item.linen_change_required && (
          <div className="rounded-lg border-2 border-purple-400 bg-purple-50 p-3 text-sm text-purple-950 dark:border-purple-700 dark:bg-purple-950/30 dark:text-purple-100">
            <p className="font-extrabold">🛏️ {hu ? 'ÁGYNEMŰCSERE SZÜKSÉGES' : 'BED LINEN CHANGE REQUIRED'}</p>
            <p className="mt-1">{hu ? 'Cseréld ki az ágyneműt a mai előírás szerint.' : 'Change bed linen as required today.'}</p>
          </div>
        )}
        {!checkout && item.towel_change_required && (
          <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-950 dark:border-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-100"
            data-training="slnt-team-b-towel-instruction">
            <p className="font-extrabold">🧺 {hu ? 'TÖRÖLKÖZŐCSERE SZÜKSÉGES' : 'TOWEL CHANGE REQUIRED'}</p>
            <p className="mt-1">{hu ? 'Cseréld ki a törölközőket a mai előírás szerint.' : 'Replace the guest towels as required today.'}</p>
          </div>
        )}
        {service.roomCleaning && !checkout && (
          <div className="rounded-lg border-2 border-blue-400 bg-blue-50 p-3 text-sm font-bold text-blue-900 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-100">
            🧹 {hu ? 'Teljes szobatakarítás szükséges' : 'Full room cleaning required'}
          </div>
        )}
        {service.collectExtraTowels && (
          <div className="rounded-lg border-2 border-orange-400 bg-orange-50 p-3 text-sm font-bold text-orange-900 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-100">
            🧺 {hu ? 'Extra törölközők begyűjtése' : 'Collect extra towels from guest room'}
          </div>
        )}
        {service.bedInstruction && (
          <div className="rounded-lg border-2 border-blue-400 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-100"
            data-training="slnt-team-b-bed-instruction">
            <p className="flex items-center gap-2 text-xs font-bold uppercase"><BedDouble className="h-4 w-4" />{hu ? 'Ágyelrendezés' : 'Bed configuration'}</p>
            <p className="mt-1 font-extrabold">{service.bedInstruction}</p>
          </div>
        )}
        {service.notes.map((note, index) => (
          <div key={index} className={'rounded-lg border-2 p-3 text-sm ' +
            (note.kind === 'previo' ? 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-100' :
              'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100')}
            data-training="slnt-team-b-note">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase">
              <Info className="h-3.5 w-3.5" />
              {note.kind === 'previo' ? (hu ? 'Previo takarítási megjegyzés' : 'Previo housekeeping note') :
                note.kind === 'planned' ? (hu ? 'Mai tervezett utasítás' : 'Planned room instruction') :
                (hu ? 'Vezetői utasítás' : 'Housekeeping instruction')}
              {note.label ? ' · ' + note.label.replace(/_/g, ' ') : ''}
            </p>
            <p className="mt-1 break-words font-semibold whitespace-pre-wrap">{note.text}</p>
          </div>
        ))}
        <div className={'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ' + (optionalUnstarted
          ? 'text-slate-500 dark:text-slate-400' : 'text-muted-foreground')}>
          <MapPin className="h-3.5 w-3.5" />
          {item.floor_number != null && <span>{hu ? 'Emelet' : 'Floor'} {item.floor_number} · </span>}
          <span>{item.room_number}</span>
          {item.guest_count != null && <span>· {item.guest_count} {hu ? 'vendég' : item.guest_count === 1 ? 'guest' : 'guests'}</span>}
          {item.room_status && (
            <Badge variant="outline" className="ml-auto text-xs">
              {item.room_status === 'dirty' ? (hu ? 'Takarítandó' : 'Dirty') : item.room_status}
            </Badge>
          )}
        </div>
        {(arrival || departure) && <p className={'text-xs ' + (optionalUnstarted
          ? 'text-slate-500 dark:text-slate-400' : 'text-muted-foreground')}>
          {arrival ? (hu ? 'Érkezés: ' : 'Arrival: ') + arrival : ''}
          {arrival && departure ? ' · ' : ''}
          {departure ? (hu ? 'Távozás: ' : 'Departure: ') + departure : ''}
        </p>}
        {startedAt && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            {hu ? 'Kezdés' : 'Started'} {localTime(startedAt, hu)}{duration ? ' · ' + duration : ''}
          </p>
        )}
        {waiting && !completed && (
          <div className="rounded-lg border-2 border-orange-300 bg-orange-100 px-3 py-4 text-center text-sm font-bold text-orange-900 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-100">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {hu ? 'Nem kezdhető el — kijelentkezés / RTC szükséges' : 'Cannot start — waiting for checkout / RTC'}
          </div>
        )}
        {completed && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
            <CheckCircle2 className="h-4 w-4" />{statusText}
          </p>
        )}
        {!managerView && !completed && !waiting && claimed && !mine && (
          <p className="rounded-lg bg-muted p-3 text-center text-sm font-semibold text-muted-foreground">
            {hu ? 'A szobát már egy másik csapattag takarítja.' : 'Another Team B cleaner is working on this room.'}
          </p>
        )}
        {!managerView && !completed && !waiting && mine && (
          <Button size="lg" className="h-14 w-full text-base font-bold" disabled={busy} onClick={onOpen}
            data-training="slnt-team-b-open-room">
            <Play className="mr-2 h-5 w-5" />{hu ? 'Saját szoba megnyitása' : 'Open my room'}
          </Button>
        )}
        {!managerView && !completed && !waiting && !claimed && (
          <div className="flex w-full flex-col pb-5" data-training="slnt-team-b-claim">
            {/* Do not fade this action: optional cleaning must remain easy to start. */}
            <HoldButton size="lg" holdDuration={2000} disabled={busy}
              className="min-h-14 w-full select-none text-base font-bold"
              holdText={hu ? 'Tartsd nyomva az indításhoz' : 'Press & Hold to Start'}
              releaseText={hu ? 'Tartsd még nyomva' : 'Keep holding'}
              onHoldComplete={onStart}>
              <Play className="mr-2 h-5 w-5" />
              {hu ? 'Takarítás indítása' : 'Start Cleaning'}
            </HoldButton>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
