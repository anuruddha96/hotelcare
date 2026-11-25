import { normalizeHousekeepingAutomationLanguage, type HousekeepingAutomationLanguage } from './housekeepingAutomationTranslations';

export type NextDayAutoAssignUiKey =
  | 'tomorrowRelease'
  | 'live'
  | 'laundryDuty'
  | 'noneSelected'
  | 'laundryZeroWork'
  | 'unsoldNow'
  | 'cleaningTimeNote'
  | 'scheduledCleanersHint'
  | 'scheduled'
  | 'roomsSummary'
  | 'mappedAreas'
  | 'regenerationGoal'
  | 'rebalance'
  | 'locality'
  | 'checkoutsGoal'
  | 'alternative'
  | 'lockedRooms'
  | 'oneRoomHint'
  | 'severalRoomsHint'
  | 'previewNotSaved'
  | 'assignHere'
  | 'selectAll'
  | 'deselectAll'
  | 'publicAreas'
  | 'dropHere'
  | 'roomSelected'
  | 'tapAnotherStaff'
  | 'removeAssignment'
  | 'maintenanceHold'
  | 'shareCleaning'
  | 'notShared'
  | 'cancel'
  | 'reviewChanges'
  | 'continuePublicAreas'
  | 'reviewPublicAreas'
  | 'approvePlan'
  | 'autoRelease'
  | 'autoReleaseHint'
  | 'preparing'
  | 'secureConnection'
  | 'readPms'
  | 'verifyTomorrow'
  | 'close'
  | 'retry'
  | 'elapsed'
  | 'safetyLock'
  | 'technicalDetail'
  | 'checkingSnapshot'
  | 'checkingSnapshotDetail'
  | 'connecting'
  | 'refreshingRooms'
  | 'downloading'
  | 'validating'
  | 'slowSync';

const en: Record<NextDayAutoAssignUiKey, string> = {
  tomorrowRelease: 'Tomorrow · 08:00 release', live: 'Live', laundryDuty: 'Laundry duty', noneSelected: 'None selected',
  laundryZeroWork: 'Laundry staff receive no cleaning rooms or public areas.', unsoldNow: 'Unsold now',
  cleaningTimeNote: 'Cleaning time uses each room’s configured size and verified beds.',
  scheduledCleanersHint: 'Scheduled cleaners are selected automatically. Untick only staff doing another duty.',
  scheduled: 'Scheduled', roomsSummary: 'rooms', mappedAreas: 'mapped areas', regenerationGoal: 'Rebalance plan',
  rebalance: 'Balance workload', locality: 'Keep rooms close', checkoutsGoal: 'Balance check-outs', alternative: 'Try another arrangement',
  lockedRooms: 'manually fixed room(s)', oneRoomHint: 'Move one room: tap or drag it to another cleaner.',
  severalRoomsHint: 'Move several: select the circles, choose a cleaner, then Done.', previewNotSaved: 'Changes save only after confirmation.',
  assignHere: 'Assign here', selectAll: 'Select all', deselectAll: 'Deselect all', publicAreas: 'Public areas',
  dropHere: 'Drop a room or area here', roomSelected: 'Room selected', tapAnotherStaff: 'Tap another cleaner to move it.',
  removeAssignment: 'Remove', maintenanceHold: 'Maintenance hold', shareCleaning: 'Share cleaning', notShared: 'Not shared',
  cancel: 'Cancel', reviewChanges: 'Review changes', continuePublicAreas: 'Continue to public areas',
  reviewPublicAreas: 'Review public areas', approvePlan: 'Approve tomorrow’s plan',
  autoRelease: 'Release approved assignments automatically at 08:00',
  autoReleaseHint: 'If turned off, the approved plan stays on hold until a manager releases it.',
  preparing: 'Preparing tomorrow’s housekeeping', secureConnection: 'Secure connection', readPms: 'Read PMS data',
  verifyTomorrow: 'Verify tomorrow', close: 'Close', retry: 'Retry fresh sync', elapsed: 'elapsed',
  safetyLock: 'Safety lock is active: today’s room classification is not reused and no tomorrow plan is saved until verification succeeds.',
  technicalDetail: 'Technical detail', checkingSnapshot: 'Checking latest PMS data',
  checkingSnapshotDetail: 'Looking for a recent verified snapshot for tomorrow.',
  connecting: 'Preparing secure PMS connection', refreshingRooms: 'Refreshing live room status',
  downloading: 'Downloading tomorrow’s reservations', validating: 'Validating tomorrow’s room data',
  slowSync: 'The PMS sync is taking longer than expected. HotelCare is still working; nothing is assigned while verification runs.',
};

const hu: Record<NextDayAutoAssignUiKey, string> = {
  tomorrowRelease: 'Holnap · kiadás 08:00-kor', live: 'Élő', laundryDuty: 'Mosodai feladat', noneSelected: 'Nincs kiválasztva',
  laundryZeroWork: 'A mosodai munkatársak nem kapnak szobát vagy közös területet.', unsoldNow: 'Jelenleg eladatlan',
  cleaningTimeNote: 'A takarítási idő a szoba beállított mérete és ellenőrzött ágyszáma alapján számolódik.',
  scheduledCleanersHint: 'A holnapra beosztott takarítók automatikusan ki vannak választva. Csak azt vedd ki, aki más feladatot végez.',
  scheduled: 'Beosztva', roomsSummary: 'szoba', mappedAreas: 'közös terület', regenerationGoal: 'Terv újraosztása',
  rebalance: 'Terhelés kiegyenlítése', locality: 'Közeli szobák együtt', checkoutsGoal: 'Kijelentkezések kiegyenlítése', alternative: 'Másik elosztás',
  lockedRooms: 'kézzel rögzített szoba', oneRoomHint: 'Egy szoba: érintsd meg vagy húzd át egy másik takarítóhoz.',
  severalRoomsHint: 'Több szoba: jelöld ki a körökkel, válassz takarítót, majd Kész.', previewNotSaved: 'A módosítások csak a megerősítés után mentődnek.',
  assignHere: 'Ide osztás', selectAll: 'Összes kijelölése', deselectAll: 'Kijelölés törlése', publicAreas: 'Közös területek',
  dropHere: 'Húzz ide szobát vagy területet', roomSelected: 'Szoba kijelölve', tapAnotherStaff: 'Érints meg egy másik takarítót az áthelyezéshez.',
  removeAssignment: 'Levétel', maintenanceHold: 'Karbantartási zárolás', shareCleaning: 'Közös takarítás', notShared: 'Nincs megosztva',
  cancel: 'Mégse', reviewChanges: 'Módosítások áttekintése', continuePublicAreas: 'Tovább a közös területekhez',
  reviewPublicAreas: 'Közös területek áttekintése', approvePlan: 'Holnapi terv jóváhagyása',
  autoRelease: 'A jóváhagyott feladatok automatikus kiadása 08:00-kor',
  autoReleaseHint: 'Kikapcsolva a jóváhagyott terv várakozik, amíg egy vezető ki nem adja.',
  preparing: 'A holnapi takarítás előkészítése', secureConnection: 'Biztonságos kapcsolat', readPms: 'PMS-adatok betöltése',
  verifyTomorrow: 'Holnapi adatok ellenőrzése', close: 'Bezárás', retry: 'Friss szinkron újrapróbálása', elapsed: 'eltelt',
  safetyLock: 'A biztonsági zárolás aktív: a mai szobatípusok nem kerülnek át holnapra, és ellenőrzés előtt nem mentünk tervet.',
  technicalDetail: 'Technikai részletek', checkingSnapshot: 'Legfrissebb PMS-adatok ellenőrzése',
  checkingSnapshotDetail: 'A rendszer friss, ellenőrzött holnapi adatokat keres.',
  connecting: 'Biztonságos PMS-kapcsolat előkészítése', refreshingRooms: 'Aktuális szobaállapot frissítése',
  downloading: 'Holnapi foglalások letöltése', validating: 'Holnapi szobadatok ellenőrzése',
  slowSync: 'A PMS-szinkron a vártnál tovább tart. A HotelCare tovább dolgozik; az ellenőrzés alatt semmi nincs kiosztva.',
};

const translations: Partial<Record<HousekeepingAutomationLanguage, Record<NextDayAutoAssignUiKey, string>>> = { en, hu };

export function nextDayAutoAssignUiText(key: NextDayAutoAssignUiKey, language?: string | null): string {
  const normalized = normalizeHousekeepingAutomationLanguage(language) || 'en';
  return translations[normalized]?.[key] || en[key];
}
