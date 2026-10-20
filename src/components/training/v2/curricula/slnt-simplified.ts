import type { TrainingCurriculum, TrainingStepV2 } from '../types';

const copy = (en: string, hu: string) => ({ en, hu });
const step = (key: string, enTitle: string, huTitle: string, enBody: string, huBody: string,
  selector: string, tab = 'housekeeping'): TrainingStepV2 => ({
  key, title: copy(enTitle,huTitle), body: copy(enBody,huBody),
  route: '/:org', tab, selector, optional: true,
});

export const slntManagerTraining: TrainingCurriculum = {
  slug: 'slnt_simple_manager_v1',
  name: copy('SLNT: Plan Team A and approve Team B', 'SLNT: A csapat tervezése és B csapat jóváhagyása'),
  description: copy('Learn the new SLNT-only calendar and shared daily cleaning workflow.', 'Ismerd meg az SLNT egyszerű naptárát és a közös napi takarítási listát.'),
  roles: ['manager','housekeeping_manager','admin','top_management','top_management_manager'],
  category: 'core', priority: -50, moduleKey: 'housekeeping', estMinutes: 3,
  steps: [
    step('teams','Two teams, two simple workflows','Két csapat, két egyszerű munkafolyamat',
      'Team A receives individual apartment assignments. Team B works from one shared list, without shifts.',
      'Az A csapat apartmanonként kap feladatot. A B csapat közös listából dolgozik, műszakbeosztás nélkül.',
      '[data-training="slnt-team-switcher"]'),
    step('calendar','Choose a day','Válassz napot',
      'Select any of the next 14 days. No shift creation or publishing is necessary.',
      'Válassz napot a következő 14 napból. Nem kell műszakot létrehozni vagy közzétenni.',
      '[data-training="slnt-team-a-days"]'),
    step('availability','Mark days off','Szabadnapok jelölése',
      'People work by default. Mark only exceptions as Day off. Reassign their rooms before marking them off.',
      'A dolgozók alapértelmezetten dolgoznak. Csak a szabadnapokat kell jelölni; előbb oszd át a feladataikat.',
      '[data-training="slnt-team-a-availability"]'),
    step('assign','Allocate apartments','Apartmanok kiosztása',
      'Use the dropdown next to each apartment. Save happens immediately. Unsold apartments remain provisional until Previo revalidation.',
      'Minden apartman mellett válaszd ki a takarítót. A módosítás azonnal mentődik. A foglalás nélküli lakások ideiglenesek.',
      '[data-training="slnt-team-a-assignments"]'),
    step('team-b','Review the Team B shared list','B csapat közös listája',
      'Switch to Team B — today. Cleaners claim rooms themselves. You do not need to assign anyone.',
      'Válts a B csapat – mai munka fülre. A takarítók maguk veszik fel a feladatokat, nincs szükség kiosztásra.',
      '[data-training="slnt-team-switcher"]'),
    step('approve','Manager approval before Previo','Vezetői jóváhagyás a Previo előtt',
      'Open Pending Approvals in the Team B tab. A cleaner completion never pushes Clean to Previo until approved.',
      'Nyisd meg a Függő jóváhagyásokat a B csapat fülön. A Previo csak vezetői jóváhagyás után kap tiszta állapotot.',
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
