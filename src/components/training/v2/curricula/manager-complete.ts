// Manager Complete Walkthrough — the auto-started first-login tour that
// stitches every manager module into one continuous flow via the engine's
// `chain` mechanism. Each linked child curriculum remains independently
// launchable from the Training Center for on-demand replay.
import type { TrainingCurriculum } from '../types';

export const managerCompleteCurriculum: TrainingCurriculum = {
  slug: 'v2_manager_complete_walkthrough',
  name: {
    en: 'Manager Complete Walkthrough',
    hu: 'Vezetői Teljes Bemutató',
    es: 'Recorrido Completo del Gerente',
    vi: 'Hướng dẫn Đầy đủ cho Quản lý',
    mn: 'Менежерийн Бүрэн Танилцуулга',
    uk: 'Повний огляд для менеджера',
  },
  description: {
    en: 'End-to-end tour that flows through HR, PMS upload, team view, staff and every module — one module after another.',
    hu: 'Végigvezet a HR-en, PMS-feltöltésen, csapat nézeten, munkatársakon és minden modulon — egymás után.',
    es: 'Recorrido completo por HR, carga PMS, vista de equipo, personal y cada módulo — uno tras otro.',
    vi: 'Đi qua HR, tải PMS, xem đội, nhân viên và mọi mô-đun — từng cái một.',
    mn: 'HR, PMS оруулах, багийн харагдац, ажилтан болон бүх модулиар нэг нэгээр явна.',
    uk: 'Наскрізний огляд: HR, завантаження PMS, команда, персонал та кожен модуль — по черзі.',
  },
  roles: [
    'manager',
    'housekeeping_manager',
    'maintenance_manager',
    'reception_manager',
    'admin',
    'top_management',
    'top_management_manager',
  ],
  category: 'core',
  priority: 3,
  isFullWalkthrough: true,
  module: {
    en: 'Full Walkthrough',
    hu: 'Teljes bemutató',
    es: 'Recorrido completo',
    vi: 'Toàn bộ hướng dẫn',
    mn: 'Бүрэн танилцуулга',
    uk: 'Повний огляд',
  },
  chain: [
    'v2_manager_attendance_and_payroll',
    'v2_manager_reception_handover',
    'v2_manager_team_and_assignments',
    'v2_manager_tickets_and_sla',
    'v2_manager_revenue',
    'v2_manager_purchase_invoices',
  ],
  steps: [
    {
      key: 'welcome',
      title: {
        en: 'Welcome — full manager walkthrough',
        hu: 'Üdv — teljes vezetői bemutató',
        es: 'Bienvenido — recorrido completo',
        vi: 'Chào mừng — hướng dẫn đầy đủ',
        mn: 'Тавтай морил — бүрэн танилцуулга',
        uk: 'Ласкаво просимо — повний огляд для менеджера',
      },
      body: {
        en: 'We will move through every module one after another: HR & Attendance, PMS Upload, Team View, Tickets, Revenue and Invoices. You can pause any time — we resume where you left off.',
        hu: 'Sorra megyünk minden modulon: HR, PMS-feltöltés, Csapat, Hibajegyek, Bevétel, Számlák. Bármikor szüneteltetheted — onnan folytatjuk, ahol abbahagytad.',
        es: 'Recorremos cada módulo: HR, carga PMS, Vista de equipo, Tickets, Ingresos, Facturas. Pausa cuando quieras — retomamos donde lo dejaste.',
        vi: 'Đi qua từng mô-đun: HR, tải PMS, Xem đội, Phiếu, Doanh thu, Hóa đơn. Có thể tạm dừng bất cứ lúc nào — sẽ tiếp tục từ chỗ dừng.',
        mn: 'Модуль бүрээр явна: HR, PMS оруулах, Багийн харагдац, Тасалбар, Орлого, Нэхэмжлэх. Хүссэн үедээ түр зогсоож болно — үлдсэн хэсгээс үргэлжлүүлнэ.',
        uk: 'Пройдемо кожен модуль: HR, завантаження PMS, Команда, Заявки, Дохід, Рахунки. Можна зупинити будь-коли — продовжимо з місця зупинки.',
      },
      route: '/:org',
    },
    {
      key: 'help_button',
      title: {
        en: 'Replay any module anytime',
        hu: 'Bármelyik modult újra lefuttathatod',
        es: 'Repite cualquier módulo cuando quieras',
        vi: 'Phát lại bất kỳ mô-đun nào',
        mn: 'Аль ч модулийг дахин үзэх',
        uk: 'Повторюйте будь-який модуль коли завгодно',
      },
      body: {
        en: 'The Help button always opens the Training Center. Every module we go through today lives there — replay individually whenever you want.',
        hu: 'A Súgó gomb megnyitja a Tananyagokat — a mai modulok mind ott vannak, bármikor újranézheted.',
        es: 'El botón de Ayuda abre el Centro de Formación — todos los módulos siguen ahí para repetir.',
        vi: 'Nút Trợ giúp mở Trung tâm đào tạo — mọi mô-đun đều có thể xem lại.',
        mn: 'Тусламж товч Сургалтын төвийг нээнэ — бүх модулийг эндээс дахин үзэж болно.',
        uk: 'Кнопка Довідка відкриває Навчальний центр — усі сьогоднішні модулі там, повторюйте окремо.',
      },
      route: '/:org',
      selector: '[data-training="help-button"]',
      optional: true,
    },
  ],
};
