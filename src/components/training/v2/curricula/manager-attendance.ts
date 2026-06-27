// Manager — Attendance & payroll module
import type { TrainingCurriculum } from '../types';

export const managerAttendanceCurriculum: TrainingCurriculum = {
  slug: 'v2_manager_attendance_and_payroll',
  name: {
    en: 'Attendance & Payroll',
    hu: 'Jelenlét és Bérszámfejtés',
    es: 'Asistencia y Nómina',
    vi: 'Chấm công & Lương',
    mn: 'Ирц ба Цалин',
  },
  description: {
    en: 'Live attendance, daily timesheet, approvals and payroll export.',
    hu: 'Élő jelenlét, napi munkaidő, jóváhagyások és bérexport.',
    es: 'Asistencia en vivo, parte diario, aprobaciones y exportación.',
    vi: 'Chấm công thời gian thực, bảng chấm công, phê duyệt, xuất lương.',
    mn: 'Шууд ирц, өдрийн цаг, зөвшөөрөл, цалин экспорт.',
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
  category: 'feature_promo',
  priority: 26,
  steps: [
    {
      key: 'live_attendance',
      title: {
        en: 'Who is on right now',
        hu: 'Ki van most műszakban',
        es: 'Quién está en turno ahora',
        vi: 'Ai đang trong ca',
        mn: 'Одоо ажиллаж буй хүмүүс',
      },
      body: {
        en: 'Live grid of everyone signed in, on break or signed out. Refreshes in real time as staff slide in/out.',
        hu: 'Élő rács — ki van bejelentkezve, ki szünetel, ki ment haza.',
        es: 'Cuadrícula en vivo — quién entró, descansa o cerró sesión.',
        vi: 'Lưới thời gian thực — ai đang vào / nghỉ / ra ca.',
        mn: 'Шууд хүснэгт — хэн нэвтэрсэн, амарч буй, гарсан.',
      },
      tab: 'attendance',
      selector: '[data-training="attendance-tab"]',
    },
    {
      key: 'daily_timesheet',
      title: {
        en: 'Daily timesheet',
        hu: 'Napi munkaidő',
        es: 'Parte diario de horas',
        vi: 'Bảng chấm công ngày',
        mn: 'Өдрийн цагийн хуудас',
      },
      body: {
        en: 'Per-staff start, breaks, end and total hours for any day. Click a row to see the location pings and any manual corrections.',
        hu: 'Munkavállalónként kezdés, szünetek, vége és összóra napokra bontva.',
        es: 'Por empleado: entrada, pausas, salida y horas totales.',
        vi: 'Theo nhân viên: vào, nghỉ, ra, tổng giờ.',
        mn: 'Ажилтан тус бүрийн орох, амрах, гарах, нийт цаг.',
      },
      tab: 'attendance',
    },
    {
      key: 'approvals',
      title: {
        en: 'Approve early sign-outs & corrections',
        hu: 'Korai kijelentkezések jóváhagyása',
        es: 'Aprobar salidas anticipadas',
        vi: 'Duyệt yêu cầu ra ca sớm',
        mn: 'Эрт гарах хүсэлт батлах',
      },
      body: {
        en: 'When a housekeeper requests early sign-out or a time correction, you get a banner here. One tap approves; the timesheet updates instantly.',
        hu: 'Korai kijelentkezés vagy időkorrekció kérés esetén itt jelenik meg — egy koppintás jóváhagyás.',
        es: 'Cuando alguien pide salir antes o corregir hora, aparece aquí — un toque aprueba.',
        vi: 'Yêu cầu ra sớm hoặc chỉnh giờ hiện ở đây — một chạm để duyệt.',
        mn: 'Эрт гарах эсвэл цаг засах хүсэлт энд гарна — нэг товшилтоор зөвшөөрнө.',
      },
      tab: 'housekeeping',
      selector: '[data-training="pending-approvals"]',
      optional: true,
    },
    {
      key: 'payroll_export',
      title: {
        en: 'Export for payroll',
        hu: 'Bérexport',
        es: 'Exportar para nómina',
        vi: 'Xuất cho bộ phận lương',
        mn: 'Цалинд экспортлох',
      },
      body: {
        en: 'Pick a date range and download CSV per staff member — total hours, breaks and overtime broken out, ready for payroll.',
        hu: 'Válassz időszakot és tölts le CSV-t — összóra, szünetek, túlóra.',
        es: 'Elige rango y descarga CSV — horas, pausas y horas extra.',
        vi: 'Chọn khoảng ngày và tải CSV — tổng giờ, nghỉ, OT.',
        mn: 'Огнооны муж сонгож CSV татах — нийт цаг, амралт, нэмэлт цаг.',
      },
    },
  ],
};
