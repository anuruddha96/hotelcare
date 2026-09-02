import type { I18nText, TrainingCurriculum, TrainingStepV2 } from '../types';

const t6 = (
  en: string,
  hu: string,
  es: string,
  vi: string,
  mn: string,
  uk: string,
): I18nText => ({ en, hu, es, vi, mn, uk });

const ROOM_PHASE = t6(
  '3 · Work inside a room',
  '3 · Munka a szobában',
  '3 · Trabaja dentro de una habitación',
  '3 · Làm việc trong phòng',
  '3 · Өрөөн дотор ажиллах',
  '3 · Робота в номері',
);

const END_PHASE = t6(
  '5 · Finish work before ending the shift',
  '5 · Minden munka befejezése műszakzárás előtt',
  '5 · Termina el trabajo antes de cerrar el turno',
  '5 · Hoàn tất công việc trước khi kết thúc ca',
  '5 · Ээлж дуусгахаас өмнө ажлаа бүрэн дуусгах',
  '5 · Завершіть роботу перед закриттям зміни',
);

const minibarStep: TrainingStepV2 = {
  key: 'minibar',
  phase: ROOM_PHASE,
  title: t6(
    'Minibar — record consumption in the correct room',
    'Minibár — a fogyasztást a megfelelő szobához rögzítsd',
    'Minibar — registra el consumo en la habitación correcta',
    'Minibar — ghi nhận tiêu thụ đúng phòng',
    'Минибар — хэрэглээг зөв өрөөнд бүртгэ',
    'Мінібар — фіксуйте споживання в правильному номері',
  ),
  body: t6(
    'Open Minibar while you are working in this room. Check what the guest used and record or confirm the minibar status before you complete the room. Do not rely on memory and enter several rooms later.',
    'A szobában dolgozva nyisd meg a Minibár funkciót. Ellenőrizd a vendég fogyasztását, és a szoba lezárása előtt rögzítsd vagy erősítsd meg a minibár állapotát. Ne emlékezetből tölts ki több szobát később.',
    'Abre Minibar mientras trabajas en esta habitación. Comprueba lo consumido y registra o confirma el estado antes de completar la habitación. No lo dejes para introducir varias habitaciones de memoria más tarde.',
    'Mở Minibar khi đang làm đúng phòng này. Kiểm tra khách đã dùng gì và ghi nhận hoặc xác nhận trạng thái minibar trước khi hoàn tất phòng. Không để đến sau rồi nhập nhiều phòng theo trí nhớ.',
    'Энэ өрөөнд ажиллаж байхдаа Минибар нээнэ үү. Зочин юу хэрэглэснийг шалгаж, өрөөг дуусгахаас өмнө минибарын төлөвийг бүртгэж эсвэл баталгаажуулна. Дараа нь олон өрөөг санаж бөглөх гэж бүү хойшлуул.',
    'Відкрийте «Мінібар», поки працюєте саме в цьому номері. Перевірте, що використав гість, і зафіксуйте або підтвердьте стан мінібару до завершення номера. Не відкладайте внесення кількох номерів на потім по пам’яті.',
  ),
  purpose: t6(
    'Accurate room-level minibar records protect guest billing and stock control.',
    'A pontos, szobaszintű minibár-rögzítés védi a vendégszámlázást és a készletellenőrzést.',
    'El registro exacto por habitación protege la facturación del huésped y el control de stock.',
    'Ghi minibar chính xác theo từng phòng giúp bảo vệ tính tiền cho khách và kiểm soát tồn kho.',
    'Өрөө тус бүрийн зөв минибар бүртгэл нь зочны тооцоо болон нөөцийн хяналтыг хамгаална.',
    'Точний облік мінібару по номеру захищає рахунок гостя та контроль запасів.',
  ),
  tip: t6(
    'If nothing was used, confirm the status instead of inventing a quantity.',
    'Ha nem volt fogyasztás, az állapotot erősítsd meg — ne adj meg kitalált mennyiséget.',
    'Si no hubo consumo, confirma el estado; no inventes cantidades.',
    'Nếu không có tiêu thụ, hãy xác nhận trạng thái thay vì tự nhập số lượng.',
    'Хэрэглээгүй бол тоо зохиохгүй, төлөвийг баталгаажуул.',
    'Якщо нічого не використано, підтвердьте стан і не вигадуйте кількість.',
  ),
  route: '/:org',
  tab: 'housekeeping',
  // Minibar is the button immediately after Dirty Linen in the in-room tool grid.
  // This keeps the training anchor stable without changing the production room card.
  selector: '[data-training="dirty-linen-button"] + button',
  precondition: 'has_in_progress_cleaning',
  optional: false,
};

const finishWorkGate: TrainingStepV2 = {
  key: 'finish_work_before_signout',
  phase: END_PHASE,
  title: t6(
    'Finish all assigned work before End Shift',
    'Műszakzárás előtt fejezz be minden kiosztott munkát',
    'Termina todo el trabajo asignado antes de cerrar el turno',
    'Hoàn tất mọi công việc được giao trước khi kết thúc ca',
    'Ээлж хаахаас өмнө бүх хуваарилсан ажлаа дуусга',
    'Завершіть усю призначену роботу перед закриттям зміни',
  ),
  body: t6(
    'Keep working in My Tasks until no room is Assigned, In Progress or waiting for a DND retry, and no assigned public-area task is unfinished. Hotel Care will continue this training automatically when your work queue is clear.',
    'Dolgozz tovább a Saját feladatokban addig, amíg nincs Kiosztott, Folyamatban vagy DND újrapróbálásra váró szoba, és nincs befejezetlen kiosztott közös területi feladat. A Hotel Care automatikusan folytatja a tréninget, amikor a munkalistád üres.',
    'Sigue trabajando en Mis Tareas hasta que no quede ninguna habitación Asignada, En curso o pendiente de reintento DND, ni tareas asignadas de zonas comunes sin terminar. Hotel Care continuará automáticamente cuando la cola esté vacía.',
    'Tiếp tục làm trong Nhiệm vụ của tôi cho đến khi không còn phòng Được giao, Đang thực hiện hoặc chờ thử lại DND và không còn nhiệm vụ khu vực chung được giao chưa hoàn tất. Hotel Care sẽ tự tiếp tục khi danh sách công việc đã sạch.',
    'Миний даалгаварт Хуваарилсан, Үргэлжилж буй эсвэл DND дахин оролдохоор хүлээж буй өрөө, мөн дуусаагүй нийтийн талбайн даалгавар үлдэхгүй болтол ажлаа үргэлжлүүл. Ажлын жагсаалт цэвэр болмогц Hotel Care сургалтыг автоматаар үргэлжлүүлнэ.',
    'Продовжуйте роботу в «Моїх завданнях», доки не залишиться номерів зі статусом «Призначено», «В роботі» або DND на повторну спробу, а також незавершених призначених завдань у спільних зонах. Hotel Care автоматично продовжить навчання, коли черга робіт буде порожня.',
  ),
  purpose: t6(
    'Ending a shift with unfinished work can leave rooms or public areas without an owner and create incorrect handovers.',
    'A befejezetlen munkával lezárt műszak gazdátlan szobákat vagy közös területeket és hibás átadást okozhat.',
    'Cerrar el turno con trabajo pendiente puede dejar habitaciones o zonas comunes sin responsable y causar entregas incorrectas.',
    'Kết thúc ca khi còn việc dang dở có thể khiến phòng hoặc khu vực chung không có người phụ trách và gây bàn giao sai.',
    'Дуусаагүй ажилтай ээлж хаавал өрөө эсвэл нийтийн талбай эзэнгүй үлдэж, буруу хүлээлгэн өгөлт үүснэ.',
    'Завершення зміни з незакритою роботою може залишити номери чи спільні зони без відповідального та створити неправильну передачу зміни.',
  ),
  tip: t6(
    'If a room cannot be finished, follow the DND / supervisor handover process instead of simply signing out.',
    'Ha egy szoba nem fejezhető be, a DND / vezetői átadási folyamatot kövesd, ne egyszerűen jelentkezz ki.',
    'Si una habitación no puede terminarse, usa el proceso DND / entrega al supervisor en vez de cerrar sesión sin más.',
    'Nếu không thể hoàn tất một phòng, hãy dùng quy trình DND / bàn giao cho giám sát thay vì chỉ kết thúc ca.',
    'Өрөөг дуусгах боломжгүй бол шууд гарахын оронд DND / ахлахад хүлээлгэн өгөх журмыг дагана уу.',
    'Якщо номер неможливо завершити, скористайтеся процесом DND / передачі керівнику, а не просто завершуйте зміну.',
  ),
  // Deliberately no route/tab here: the guide stays on the housekeeping screen.
  // The provider polls this guard and advances only when the user's work is clear.
  waitFor: 'has_no_unfinished_housekeeping_work',
};

const IN_ROOM_STEPS = new Set([
  'dnd',
  'dirty_linen',
  'minibar',
  'maintenance',
  'lost_found',
  'notes',
]);

/**
 * Applies safety-critical housekeeping onboarding fixes without duplicating the
 * large base curriculum. This keeps the source curriculum readable while the
 * final exported curriculum always contains the complete operational flow.
 */
export function applyHousekeeperOperationalFixes(
  curriculum: TrainingCurriculum,
): TrainingCurriculum {
  let steps = curriculum.steps.map((step) => ({ ...step }));

  // 1) Minibar was visible in the room UI but missing from the guided lesson.
  if (!steps.some((step) => step.key === minibarStep.key)) {
    const linenIndex = steps.findIndex((step) => step.key === 'dirty_linen');
    const insertAt = linenIndex >= 0 ? linenIndex + 1 : steps.findIndex((step) => step.key === 'maintenance');
    steps.splice(insertAt >= 0 ? insertAt : steps.length, 0, minibarStep);
  }

  // 2) Once a real room is in progress, stable in-room tools must be explained
  // rather than silently deferred. Room Photos stays optional because checkout
  // cleaning intentionally does not show the daily-photo tile.
  steps = steps.map((step) =>
    IN_ROOM_STEPS.has(step.key)
      ? { ...step, optional: false, precondition: 'has_in_progress_cleaning' }
      : step,
  );

  // 3) Do not navigate the trainee to Attendance / End Shift while work remains.
  // Insert a live gate before the existing break/sign-out section. It stays on
  // the housekeeping screen and auto-continues only when all work is clear.
  if (!steps.some((step) => step.key === finishWorkGate.key)) {
    const breaksIndex = steps.findIndex((step) => step.key === 'breaks');
    const signoutIndex = steps.findIndex((step) => step.key === 'signout');
    const insertAt = breaksIndex >= 0 ? breaksIndex : signoutIndex >= 0 ? signoutIndex : steps.length;
    steps.splice(insertAt, 0, finishWorkGate);
  }

  // Defence in depth for resumed training sessions that land directly on the
  // sign-out lesson. The normal flow reaches this only after the live gate.
  steps = steps.map((step) =>
    step.key === 'signout'
      ? { ...step, precondition: 'has_no_unfinished_housekeeping_work' }
      : step,
  );

  return {
    ...curriculum,
    estMinutes: Math.max(curriculum.estMinutes ?? 0, 8),
    steps,
  };
}
