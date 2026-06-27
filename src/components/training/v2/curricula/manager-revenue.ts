// Manager — Revenue module (top management / admin only)
//
// Note: ops vocabulary (ADR, RevPAR, pickup) is intentionally NOT translated.
import type { TrainingCurriculum } from '../types';

export const managerRevenueCurriculum: TrainingCurriculum = {
  slug: 'v2_manager_revenue',
  name: {
    en: 'Revenue Management',
    hu: 'Revenue Management',
    es: 'Revenue Management',
    vi: 'Revenue Management',
    mn: 'Revenue Management',
  },
  description: {
    en: '120-day grid, pickup vs ADR vs RevPAR, AI analyst suggestions and rate-plan mapping.',
    hu: '120 napos rács, pickup vs ADR vs RevPAR, AI elemző és árterv-leképezés.',
    es: 'Cuadrícula de 120 días, pickup vs ADR vs RevPAR y analista IA.',
    vi: 'Lưới 120 ngày, pickup vs ADR vs RevPAR và phân tích AI.',
    mn: '120 хоногийн хүснэгт, pickup/ADR/RevPAR, AI шинжээч.',
  },
  roles: ['top_management', 'top_management_manager', 'admin'],
  category: 'feature_promo',
  priority: 28,
  steps: [
    {
      key: 'open_revenue',
      title: {
        en: 'Open Revenue Management',
        hu: 'Revenue Management megnyitása',
        es: 'Abrir Revenue Management',
        vi: 'Mở Revenue Management',
        mn: 'Revenue Management нээх',
      },
      body: {
        en: 'Top tab "Revenue Management" opens the 120-day strategy grid for the selected hotel.',
        hu: 'A "Revenue Management" fül megnyitja a 120 napos stratégia rácsot.',
        es: 'La pestaña Revenue Management abre la cuadrícula de 120 días.',
        vi: 'Tab Revenue Management mở lưới chiến lược 120 ngày.',
        mn: '"Revenue Management" таб 120 хоногийн хүснэгтийг нээнэ.',
      },
      route: '/rdhotels/revenue',
    },
    {
      key: 'grid',
      title: {
        en: 'The 120-day grid',
        hu: 'A 120 napos rács',
        es: 'La cuadrícula de 120 días',
        vi: 'Lưới 120 ngày',
        mn: '120 хоногийн хүснэгт',
      },
      body: {
        en: 'Each cell is one date. Color encodes the recommended move: green = increase, red = decrease, grey = hold. A purple ring marks an event; deep red flags abnormal pickup.',
        hu: 'Minden cella egy nap. Zöld = emelés, piros = csökkentés, szürke = tartás, lila gyűrű = esemény.',
        es: 'Cada celda es un día. Verde = subir, rojo = bajar, gris = mantener.',
        vi: 'Mỗi ô là một ngày. Xanh = tăng, đỏ = giảm, xám = giữ.',
        mn: 'Нэг нүд = нэг өдөр. Ногоон = өсгөх, улаан = бууруулах, саарал = барих.',
      },
      route: '/rdhotels/revenue',
      selector: '[data-training="revenue-grid"]',
      precondition: 'hotel_selected',
    },
    {
      key: 'pickup_adr_revpar',
      title: {
        en: 'Pickup, ADR, RevPAR',
        hu: 'Pickup, ADR, RevPAR',
        es: 'Pickup, ADR, RevPAR',
        vi: 'Pickup, ADR, RevPAR',
        mn: 'Pickup, ADR, RevPAR',
      },
      body: {
        en: 'Pickup = net rooms booked in the last N days. ADR = revenue / sold rooms. RevPAR = revenue / available rooms. All three roll up across the date range you select.',
        hu: 'Pickup = utolsó N nap nettó foglalások. ADR = bevétel / eladott szoba. RevPAR = bevétel / összes szoba.',
        es: 'Pickup = reservas netas N días. ADR = ingresos/habitaciones vendidas. RevPAR = ingresos/habitaciones disponibles.',
        vi: 'Pickup = đặt phòng ròng N ngày. ADR = doanh thu/phòng bán. RevPAR = doanh thu/phòng có.',
        mn: 'Pickup = сүүлийн N хоногийн цэвэр захиалга. ADR = орлого/борлуулсан өрөө. RevPAR = орлого/нийт өрөө.',
      },
    },
    {
      key: 'ai_analyst',
      title: {
        en: 'AI Analyst — autopilot suggestions',
        hu: 'AI Elemző — autopilóta javaslatok',
        es: 'Analista IA — sugerencias del autopiloto',
        vi: 'Phân tích AI — gợi ý autopilot',
        mn: 'AI Шинжээч — autopilot санал',
      },
      body: {
        en: 'The analyst card lists every rate move it would make and why (pickup velocity, comp set, event). Tap "Run" to apply, or click a single suggestion to override before pushing to Previo.',
        hu: 'Az elemző felsorolja a javasolt árváltozásokat és indoklást — egyenként is felülbírálhatod.',
        es: 'El analista lista cada cambio sugerido con motivo — puedes anular antes de enviar.',
        vi: 'Phân tích liệt kê các thay đổi giá đề xuất kèm lý do — có thể ghi đè.',
        mn: 'Шинжээч санал бүрийг шалтгаантай харуулна — Previo руу илгээхээс өмнө засаж болно.',
      },
      route: '/rdhotels/revenue',
      selector: '[data-training="ai-analyst-card"]',
      optional: true,
    },
    {
      key: 'rate_plans',
      title: {
        en: 'Strategy calendar & rate-plan mapping',
        hu: 'Stratégia naptár és árterv-leképezés',
        es: 'Calendario y mapeo de planes de tarifa',
        vi: 'Lịch chiến lược & ánh xạ rate plan',
        mn: 'Стратеги хуанли ба rate plan тохиргоо',
      },
      body: {
        en: 'Settings → Rate Plans maps each Previo rate plan to a base price + derivation rule (% off BAR, fixed delta, etc.). The grid uses that mapping when it pushes rates.',
        hu: 'Beállítások → Árterv: minden Previo árterv leképezése alapárra és szabályra.',
        es: 'Ajustes → Planes: mapea cada plan Previo a precio base y regla.',
        vi: 'Cài đặt → Rate Plan: ánh xạ mỗi plan Previo về giá gốc + quy tắc.',
        mn: 'Тохиргоо → Rate Plan: Previo plan тус бүрийг үндсэн үнэ ба дүрэмд хуваарилна.',
      },
    },
  ],
};
