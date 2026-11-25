import type { TrainingCurriculum, TrainingStepV2 } from '../types';

const copy = (en: string, hu: string) => ({ en, hu });
const step = (key: string, enTitle: string, huTitle: string, enBody: string, huBody: string,
  selector: string, tab = 'housekeeping'): TrainingStepV2 => ({
  key, title: copy(enTitle,huTitle), body: copy(enBody,huBody),
  route: '/:org', tab, selector, optional: true,
});

/** SLNT Team B launches first. Team A training is deferred until the
 * apartments and cleaners are mapped together with SLNT management. */
export const slntManagerTraining: TrainingCurriculum = {
  slug: 'slnt_simple_manager_b_v3',
  name: copy('SLNT: Team B pool and working-day calendar',
    'SLNT: B csapat közös lista és munkanapok'),
  description: copy('Keep your property room overview, PMS sync and approvals. Individual room cards update when cleaning starts.',
    'Az ingatlanok, PMS-szinkron és jóváhagyások változatlanok. A takarító saját kártyáján a munka megkezdésekor jelenik meg a szoba.'),
  roles: ['manager','housekeeping_manager','admin','top_management','top_management_manager'],
  category: 'core', priority: -50, moduleKey: 'housekeeping', estMinutes: 2,
  steps: [
    step('manager-view','Your familiar Team View stays the same','A megszokott csapatnézet változatlan',
      'This is your original SLNT property overview: PMS sync, checkout and stayover rooms, room chips, notes and normal manager actions. No new planning screen replaces it.',
      'Itt látható az eredeti SLNT ingatlanáttekintés: PMS-szinkron, kijelentkezők, napi szobák, szobakártyák, megjegyzések és vezetői műveletek. Ezt a nézetet nem cseréltük le.',
      '[data-training="team-view"]'),
    step('pool','Team A and B, before individual cards','A és B csapat a dolgozók előtt',
      'Team B shows unstarted work and who is cleaning. Individual housekeeper cards show rooms once cleaning actually starts. Team A remains unconfigured.',
      'A B csapat mutatja a még meg nem kezdett munkákat és hogy ki takarít. A dolgozó saját kártyáján a megkezdett munka jelenik meg. Az A csapat még nincs beállítva.',
      '[data-training="slnt-team-pool-manager"]'),
    step('staffing','Working by default — mark only absences','Alapértelmezés: dolgozik',
      'There is no shift publishing. Mark a Day off, Annual leave or Sick leave only when someone is absent. Release active work first.',
      'Nem kell műszakot közzétenni. Csak hiányzáskor jelöld a szabadnapot, szabadságot vagy betegszabadságot. Az aktív feladatot előbb át kell adni.',
      '[data-training="slnt-availability-calendar"]'),
    step('existing-approval','Keep existing approvals and PMS controls','Megmaradnak a jóváhagyások és a PMS-kezelés',
      'Use your existing manager approval and PMS areas, just as before. Team B cleaners claim checkout and stayover tasks from their own shared My Tasks view. Only approved clean completions sync to Previo.',
      'Használd tovább a megszokott jóváhagyási és PMS-felületeket. A B csapat takarítói a saját Feladataim nézetből veszik át a kijelentkező és napi szobákat. Csak a jóváhagyott tiszta állapot kerül a Previóba.',
      '[data-training="manager-approvals-tab"]'),
  ],
};

export const slntTeamACleanerTraining: TrainingCurriculum = {
  slug: 'slnt_team_a_cleaner_v1',
  name: copy('SLNT Team A: My apartments', 'SLNT A csapat: Saját apartmanjaim'),
  description: copy('Open your upcoming days, read instructions and complete your assigned cleaning.', 'A következő napok, utasítások és kiosztott takarítások kezelése.'),
  roles: ['housekeeping'], category: 'core', priority: -49, moduleKey: 'housekeeping', estMinutes: 2,
  steps: [
    step('future','Open upcoming cleaning days','A következő takarítási napok',
      'Select a day in the coming two weeks to see your apartment assignments. There is no separate shift schedule.',
      'Válassz napot a következő két hétből. A kijelölt apartmanokhoz nem kell külön műszakbeosztás.',
      '[data-training="slnt-staff-next-days"]','my-tasks'),
    step('rooms','Read each apartment task','Az apartmanfeladatok áttekintése',
      'Check the status, guest notes, checkout information and instructions before entering.',
      'Belépés előtt ellenőrizd az állapotot, a vendégmegjegyzéseket, a távozási adatokat és az utasításokat.',
      '[data-training="assigned-room-card"]','my-tasks'),
    step('complete','Clean, upload photos and complete','Takarítás, fényképek, befejezés',
      'Use the real room card to start, take photos where required and finish. The manager reviews the work.',
      'A szobakártyán indítsd a takarítást, töltsd fel a szükséges képeket, majd fejezd be. A vezető ellenőrzi.',
      '[data-training="assigned-room-card"]','my-tasks'),
  ],
};

export const slntTeamBCleanerTraining: TrainingCurriculum = {
  slug: 'slnt_team_b_cleaner_v3',
  name: copy('SLNT Team B: Shared daily list', 'SLNT B csapat: Közös napi lista'),
  description: copy('Start cleaning directly from the team queue, upload photos and await approval.', 'Feladat átvétele a közös listáról, fényképek és vezetői jóváhagyás.'),
  roles: ['housekeeping'], category: 'core', priority: -50, moduleKey: 'housekeeping', estMinutes: 2,
  steps: [
    step('list','Everyone sees the same rooms','Mindenki ugyanazokat a szobákat látja',
      'Your work is separated into RTC-ready checkouts and stayover/towel-change rooms. Everyone eligible sees the shared queue.',
      'A közös lista külön mutatja a takarításra kész kijelentkező és a napi/törölközőcserés szobákat. Nincs egyéni kiosztás.',
      '[data-training="slnt-team-b-shared-worklist"]','my-tasks'),
    step('claim','Take the room you will clean','Vedd át a takarítandó szobát',
      'Tap Start cleaning on an RTC-ready room. Only one cleaner can claim it. Waiting checkouts cannot be started until RTC.',
      'A kész szobán koppints a Takarítás indítása gombra. Más nem veheti át ugyanazt a szobát; a még foglalt kijelentkező nem indítható.',
      '[data-training="slnt-team-b-claim"]','my-tasks'),
    step('optional','Other stayovers are optional','Az egyéb napi szobák opcionálisak',
      'Due towel and linen changes come before optional stayovers. Expand Other stayovers only when cleaning is appropriate. Never start DND or No Service rooms.',
      'A törölköző- és ágyneműcsere megelőzi az opcionális napi szobákat. Az Egyéb napi szobák csak szükség esetén nyithatók meg. DND és No Service szoba nem indítható.',
      '[data-training="slnt-optional-stayovers"]','my-tasks'),
    step('photos','Complete photos and checklist','Fényképek és ellenőrzőlista',
      'The room opens with all previous options: maintenance, Lost & Found, dirty linen, instructions, photos and normal completion.',
      'A szobakártya változatlan: karbantartás, talált tárgyak, szennyes, utasítások, fényképek és a megszokott befejezés.',
      '[data-training="slnt-team-b-active-assignment"]','my-tasks'),
    step('manager','Wait for manager approval','Várj a vezetői jóváhagyásra',
      'Your completed room stays awaiting approval. Only the manager’s approval allows the Clean update to Previo.',
      'A kész szoba jóváhagyásra vár. A Previo csak vezetői jóváhagyás után kapja meg a tiszta állapotot.',
      '[data-training="slnt-team-b-shared-worklist"]','my-tasks'),
  ],
};
