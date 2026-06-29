// Manager Orientation — the only manager curriculum that auto-starts.
//
// This replaces the old monolithic `v2_manager_run_your_day` tour. Every
// other manager topic now lives in its own module file
// (manager-team.ts, manager-tickets.ts, …) and is offered as a recommended
// next step in the Training Center.
import type { TrainingCurriculum } from '../types';

export const managerOrientationCurriculum: TrainingCurriculum = {
  slug: 'v2_manager_orientation',
  name: {
    en: 'Manager Orientation',
    hu: 'Vezetői Tájékoztató',
    es: 'Orientación del Gerente',
    vi: 'Định hướng Quản lý',
    mn: 'Менежерийн Танилцуулга',
  },
  description: {
    en: '60-second tour of the controls every manager uses on every screen.',
    hu: '60 másodperces áttekintés a vezetők által minden képernyőn használt vezérlőkről.',
    es: 'Recorrido de 60 segundos por los controles que todo gerente usa.',
    vi: 'Tham quan 60 giây các điều khiển mọi quản lý dùng.',
    mn: 'Менежер бүрийн ашигладаг үндсэн хяналтын 60 секундын танилцуулга.',
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
  priority: 5,
  steps: [
    {
      key: 'welcome',
      title: {
        en: 'Welcome, Manager',
        hu: 'Üdvözlünk, Menedzser',
        es: 'Bienvenido, Gerente',
        vi: 'Chào mừng Quản lý',
        mn: 'Тавтай морил, Менежер',
      },
      body: {
        en: 'A short orientation. After this, the Training Center will show optional modules for your area — team, tickets, attendance, revenue, invoices.',
        hu: 'Rövid bevezető. Utána a Tananyagok között további modulok jelennek meg területenként.',
        es: 'Breve orientación. Luego verás módulos opcionales en el Centro de Formación.',
        vi: 'Tham quan ngắn. Sau đó Trung tâm đào tạo sẽ hiển thị các mô-đun tùy chọn.',
        mn: 'Богино танилцуулга. Үүний дараа Сургалтын төв нэмэлт модулиудыг харуулна.',
      },
      route: '/:org',
    },
    {
      key: 'hotel_switcher',
      title: {
        en: 'Pick the hotel you manage',
        hu: 'Válaszd ki a szállodát',
        es: 'Elige el hotel que gestionas',
        vi: 'Chọn khách sạn của bạn',
        mn: 'Удирдах буудлаа сонго',
      },
      body: {
        en: 'Top right. Every screen filters by the hotel selected here. Switch any time — your tour resumes after the data reloads.',
        hu: 'Jobb felül. Minden képernyő az itt választott szállodára szűr.',
        es: 'Arriba a la derecha. Toda la app se filtra por el hotel elegido.',
        vi: 'Trên cùng bên phải. Mọi màn hình lọc theo khách sạn đã chọn.',
        mn: 'Баруун дээд. Бүх дэлгэц сонгосон буудлаар шүүгдэнэ.',
      },
      route: '/:org',
      selector: '[data-training="hotel-switcher"]',
      optional: true,
    },
    {
      key: 'language_switch',
      title: {
        en: 'Language',
        hu: 'Nyelv',
        es: 'Idioma',
        vi: 'Ngôn ngữ',
        mn: 'Хэл',
      },
      body: {
        en: 'Every manager screen is fully translated. Pick the language you want to work in — your team still sees their own language on their devices.',
        hu: 'Minden vezetői képernyő teljesen lefordítva. A csapat saját nyelvét látja a saját eszközén.',
        es: 'Todas las pantallas están traducidas. Tu equipo seguirá viendo su propio idioma.',
        vi: 'Mọi màn hình đều được dịch. Nhân viên vẫn thấy ngôn ngữ của họ.',
        mn: 'Бүх дэлгэц орчуулагдсан. Ажилчид өөрийн хэл дээрээ харна.',
      },
      route: '/:org',
      selector: '[data-training="language-switch"]',
      optional: true,
    },
    {
      key: 'help_button',
      title: {
        en: 'Replay any tour from here',
        hu: 'Bármelyik bemutatót újra elindíthatod',
        es: 'Repite cualquier tour desde aquí',
        vi: 'Phát lại bất kỳ tour nào',
        mn: 'Аль ч хичээлийг эндээс дахин үзэх',
      },
      body: {
        en: 'The Help button opens the Training Center. Every manager module — team, tickets, attendance, revenue, invoices — lives there and can be replayed at any time.',
        hu: 'A Súgó gomb megnyitja a Tananyagokat. Innen bármelyik modult újra lefuttathatod.',
        es: 'El botón de Ayuda abre el Centro de Formación con todos los módulos.',
        vi: 'Nút Trợ giúp mở Trung tâm đào tạo với mọi mô-đun.',
        mn: 'Тусламж товч нь Сургалтын төвийг нээж, бүх модулийг үзүүлнэ.',
      },
      route: '/:org',
      selector: '[data-training="help-button"]',
      optional: true,
    },
  ],
};
