// Contextual, read-only guided walkthrough of the actual manager Team View.
// Do not require a manager to refresh PMS, reassign rooms or approve work
// merely to demonstrate those controls.
import type { I18nText, TrainingCurriculum, TrainingStepV2 } from '../types';

const t = (en: string, hu: string, es: string, vi: string, mn: string, uk: string): I18nText =>
  ({ en, hu, es, vi, mn, uk });

const team = (step: TrainingStepV2): TrainingStepV2 => ({
  route: '/:org',
  tab: 'housekeeping',
  subTab: 'manage',
  optional: true,
  ...step,
});

export const managerTeamCurriculum: TrainingCurriculum = {
  slug: 'v2_manager_team_and_assignments',
  name: t('Team View & Room Assignments', 'Csapatnézet és szobakiosztás', 'Equipo y habitaciones', 'Nhóm và phân phòng', 'Баг ба өрөө хуваарилалт', 'Команда та розподіл номерів'),
  description: t('Learn the real Team View, PMS refresh, room status, assignments and approvals — without changing any live work.', 'Ismerd meg a Csapatnézetet, a PMS-frissítést, a szobák állapotát, a kiosztást és a jóváhagyásokat élő módosítás nélkül.', 'Conoce el equipo, PMS, estados y aprobaciones sin modificar trabajo real.', 'Xem nhóm, PMS, phòng và duyệt mà không sửa dữ liệu thật.', 'Бодит ажлыг өөрчлөхгүйгээр баг, PMS, өрөө, зөвшөөрлийг сур.', 'Ознайомтеся з командою, PMS, номерами й погодженнями без змін робочих даних.'),
  roles: ['manager', 'housekeeping_manager', 'admin', 'top_management_manager'],
  category: 'feature_promo',
  priority: 20,
  moduleKey: 'housekeeping',
  estMinutes: 4,
  steps: [
    team({
      key: 'open_team_view',
      title: t('Open Team View', 'Nyisd meg a Csapatnézetet', 'Abre Vista de equipo', 'Mở Xem nhóm', 'Багийн харагдацыг нээ', 'Відкрийте Огляд команди'),
      body: t('Tap Team View. The guide will follow your screen automatically.', 'Koppints a Csapatnézetre. Az útmutató automatikusan követ.', 'Toca Vista de equipo; la guía te seguirá.', 'Nhấn Xem nhóm; hướng dẫn sẽ theo bạn.', 'Багийн харагдацыг дарахад заавар дагана.', 'Натисніть Огляд команди — підказки підуть за вами.'),
      selector: '[data-training="manager-team-tab"]',
      advanceOnClick: true,
      subTab: undefined,
    }),
    team({
      key: 'team_view',
      title: t('This is your Team View', 'Ez a Csapatnézet', 'Esta es la vista del equipo', 'Đây là màn hình nhóm', 'Энэ бол багийн харагдац', 'Це ваш огляд команди'),
      body: t('See today’s rooms and staff in one place. You can review the information without making changes.', 'Itt egy helyen látod a mai szobákat és a csapatot. Módosítás nélkül is áttekintheted.', 'Revisa habitaciones y personal de hoy sin hacer cambios.', 'Xem phòng và nhân viên hôm nay mà không thay đổi gì.', 'Өнөөдрийн өрөө, ажилтнуудыг өөрчлөхгүйгээр хар.', 'Переглядайте номери та працівників без змін.'),
      selector: '[data-training="team-view"]',
    }),
    team({
      key: 'work_date',
      title: t('Check the work date', 'Ellenőrizd a munkanapot', 'Comprueba la fecha', 'Kiểm tra ngày làm', 'Ажлын өдрийг шалга', 'Перевірте робочу дату'),
      body: t('Use the date selector to review today or a planned day. Changing the date only changes what you are viewing.', 'A dátumválasztóval a mai vagy egy tervezett napot nézheted meg. Ez csak a megjelenítést változtatja.', 'Elige hoy u otro día; solo cambia la vista.', 'Chọn hôm nay hoặc ngày khác; chỉ thay đổi màn hình.', 'Өдөр сонгоход зөвхөн харагдац өөрчлөгдөнө.', 'Оберіть сьогодні чи іншу дату — зміниться лише огляд.'),
      selector: '[data-training="manager-team-date"]',
    }),
    team({
      key: 'room_board',
      title: t('Read the room board', 'A szobalista áttekintése', 'Lee el panel de habitaciones', 'Xem bảng phòng', 'Өрөөний жагсаалтыг унш', 'Перегляньте панель номерів'),
      body: t('Room tiles show what needs attention. Review checkout, stayover, ready-to-clean and other room statuses before assigning work.', 'A szobacsempék megmutatják, mire kell figyelni. Kiosztás előtt nézd meg a kijelentkező, maradó és takarításra kész szobákat.', 'Las celdas muestran salidas, estancias y habitaciones listas.', 'Ô phòng hiển thị trả phòng, lưu trú và phòng cần dọn.', 'Өрөөний тэмдэглэгээ гарах, үлдэх, цэвэрлэхэд бэлэн эсэхийг харуулна.', 'Позначки показують виїзди, продовження проживання й готовність до прибирання.'),
      selector: '#hotel-room-overview',
    }),
    team({
      key: 'legend',
      title: t('Understand room symbols', 'Szobajelölések értelmezése', 'Comprende los símbolos', 'Hiểu ký hiệu phòng', 'Өрөөний тэмдэглэгээ', 'Пояснення позначок'),
      body: t('This legend explains colors and abbreviations. Check it whenever a room status is unclear.', 'A jelmagyarázat megmutatja a színek és rövidítések jelentését.', 'La leyenda explica colores y abreviaturas.', 'Chú giải giải thích màu và ký hiệu.', 'Тайлбар нь өнгө, товчлолыг тайлбарлана.', 'Легенда пояснює кольори й скорочення.'),
      selector: '[data-training="room-legend"]',
    }),
    team({
      key: 'staff_cards',
      title: t('Read each housekeeper’s card', 'Szobaasszony-kártyák áttekintése', 'Revisa las tarjetas del personal', 'Xem thẻ nhân viên', 'Ажилтны картуудыг шалга', 'Перегляньте картки покоївок'),
      body: t('Each card shows a team member’s rooms, workload and progress. You can identify who needs help without opening or changing assignments.', 'Minden kártyán a dolgozó szobái, terhelése és előrehaladása látható. Módosítás nélkül is látszik, kinek kell segítség.', 'Cada tarjeta muestra habitaciones, carga y progreso.', 'Mỗi thẻ cho biết phòng, khối lượng và tiến độ.', 'Карт бүр өрөө, ачаалал, явцыг харуулна.', 'Картки показують номери, навантаження та прогрес.'),
      selector: '[data-training="manager-team-card"]',
    }),
    team({
      key: 'pms_refresh',
      title: t('PMS Refresh — when information looks old', 'PMS-frissítés — ha régi az adat', 'Actualizar PMS', 'Làm mới PMS', 'PMS шинэчлэх', 'Оновити PMS'),
      body: t('This requests fresh PMS room information. For training, just identify the button; do not refresh live data unless you actually need to.', 'Ez friss szobainformációt kér a PMS-től. Tréning közben csak ismerd fel a gombot; ne indíts frissítést szükség nélkül.', 'Pide datos nuevos del PMS. No lo pulses solo para practicar.', 'Lấy dữ liệu PMS mới; đừng nhấn chỉ để học.', 'PMS мэдээлэл шинэчилнэ; зөвхөн сургалтаар бүү дар.', 'Отримує свіжі дані PMS; не натискайте лише заради навчання.'),
      selector: '[data-training-id="pms-refresh-btn"]',
    }),
    team({
      key: 'auto_assign',
      title: t('Auto-Assign / Rebalance', 'Automatikus kiosztás / újraelosztás', 'Asignar automáticamente', 'Tự động phân phòng', 'Автомат хуваарилах', 'Автоматичний розподіл'),
      body: t('Use this when you want to prepare or rebalance room assignments. Opening it can lead to real changes; this guide only points it out.', 'Ezzel készíthetsz vagy újraoszthatsz feladatokat. Valós változást okozhat, itt csak bemutatjuk.', 'Puede cambiar asignaciones; aquí solo lo identificamos.', 'Có thể đổi phân phòng; ở đây chỉ giới thiệu.', 'Бодит хуваарилалтыг өөрчилж болно; энд зөвхөн танилцуулна.', 'Може змінити розподіл; тут лише показуємо функцію.'),
      selector: '[data-training="auto-assign-btn"]',
    }),
    team({
      key: 'manual_assignment',
      title: t('Manual assignment is also available', 'Kézi szobakiosztás', 'Asignación manual', 'Phân phòng thủ công', 'Гараар хуваарилах', 'Ручний розподіл'),
      body: t('Managers can assign or move rooms deliberately. Do not move a room during training; first confirm the correct staff member and property.', 'A vezető kézzel is kioszthat vagy áthelyezhet szobákat. Tréning közben ne mozgass szobát.', 'Puedes mover habitaciones, pero no lo hagas durante la guía.', 'Có thể chuyển phòng, nhưng không chuyển chỉ để học.', 'Өрөөг шилжүүлэх боломжтой; сургалтын үед бүү өөрчил.', 'Можна переносити номери, але не робіть цього під час навчання.'),
      selector: '[data-training="manager-team-card"]',
    }),
    team({
      key: 'team_summary',
      title: t('Check today’s team totals', 'Mai csapatösszesítés', 'Resumen del equipo', 'Tổng kết nhóm', 'Багийн дүн', 'Підсумок команди'),
      body: t('The summary shows team size and progress. Use it to spot unfinished rooms before the shift ends.', 'Az összesítés a létszámot és előrehaladást mutatja. Műszakzárás előtt ellenőrizd a hátralévő szobákat.', 'Muestra tamaño del equipo y progreso.', 'Cho biết số nhân viên và tiến độ.', 'Багийн тоо, явцыг харуулна.', 'Показує кількість працівників і прогрес.'),
      selector: '[data-training="manager-team-summary"]',
    }),
    team({
      key: 'open_approvals',
      title: t('Find pending approvals', 'Függő jóváhagyások', 'Abre las aprobaciones', 'Mở chờ duyệt', 'Зөвшөөрлүүдийг нээ', 'Відкрийте погодження'),
      body: t('Open Pending Approvals to review requests. Nothing will be approved automatically during this tour.', 'Nyisd meg a Függő jóváhagyásokat a kérésekhez. A tréning semmit sem hagy jóvá automatikusan.', 'Abre las solicitudes; la guía no aprueba nada.', 'Mở yêu cầu; hướng dẫn không tự duyệt.', 'Хүсэлтийг хар; сургалт зөвшөөрөл өгөхгүй.', 'Відкрийте запити; навчання нічого не погоджує.'),
      selector: '[data-training="manager-approvals-tab"]',
      subTab: 'manage',
      advanceOnClick: true,
    }),
    team({
      key: 'approval_queue',
      title: t('Review requests before deciding', 'Kérések ellenőrzése döntés előtt', 'Revisa antes de decidir', 'Xem xét trước khi duyệt', 'Шийдэхээс өмнө шалга', 'Перевірте запити перед рішенням'),
      body: t('Read the request and room context before approving or rejecting. If nothing is pending, skip this tip and continue your work.', 'Jóváhagyás vagy elutasítás előtt olvasd el a kérés és a szoba adatait. Ha nincs kérés, hagyd ki ezt a tippet.', 'Comprueba cada solicitud antes de aprobar o rechazar.', 'Xem kỹ trước khi chấp thuận hay từ chối.', 'Шийдэхээсээ өмнө хүсэлтээ шалга.', 'Читайте обставини перед погодженням або відхиленням.'),
      subTab: 'supervisor',
      selector: '#pending-approvals-list',
    }),
  ],
};
