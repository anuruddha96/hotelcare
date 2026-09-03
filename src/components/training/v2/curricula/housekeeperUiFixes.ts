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
  tab: 'my-tasks',
  precondition: 'is_signed_in',
  waitFor: 'has_any_assignment_today',
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
      };
    }

    if (step.key === 'my_tasks') {
      return {
        ...step,
        // Starting the first assigned room is a core part of first-shift
        // training. Once an assignment exists, do not silently skip it.
        optional: false,
      };
    }

    if (step.key === 'special_instructions') {
      return {
        ...step,
        // AssignedRoomCard only renders this block when there is a real towel,
        // linen, bed, manager-note or other room-specific instruction. The
        // step is optional, so it is deferred when the room has none.
        selector: '[data-training="room-special-instructions"]',
      };
    }

    if (step.key === 'signout') {
      return {
        ...step,
        // Zero assignments after check-in means "waiting for work", not
        // "finished work". End Shift should only be taught after the user had
        // housekeeping work today and no active/pending rooms remain.
        precondition: 'has_finished_housekeeping_work_today' as const,
      };
    }

    return step;
  });

  const myTasksIndex = correctedSteps.findIndex((step) => step.key === 'my_tasks');
  const alreadyInserted = correctedSteps.some((step) => step.key === waitForAssignmentStep.key);
  if (myTasksIndex < 0 || alreadyInserted) {
    return { ...curriculum, steps: correctedSteps };
  }

  return {
    ...curriculum,
    steps: [
      ...correctedSteps.slice(0, myTasksIndex),
      waitForAssignmentStep,
      ...correctedSteps.slice(myTasksIndex),
    ],
  };
}
