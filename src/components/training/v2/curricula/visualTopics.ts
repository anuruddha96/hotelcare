import type { I18nText, RoleKey, TrainingCurriculum, TrainingModuleKey, TrainingStepV2 } from '../types';

export const words = (en: string, hu: string, es: string, vi: string, mn: string, uk: string): Required<I18nText> =>
  ({ en, hu, es, vi, mn, uk });

const housekeepingLeads: RoleKey[] = ['housekeeping_manager', 'manager', 'admin', 'top_management', 'top_management_manager'];
const maintenanceLeads: RoleKey[] = ['maintenance_manager', 'manager', 'admin', 'top_management', 'top_management_manager'];
const receptionLeads: RoleKey[] = ['reception_manager', 'manager', 'admin', 'top_management', 'top_management_manager'];
const reception: RoleKey[] = ['reception', 'front_office', ...receptionLeads];
const atTeam = { route: '/:org', tab: 'housekeeping', subTab: 'manage' };
const atTickets = { route: '/:org', tab: 'tickets' };
const atMaintenance = { route: '/:org', tab: 'maintenance-tasks' };
const atReception = { route: '/:org/reception' };

function cue(
  key: string, selector: string, title: Required<I18nText>, options: Partial<TrainingStepV2> = {},
): TrainingStepV2 {
  return { key, selector, title, body: title, withinWorkflow: !options.route && !options.tab, ...options };
}

function topic(
  slug: string, name: Required<I18nText>, roles: RoleKey[], moduleKey: TrainingModuleKey,
  steps: TrainingStepV2[], options: Partial<TrainingCurriculum> = {},
): TrainingCurriculum {
  return {
    slug, name, roles, moduleKey, steps, description: name, shortTopic: true,
    category: 'feature_promo', priority: 10, ...options,
  };
}

const team = cue('team', '[data-training="manager-team-tab"]', words(
  'Open Team View', 'Nyisd meg a Csapatnézetet', 'Abre Vista del equipo', 'Mở Chế độ xem đội', 'Багийн харагдацыг нээ', 'Відкрийте перегляд команди',
), { route: '/:org', tab: 'housekeeping', advanceOnClick: true });

const openRoom = atTeam;
const openAutoAssign = cue('open', '[data-training="auto-assign-btn"]', words(
  'Open Auto Assign', 'Nyisd meg az Automatikus kiosztást', 'Abre Asignación automática', 'Mở Phân công tự động', 'Автомат хуваарилалтыг нээ', 'Відкрийте авторозподіл',
), { ...atTeam, advanceOnClick: true, optional: true });

const myRooms = { route: '/:org', tab: 'housekeeping' };

export const visualTopics: TrainingCurriculum[] = [
  topic('visual_housekeeper_start', words(
    'Start your shift and find your rooms', 'Műszak indítása és a szobák megkeresése', 'Iniciar el turno y ver las habitaciones', 'Bắt đầu ca và tìm phòng', 'Ээлжээ эхэлж, өрөөгөө ол', 'Почати зміну й знайти свої номери',
  ), ['housekeeping'], 'housekeeping', [
    cue('clock', '[data-training="check-in-button"] [data-training="swipe-action-track"]', words(
      'Swipe to clock in when your shift starts', 'A műszak kezdetén húzd el a belépéshez', 'Desliza para fichar al empezar el turno', 'Vuốt để chấm công khi bắt đầu ca', 'Ээлж эхлэхэд шударч бүртгүүл', 'Проведіть для відмітки на початку зміни',
    ), { route: '/:org', tab: 'attendance', skipWhen: 'is_signed_in', optional: true }),
    cue('tasks', '[data-training="housekeeping-tab"]', words(
      'Open My Tasks', 'Nyisd meg a Saját feladatokat', 'Abre Mis tareas', 'Mở Nhiệm vụ của tôi', 'Миний даалгаврыг нээ', 'Відкрийте «Мої завдання»',
    ), { ...myRooms, advanceOnClick: true }),
    cue('rooms', '[data-training="assigned-room-card"]', words(
      'Find your assigned rooms here', 'Itt találod a rád osztott szobákat', 'Aquí están tus habitaciones asignadas', 'Xem các phòng được phân công tại đây', 'Хуваарилсан өрөөнүүдээ эндээс хар', 'Тут ваші призначені номери',
    ), myRooms),
  ], { onboarding: true, replaces: ['v2_housekeeper_first_day'] }),
  topic('visual_housekeeper_clean', words(
    'Start cleaning a room', 'Szobatakarítás indítása', 'Iniciar la limpieza de una habitación', 'Bắt đầu dọn phòng', 'Өрөө цэвэрлэж эхлэх', 'Почати прибирання номера',
  ), ['housekeeping'], 'housekeeping', [
    cue('start', '[data-training="start-room-button"]', words(
      'Start only when the room is ready to clean', 'Csak takarításra kész szobában indítsd el a munkát', 'Empieza cuando la habitación esté lista para limpiar', 'Chỉ bắt đầu khi phòng đã sẵn sàng để dọn', 'Өрөө цэвэрлэхэд бэлэн болсон үед эхэл', 'Починайте, коли номер готовий до прибирання',
    ), { ...myRooms, optional: true }),
  ], { replaces: ['v2_housekeeper_first_day'] }),
  topic('visual_housekeeper_finish', words(
    'Finish a room', 'Szoba takarításának befejezése', 'Terminar una habitación', 'Hoàn tất dọn phòng', 'Өрөөний цэвэрлэгээ дуусгах', 'Завершити прибирання номера',
  ), ['housekeeping'], 'housekeeping', [
    cue('finish', '[data-training="active-assigned-room"] [data-training="complete-room-button"]', words(
      'Mark complete when the room is ready', 'Jelöld késznek, ha a szoba elkészült', 'Marca como lista cuando termines', 'Đánh dấu hoàn tất khi phòng đã sẵn sàng', 'Өрөө бэлэн бол дууссан гэж тэмдэглэ', 'Позначте виконаним, коли номер готовий',
    ), myRooms),
  ], { replaces: ['v2_housekeeper_first_day'] }),
  topic('visual_housekeeping_auto_assign', words(
    'Automatically assign rooms', 'Szobák automatikus kiosztása', 'Asignar habitaciones automáticamente', 'Tự động phân công phòng', 'Өрөөг автоматаар хуваарилах', 'Автоматично розподілити номери',
  ), housekeepingLeads, 'housekeeping', [
    team,
    openAutoAssign,
    cue('preview', '[data-training="auto-assign-preview"]', words(
      'Select the team, then generate a preview', 'Válaszd ki a csapatot, majd készíts előnézetet', 'Selecciona al equipo y genera una vista previa', 'Chọn nhân viên rồi tạo bản xem trước', 'Багаа сонгоод урьдчилан хар', 'Виберіть команду й створіть попередній план',
    ), { advanceOnTarget: '[data-training="auto-assign-review"], [data-training="auto-assign-publish"]' }),
    cue('review', '[data-training="auto-assign-review"]', words(
      'Review the room assignments', 'Ellenőrizd a szobakiosztást', 'Revisa la asignación de habitaciones', 'Kiểm tra phân công phòng', 'Өрөөний хуваарилалтыг шалга', 'Перевірте розподіл номерів',
    ), { advanceOnTarget: '[data-training="auto-assign-publish"]', optional: true, skipIfTarget: '[data-training="auto-assign-publish"]' }),
    cue('publish', '[data-training="auto-assign-publish"]', words(
      'Confirm only when ready to assign', 'Csak akkor erősítsd meg, ha végleges a kiosztás', 'Confirma cuando la asignación esté lista', 'Chỉ xác nhận khi đã sẵn sàng phân công', 'Хуваарилалт бэлэн болсон үед баталгаажуул', 'Підтверджуйте, коли розподіл готовий',
    )),
  ], { onboarding: true, replaces: ['v2_manager_team_and_assignments', 'v2_promo_auto_assign'] }),
  topic('visual_housekeeping_staff', words(
    'Manage housekeeping staff', 'Takarítók kezelése', 'Gestionar al personal de limpieza', 'Quản lý nhân viên buồng phòng', 'Үйлчилгээний ажилтнуудыг удирдах', 'Керувати працівниками прибирання',
  ), housekeepingLeads, 'housekeeping', [
    cue('staff', '[data-training="manager-staff-tab"]', words(
      'Open Staff Management', 'Nyisd meg a Munkatársak kezelése fület', 'Abre Gestión de personal', 'Mở Quản lý nhân viên', 'Ажилтны удирдлагыг нээ', 'Відкрийте керування персоналом',
    ), { route: '/:org', tab: 'housekeeping', subTab: 'staff-management', advanceOnClick: true }),
    cue('add', '[data-training="housekeeping-add-staff"]', words(
      'Open Add Staff', 'Nyisd meg az Új munkatárs űrlapját', 'Abre Añadir personal', 'Mở Thêm nhân viên', 'Ажилтан нэмэхийг нээ', 'Відкрийте додавання працівника',
    ), { advanceOnClick: true }),
    cue('form', '[data-training="housekeeping-create-staff"]', words(
      'Save when the staff details are ready', 'Mentsd el, ha kész a munkatárs adatlapja', 'Guarda cuando estén listos los datos', 'Lưu khi đã đủ thông tin nhân viên', 'Ажилтны мэдээлэл бэлэн бол хадгал', 'Збережіть, коли дані працівника готові',
    )),
  ]),
  topic('visual_housekeeping_room_dirty', words(
    'Mark a room dirty', 'Szoba piszkosra állítása', 'Marcar una habitación como sucia', 'Đánh dấu phòng bẩn', 'Өрөөг бохир гэж тэмдэглэх', 'Позначити номер брудним',
  ), housekeepingLeads, 'housekeeping', [
    team,
    cue('room', '[data-training="room-actions-menu"][data-room-status="clean"]', words(
      'Open actions for a clean room', 'Nyisd meg egy tiszta szoba műveleteit', 'Abre las acciones de una habitación limpia', 'Mở thao tác của phòng sạch', 'Цэвэр өрөөний үйлдлийг нээ', 'Відкрийте дії для чистого номера',
    ), { ...openRoom, advanceOnTarget: '[data-training="room-mark-dirty"]' }),
    cue('dirty', '[data-training="room-mark-dirty"]', words(
      'Find Mark as Dirty', 'Itt jelölheted piszkosnak', 'Localiza Marcar como sucia', 'Tìm Đánh dấu phòng bẩn', 'Бохир гэж тэмдэглэхийг ол', 'Знайдіть «Позначити брудним»',
    )),
  ]),
  topic('visual_housekeeping_room_checkout', words(
    'Switch a room to checkout cleaning', 'Szoba átállítása távozó takarításra', 'Cambiar a limpieza de salida', 'Chuyển sang dọn phòng trả', 'Гарах өрөөний цэвэрлэгээнд шилжүүлэх', 'Перевести номер на прибирання після виїзду',
  ), housekeepingLeads, 'housekeeping', [
    team,
    cue('room', '[data-training="room-actions-menu"][data-room-type="daily"]', words(
      'Open actions for a stayover room', 'Nyisd meg egy maradó szoba műveleteit', 'Abre las acciones de una habitación ocupada', 'Mở thao tác của phòng đang lưu trú', 'Үргэлжлүүлэн байрлах өрөөний үйлдлийг нээ', 'Відкрийте дії для номера з подовженим проживанням',
    ), { ...openRoom, advanceOnTarget: '[data-training="room-switch-checkout"]' }),
    cue('checkout', '[data-training="room-switch-checkout"]', words(
      'Find Switch to Checkout', 'Itt állíthatod távozóra', 'Localiza Cambiar a salida', 'Tìm Chuyển sang phòng trả', 'Гарах өрөө рүү шилжүүлэхийг ол', 'Знайдіть «Перевести на виїзд»',
    )),
  ]),
  topic('visual_housekeeping_ready', words(
    'Release a checkout room for cleaning', 'Távozó szoba átadása takarításra', 'Liberar una habitación de salida para limpieza', 'Bàn giao phòng trả để dọn', 'Гарсан өрөөг цэвэрлэгээнд шилжүүлэх', 'Передати номер після виїзду на прибирання',
  ), housekeepingLeads, 'housekeeping', [
    team,
    cue('room', '[data-training="room-actions-menu"][data-room-type="checkout"]', words(
      'Open the checkout room actions', 'Nyisd meg a távozó szoba műveleteit', 'Abre las acciones de la habitación de salida', 'Mở thao tác của phòng trả', 'Гарсан өрөөний үйлдлийг нээ', 'Відкрийте дії номера після виїзду',
    ), { ...openRoom, advanceOnTarget: '[data-training="room-ready-to-clean"]' }),
    cue('ready', '[data-training="room-ready-to-clean"]', words(
      'Mark Ready to Clean after the guest leaves', 'A vendég távozása után jelöld takaríthatónak', 'Marca Lista para limpiar cuando se vaya el huésped', 'Đánh dấu sẵn sàng dọn sau khi khách rời đi', 'Зочин гарсны дараа цэвэрлэхэд бэлэн гэж тэмдэглэ', 'Позначте готовим до прибирання після виїзду гостя',
    )),
  ]),
  topic('visual_maintenance_report', words(
    'Report a maintenance issue', 'Karbantartási hiba bejelentése', 'Notificar una avería', 'Báo sự cố bảo trì', 'Засварын асуудал мэдээлэх', 'Повідомити про несправність',
  ), ['housekeeping', 'reception_manager', 'maintenance', ...maintenanceLeads, 'housekeeping_manager'], 'maintenance', [
    cue('new', '[data-training="maintenance-report"]', words(
      'Open New issue', 'Nyisd meg az Új hibajegyet', 'Abre Nueva incidencia', 'Mở Sự cố mới', 'Шинэ асуудал нээ', 'Відкрийте нову заявку',
    ), { ...atTickets, advanceOnClick: true }),
    cue('location', '[data-training="maintenance-location"]', words(
      'Choose a room or enter a location', 'Válassz szobát vagy add meg a helyszínt', 'Elige habitación o indica el lugar', 'Chọn phòng hoặc nhập vị trí', 'Өрөө сонго эсвэл байршил оруул', 'Виберіть номер або введіть місце',
    )),
    cue('details', '[data-training="maintenance-description"]', words(
      'Add a title and describe the fault', 'Adj címet és írd le a hibát', 'Añade un título y describe la avería', 'Thêm tiêu đề và mô tả lỗi', 'Гарчиг өгөөд гэмтлийг тайлбарла', 'Додайте назву й опишіть несправність',
    )),
    cue('send', '[data-training="maintenance-submit"]', words(
      'Send when the details are ready', 'Küldd el, ha kész az adatlap', 'Envía cuando estén listos los datos', 'Gửi khi thông tin đã đầy đủ', 'Мэдээлэл бэлэн бол илгээ', 'Надішліть, коли все заповнено',
    )),
  ]),
  topic('visual_maintenance_work', words(
    'Start a maintenance task', 'Karbantartási munka indítása', 'Empezar una tarea de mantenimiento', 'Bắt đầu công việc bảo trì', 'Засварын ажил эхлүүлэх', 'Почати роботу над заявкою',
  ), ['maintenance'], 'maintenance', [
    cue('tasks', '[data-training="maintenance-tasks-tab"]', words(
      'Open My Tasks', 'Nyisd meg a Saját feladatokat', 'Abre Mis tareas', 'Mở Nhiệm vụ của tôi', 'Миний даалгаврыг нээ', 'Відкрийте «Мої завдання»',
    ), { ...atMaintenance, advanceOnClick: true }),
    cue('start', '[data-training="maintenance-start"]', words(
      'Find Start on your task', 'Keresd az Indítás gombot a feladatnál', 'Localiza Iniciar en tu tarea', 'Tìm Bắt đầu trên nhiệm vụ', 'Даалгаврын Эхлэх товчийг ол', 'Знайдіть «Почати» у своєму завданні',
    )),
  ], { onboarding: true }),
  topic('visual_maintenance_complete', words(
    'Complete a repair', 'Javítás lezárása', 'Completar una reparación', 'Hoàn tất sửa chữa', 'Засварыг дуусгах', 'Завершити ремонт',
  ), ['maintenance'], 'maintenance', [
    cue('open', '[data-training="maintenance-complete"]', words(
      'Open Complete on the task', 'Nyisd meg a Lezárást a feladatnál', 'Abre Completar en la tarea', 'Mở Hoàn tất trên nhiệm vụ', 'Даалгаврын Дуусгахыг нээ', 'Відкрийте «Завершити» у завданні',
    ), { ...atMaintenance, advanceOnClick: true }),
    cue('resolution', '[data-training="maintenance-resolution"]', words(
      'Add the repair note and choose a photo option', 'Írd le a javítást, majd válassz fotólehetőséget', 'Describe la reparación y elige una opción de foto', 'Ghi nội dung sửa chữa và chọn tùy chọn ảnh', 'Засвараа тэмдэглээд зургийн сонголтоо хий', 'Опишіть ремонт і виберіть варіант фото',
    )),
    cue('submit', '[data-training="maintenance-finish"]', words(
      'Submit when the repair is complete', 'Küldd be a javítás befejezése után', 'Envía al terminar la reparación', 'Gửi khi đã sửa xong', 'Засвар дуусмагц илгээ', 'Надішліть після завершення ремонту',
    )),
  ]),
  topic('visual_maintenance_dispatch', words(
    'Assign a maintenance ticket', 'Karbantartási hibajegy kiosztása', 'Asignar una incidencia', 'Phân công phiếu bảo trì', 'Засварын хүсэлт хуваарилах', 'Призначити заявку на ремонт',
  ), maintenanceLeads, 'maintenance', [
    cue('ticket', '[data-training="ticket-row"] [data-training="ticket-card"]', words(
      'Open the ticket to assign', 'Nyisd meg a kiosztandó hibajegyet', 'Abre la incidencia que quieres asignar', 'Mở phiếu cần phân công', 'Хуваарилах хүсэлтээ нээ', 'Відкрийте заявку для призначення',
    ), { ...atTickets, advanceOnClick: true, optional: true }),
    cue('assign', '[data-training="ticket-assign-select"]', words(
      'Find the technician selector', 'Itt választhatsz szerelőt', 'Localiza el selector de técnico', 'Tìm mục chọn kỹ thuật viên', 'Засварчин сонгох хэсгийг ол', 'Знайдіть вибір техніка',
    )),
  ], { onboarding: true }),
  topic('visual_reception_checkin', words(
    'Check in a guest', 'Vendég bejelentkeztetése', 'Registrar la llegada de un huésped', 'Làm thủ tục nhận phòng', 'Зочин бүртгэх', 'Зареєструвати заїзд гостя',
  ), reception, 'reception', [
    cue('open', '[data-training="fd-checkin-button"]', words(
      'Open Check In for an arrival', 'Nyisd meg egy érkező vendég bejelentkeztetését', 'Abre Registrar llegada para una reserva', 'Mở Nhận phòng cho khách đến', 'Ирэх зочны бүртгэлийг нээ', 'Відкрийте реєстрацію заїзду',
    ), { ...atReception, advanceOnClick: true }),
    cue('room', '[data-training="fd-checkin-room-select"]', words(
      'Check the room and guest details', 'Ellenőrizd a szobát és a vendégadatokat', 'Revisa la habitación y los datos del huésped', 'Kiểm tra phòng và thông tin khách', 'Өрөө болон зочны мэдээллийг шалга', 'Перевірте номер і дані гостя',
    ), { optional: true }),
    cue('confirm', '[data-training="fd-checkin-confirm"]', words(
      'Confirm when the guest is ready', 'Erősítsd meg, ha a vendég készen áll', 'Confirma cuando el huésped esté listo', 'Xác nhận khi khách đã sẵn sàng', 'Зочин бэлэн бол баталгаажуул', 'Підтвердіть, коли гість готовий',
    )),
  ], { onboarding: true }),
  topic('visual_reception_checkout', words(
    'Check out a guest', 'Vendég kijelentkeztetése', 'Registrar la salida de un huésped', 'Làm thủ tục trả phòng', 'Зочны гаралтыг бүртгэх', 'Зареєструвати виїзд гостя',
  ), reception, 'reception', [
    cue('open', '[data-training="fd-checkout-button"]', words(
      'Open Check Out for a departure', 'Nyisd meg egy távozó vendég kijelentkeztetését', 'Abre Registrar salida para una reserva', 'Mở Trả phòng cho khách rời đi', 'Гарах зочны бүртгэлийг нээ', 'Відкрийте реєстрацію виїзду',
    ), { ...atReception, advanceOnClick: true }),
    cue('confirm', '[data-training="fd-checkout-confirm"]', words(
      'Review the balance before confirming', 'Megerősítés előtt ellenőrizd az egyenleget', 'Revisa el saldo antes de confirmar', 'Kiểm tra số dư trước khi xác nhận', 'Батлахаас өмнө төлбөрийн үлдэгдлийг шалга', 'Перевірте залишок перед підтвердженням',
    )),
  ]),
  topic('visual_reception_supervisor', words(
    'Review the reception reports', 'Recepciós riportok ellenőrzése', 'Revisar los informes de recepción', 'Xem báo cáo lễ tân', 'Ресепшний тайланг шалгах', 'Переглянути звіти рецепції',
  ), receptionLeads, 'reception', [
    cue('daily', '[data-training="reception-report-daily"]', words(
      'Review the daily report', 'Nézd át a napi riportot', 'Revisa el informe diario', 'Xem báo cáo hằng ngày', 'Өдрийн тайланг шалга', 'Перегляньте щоденний звіт',
    ), { route: '/:org/reception/reports' }),
  ], { onboarding: true, priority: 8 }),
];
