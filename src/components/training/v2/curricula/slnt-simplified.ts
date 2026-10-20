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
  slug: 'slnt_simple_manager_b_v1',
  name: copy('SLNT: Manage the shared Team B queue', 'SLNT: B csapat közös munkalistájának kezelése'),
  description: copy('Review cleaners’ shared work and approve rooms before Previo synchronization.',
    'A közös munkalista áttekintése és szobák jóváhagyása a Previo frissítése előtt.'),
  roles: ['manager','housekeeping_manager','admin','top_management','top_management_manager'],
  category: 'core', priority: -50, moduleKey: 'housekeeping', estMinutes: 2,
  steps: [
    step('shared','One shared worklist','Egyetlen közös munkalista',
      'Team B cleaners see the same rooms and claim their own work. Individual manager assignment is not required.',
      'A B csapat takarítói ugyanazokat a szobákat látják, és maguk veszik át a feladatot. Nem kell egyenként kiosztani.',
      '[data-training="slnt-team-b-shared-worklist"]'),
    step('monitor','Monitor room progress','Szobák állapotának követése',
      'See which rooms are available, claimed and awaiting approval.',
      'Lásd az elérhető, átvett és jóváhagyásra váró szobákat.',
      '[data-training="slnt-team-b-room"]'),
    step('approve','Approve before Previo','Jóváhagyás a Previo előtt',
      'Cleaner completion does not update Previo. Open Pending Approvals, verify the room and approve it.',
      'A takarító befejezése nem frissíti a Previót. Nyisd meg a Függő jóváhagyások részt, ellenőrizd és hagyd jóvá.',
      '[data-training="slnt-team-b-approvals"]'),
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
  slug: 'slnt_team_b_cleaner_v1',
  name: copy('SLNT Team B: Shared daily list', 'SLNT B csapat: Közös napi lista'),
  description: copy('Start cleaning directly from the team queue, upload photos and await approval.', 'Feladat átvétele a közös listáról, fényképek és vezetői jóváhagyás.'),
  roles: ['housekeeping'], category: 'core', priority: -50, moduleKey: 'housekeeping', estMinutes: 2,
  steps: [
    step('list','Everyone sees the same rooms','Mindenki ugyanazokat a szobákat látja',
      'The Team B daily list shows all rooms requiring cleaning. There are no individual daily room assignments.',
      'A B csapat minden takarítandó szobát közös listában lát. Nincs egyéni napi szobakiosztás.',
      '[data-training="slnt-team-b-shared-worklist"]','my-tasks'),
    step('claim','Take the room you will clean','Vedd át a takarítandó szobát',
      'Tap Take room. The room is reserved for you so two cleaners cannot work on it simultaneously.',
      'Koppints a Feladat átvétele gombra. Így másik takarító nem tudja egyszerre átvenni.',
      '[data-training="slnt-team-b-claim"]','my-tasks'),
    step('photos','Complete photos and checklist','Fényképek és ellenőrzőlista',
      'Open your room card, read notes, start cleaning and upload the required photos before completion.',
      'Nyisd meg a szobakártyát, olvasd el a megjegyzéseket, kezdj takarítani, és töltsd fel a képeket.',
      '[data-training="slnt-team-b-active-assignment"]','my-tasks'),
    step('manager','Wait for manager approval','Várj a vezetői jóváhagyásra',
      'Your completed room stays awaiting approval. Only the manager’s approval allows the Clean update to Previo.',
      'A kész szoba jóváhagyásra vár. A Previo csak vezetői jóváhagyás után kapja meg a tiszta állapotot.',
      '[data-training="slnt-team-b-shared-worklist"]','my-tasks'),
  ],
};
