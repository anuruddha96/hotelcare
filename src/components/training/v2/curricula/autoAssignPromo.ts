// One-time Auto-Assign feature promo for managers
import type { TrainingCurriculum } from '../types';

export const autoAssignPromo: TrainingCurriculum = {
  slug: 'v2_promo_auto_assign',
  name: {
    en: 'New: Auto-Assign',
    hu: 'Új: Auto-Hozzárendelés',
    es: 'Nuevo: Auto-Asignar',
    vi: 'Mới: Tự động phân công',
    mn: 'Шинэ: Автомат хуваарилалт',
  },
  description: {
    en: 'A 30-second look at the feature that saves you 20 minutes every morning.',
    hu: '30 másodperces bemutató az új funkcióról.',
    es: 'Un vistazo de 30 segundos a la nueva función.',
    vi: 'Xem 30 giây tính năng mới.',
    mn: '30 секундын танилцуулга.',
  },
  roles: [
    'housekeeping_manager',
    'manager',
    'admin',
    'top_management',
    'top_management_manager',
  ],
  category: 'feature_promo',
  priority: 5,
  moduleKey: 'housekeeping',
  estMinutes: 1,
  steps: [
    {
      key: 'pitch',
      title: {
        en: '✨ Auto-Assign saves 20 min/day',
        hu: '✨ Az Auto-Hozzárendelés napi 20 percet spórol',
        es: '✨ Auto-Asignar ahorra 20 min/día',
        vi: '✨ Tự động phân công tiết kiệm 20 phút/ngày',
        mn: '✨ Өдөрт 20 минут хэмнэнэ',
      },
      body: {
        en: 'Distribute today\'s rooms across your team in one click. Capacity, room priorities and No-Service rules are respected automatically.',
        hu: 'Egy kattintással szétosztja a mai szobákat a csapatban.',
        es: 'Distribuye las habitaciones de hoy con un clic.',
        vi: 'Phân phối phòng hôm nay chỉ với một cú nhấp.',
        mn: 'Нэг товшилтоор өнөөдрийн өрөөнүүдийг хуваарилна.',
      },
    },
    {
      key: 'open_team',
      title: {
        en: 'Open Team View',
        hu: 'Nyisd meg a Csapat nézetet',
        es: 'Abre Vista del equipo',
        vi: 'Mở Xem nhóm',
        mn: 'Багийн харагдацыг нээ',
      },
      body: {
        en: 'The Auto-Assign button lives at the top of Team View, next to the date.',
        hu: 'Az Auto-Hozzárendelés gomb a Csapat nézet tetején van.',
        es: 'El botón Auto-Asignar está en la parte superior de Vista del equipo.',
        vi: 'Nút Tự động phân công ở đầu Xem nhóm.',
        mn: 'Автомат хуваарилалт товч Багийн харагдацын дээд талд.',
      },
      route: '/:org',
      tab: 'housekeeping',
      selector: '[data-training="team-view"]',
      optional: true,
    },
    {
      key: 'spotlight_button',
      title: {
        en: 'This is the button',
        hu: 'Ez a gomb',
        es: 'Este es el botón',
        vi: 'Đây là nút',
        mn: 'Энэ товч',
      },
      body: {
        en: 'Press it whenever you want a fresh distribution. You can still drag, drop, or change priority afterwards.',
        hu: 'Bármikor megnyomhatod. Utána is mozgathatsz szobákat.',
        es: 'Púlsalo cuando quieras. Aún puedes mover habitaciones después.',
        vi: 'Bấm bất cứ lúc nào. Bạn vẫn có thể di chuyển phòng sau.',
        mn: 'Хүссэн үедээ дар. Дараа нь өөрчилж болно.',
      },
      route: '/:org',
      tab: 'housekeeping',
      selector: '[data-training="auto-assign-btn"]',
      optional: true,
    },
    {
      key: 'done',
      title: {
        en: 'You\'re ready',
        hu: 'Készen állsz',
        es: 'Listo',
        vi: 'Sẵn sàng',
        mn: 'Бэлэн',
      },
      body: {
        en: 'You won\'t see this promo again. Find it any time in Help → Auto-Assign.',
        hu: 'Ezt a promót többé nem látod. A Súgóban bármikor elérhető.',
        es: 'No verás esta promoción de nuevo. En Ayuda siempre disponible.',
        vi: 'Bạn sẽ không thấy lại quảng cáo này.',
        mn: 'Энэ сурталчилгааг дахин харахгүй.',
      },
    },
  ],
};
