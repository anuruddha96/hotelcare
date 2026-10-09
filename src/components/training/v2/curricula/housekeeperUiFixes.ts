import type { I18nText, TrainingCurriculum, TrainingStepV2 } from '../types';

const t6 = (
  en: string,
  hu: string,
  es: string,
  vi: string,
  mn: string,
  uk: string,
): I18nText => ({ en, hu, es, vi, mn, uk });

const waitForAssignmentStep: TrainingStepV2 = {
  key: 'wait_for_assignment',
  phase: t6(
    '2 · Start your room',
    '2 · Szoba indítása',
    '2 · Empieza tu habitación',
    '2 · Bắt đầu phòng',
    '2 · Өрөөгөө эхлүүлэх',
    '2 · Початок роботи в номері',
  ),
  title: t6(
    "You're checked in — waiting for your first assignment",
    'Bejelentkeztél — várjuk az első feladatodat',
    'Ya registraste entrada — esperando tu primera asignación',
    'Bạn đã chấm công — đang chờ phòng đầu tiên',
    'Та бүртгүүллээ — эхний даалгавраа хүлээж байна',
    'Ви відмітилися — очікуємо перше призначення',
  ),
  body: t6(
    'No room has been assigned to you yet. Stay checked in. Hotel Care will keep the training at this point and continue automatically as soon as a room is assigned to you. You do not need to restart the training.',
    'Még nincs hozzád rendelve szoba. Maradj bejelentkezve. A Hotel Care itt tartja a tréninget, és automatikusan folytatja, amint szobát kapsz. Nem kell újraindítanod a tréninget.',
    'Todavía no tienes una habitación asignada. Mantén tu turno iniciado. Hotel Care mantendrá la formación en este punto y continuará automáticamente cuando te asignen una habitación. No necesitas reiniciar la formación.',
    'Bạn chưa được giao phòng. Hãy giữ trạng thái đã chấm công. Hotel Care sẽ giữ hướng dẫn ở bước này và tự động tiếp tục ngay khi bạn được giao phòng. Bạn không cần bắt đầu lại.',
    'Танд одоогоор өрөө оноогоогүй байна. Бүртгэлтэй хэвээр байгаарай. Hotel Care сургалтыг энэ алхам дээр хадгалж, өрөө оноогдмогц автоматаар үргэлжлүүлнэ. Сургалтыг дахин эхлүүлэх шаардлагагүй.',
    'Вам ще не призначено номер. Залишайтеся відміченими на зміні. Hotel Care збереже навчання на цьому кроці й автоматично продовжить, щойно вам призначать номер. Починати навчання заново не потрібно.',
  ),
  purpose: t6(
    'Waiting for an assignment is not the same as finishing the shift. This prevents the training from disappearing or teaching End Shift too early.',
    'A feladatra várakozás nem ugyanaz, mint a műszak befejezése. Így a tréning nem tűnik el, és nem tanítja túl korán a műszakzárást.',
    'Esperar una asignación no significa haber terminado el turno. Así la formación no desaparece ni enseña a finalizar el turno demasiado pronto.',
    'Chờ được giao phòng không có nghĩa là đã kết thúc ca. Điều này giúp hướng dẫn không biến mất hoặc hướng dẫn kết thúc ca quá sớm.',
    'Даалгавар хүлээх нь ээлж дууссан гэсэн үг биш. Ингэснээр сургалт алга болохгүй, ээлж хаахыг хэт эрт заахгүй.',
    'Очікування призначення не означає завершення зміни. Це не дає навчанню зникнути або показати завершення зміни надто рано.',
  ),
  tip: t6(
    'If you need the screen, tap X to pause. Resume later from Training Center. Do not end the shift only because no rooms are visible yet.',
    'Ha szükséged van a képernyőre, az X-szel szüneteltesd a tréninget. Később a Tréningközpontból folytathatod. Ne zárd le a műszakot csak azért, mert még nincs látható szoba.',
    'Si necesitas usar la pantalla, toca X para pausar. Continúa luego desde el Centro de formación. No finalices el turno solo porque aún no aparezcan habitaciones.',
    'Nếu cần dùng màn hình, nhấn X để tạm dừng. Tiếp tục sau từ Trung tâm đào tạo. Đừng kết thúc ca chỉ vì chưa thấy phòng nào.',
    'Дэлгэцийг ашиглах хэрэгтэй бол X дарж сургалтыг түр зогсооно. Дараа Сургалтын төвөөс үргэлжлүүлнэ. Өрөө харагдахгүй байна гээд ээлжээ бүү хаагаарай.',
    'Якщо потрібно користуватися екраном, натисніть X, щоб призупинити навчання. Продовжіть пізніше з Центру навчання. Не завершуйте зміну лише тому, що номерів ще не видно.',
  ),
  route: '/:org',
  tab: 'housekeeping',
  precondition: 'is_signed_in',
  waitFor: 'has_any_assignment_today',
};


const openMyTasksStep: TrainingStepV2 = {
  key: 'open_my_tasks',
  phase: t6('2 · Start your room', '2 · Szoba indítása', '2 · Empieza tu habitación', '2 · Bắt đầu phòng', '2 · Өрөөгөө эхлүүлэх', '2 · Початок роботи в номері'),
  title: t6('Open My Tasks', 'Nyisd meg a Saját feladatok oldalt', 'Abre Mis tareas', 'Mở Công việc của tôi', 'Миний даалгавар хэсгийг нээнэ үү', 'Відкрийте Мої завдання'),
  body: t6('Tap My Tasks to see your rooms. We will follow along on the actual screen.', 'Koppints a Saját feladatok fülre a szobák megtekintéséhez. A valódi képernyőn vezetünk.', 'Toca Mis tareas para ver tus habitaciones. Te guiaremos en la pantalla real.', 'Nhấn Công việc của tôi để xem các phòng. Hướng dẫn theo màn hình thật.', 'Өрөөнүүдээ харахын тулд Миний даалгавар дээр дарна уу. Бодит дэлгэц дээр чиглүүлнэ.', 'Натисніть Мої завдання, щоб побачити номери. Ми підкажемо прямо на екрані.'),
  purpose: t6('Your daily work begins here.', 'Itt kezdődik a napi munkád.', 'Aquí comienza tu trabajo diario.', 'Công việc mỗi ngày bắt đầu tại đây.', 'Өдөр тутмын ажил эндээс эхэлнэ.', 'Тут починається щоденна робота.'),
  route: '/:org',
  selector: '[data-training="housekeeping-tab"]',
  advanceOnClick: true,
};

const roomOverviewStep: TrainingStepV2 = {
  key: 'room_overview',
  phase: t6('2 · Start your room', '2 · Szoba indítása', '2 · Empieza tu habitación', '2 · Bắt đầu phòng', '2 · Өрөөгөө эхлүүлэх', '2 · Початок роботи в номері'),
  title: t6('Find your assigned room', 'Keresd meg a kijelölt szobádat', 'Encuentra tu habitación asignada', 'Tìm phòng được giao', 'Оноосон өрөөгөө олно уу', 'Знайдіть призначений номер'),
  body: t6('This card shows the room number, status and instructions. Check that it is the correct room. You can continue or skip this tip without changing anything.', 'Ez a kártya a szobaszámot, az állapotot és az utasításokat mutatja. Ellenőrizd, hogy ez a megfelelő szoba. Továbbléphetsz vagy kihagyhatod a tippet, módosítás nélkül.', 'Esta tarjeta muestra el número, el estado y las instrucciones. Confirma que sea la habitación correcta. Puedes continuar u omitir el consejo sin cambiar nada.', 'Thẻ này hiển thị số phòng, trạng thái và hướng dẫn. Kiểm tra đúng phòng trước khi làm. Có thể tiếp tục hoặc bỏ qua mà không thay đổi gì.', 'Энэ карт өрөөний дугаар, төлөв, зааврыг харуулна. Зөв өрөө эсэхийг шалга. Юу ч өөрчлөхгүйгээр үргэлжлүүлж эсвэл алгасаж болно.', 'Ця картка показує номер, стан та інструкції. Перевірте правильність номера. Можна продовжити або пропустити пораду без змін.'),
  purpose: t6('Review room details before starting work.', 'Munka előtt ellenőrizd a szoba adatait.', 'Revisa los datos antes de comenzar.', 'Xem thông tin trước khi bắt đầu.', 'Ажил эхлэхээс өмнө мэдээллийг шалгана уу.', 'Перевірте деталі перед початком роботи.'),
  route: '/:org',
  tab: 'housekeeping',
  selector: '[data-training="assigned-room-card"]',
  precondition: 'has_any_assignment_today',
  optional: true,
};

/**
 * Small housekeeper curriculum corrections layered on top of the translated
 * base curriculum. Keeping them here avoids rewriting the large curriculum
 * whenever a live mobile/workflow edge case is found.
 */
export function applyHousekeeperUiFixes(curriculum: TrainingCurriculum): TrainingCurriculum {
  const correctedSteps = curriculum.steps.map((step) => {
    if (step.key === 'signin') {
      return {
        ...step,
        // The Attendance component wraps its intro card and SwipeAction in
        // `check-in-button`. Spotlight only the actual swipe track so the
        // housekeeper can see exactly what must be used and the target rect is
        // small enough to remain clear of the mobile coaching sheet.
        selector: '[data-training="check-in-button"] [data-training="swipe-action-track"]',
        skipWhen: 'is_signed_in' as const,
      };
    }

    if (step.key === 'my_tasks') {
      return {
        ...step,
        tab: 'housekeeping',
        // Do not make a real room start mandatory just to complete training.
        // When a room is already underway, continue directly to its tools.
        skipWhen: 'has_in_progress_cleaning' as const,
        optional: true,
      };
    }

    if (step.key === 'breaks') {
      return { ...step, selector: '[data-training="break-button"]' };
    }

    if (step.key === 'complete_room') {
      return { ...step, tab: 'housekeeping', selector: '[data-training="active-assigned-room"] [data-training="complete-room-button"]' };
    }

    if (step.key === 'signout') {
      return {
        ...step,
        selector: '[data-training="sign-out-button"]',
        precondition: 'has_finished_housekeeping_work_today' as const,
      };
    }

    if (step.key === 'special_instructions') {
      return {
        ...step,
        // AssignedRoomCard only renders this block when there is a real towel,
        // linen, bed, manager-note or other room-specific instruction. The
        // step is optional, so it is deferred when the room has none.
        selector: '[data-training="active-assigned-room"] [data-training="room-special-instructions"]',
      };
    }

    // Always highlight controls inside the housekeeper's active room.
    // Otherwise the first matching button might belong to another room.
    if (step.precondition === 'has_in_progress_cleaning' && step.selector) {
      const selector = step.key === 'special_instructions'
        ? '[data-training="room-special-instructions"]'
        : step.selector;
      return { ...step, selector: `[data-training="active-assigned-room"] ${selector}` };
    }

    return step;
  });

  const myTasksIndex = correctedSteps.findIndex((step) => step.key === 'my_tasks');
  if (myTasksIndex < 0) return { ...curriculum, steps: correctedSteps };

  return {
    ...curriculum,
    steps: [
      ...correctedSteps.slice(0, myTasksIndex),
      openMyTasksStep,
      waitForAssignmentStep,
      roomOverviewStep,
      ...correctedSteps.slice(myTasksIndex),
    ],
  };
}
