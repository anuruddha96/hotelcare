// Housekeeper "Your First Day" curriculum.
//
// Designed so a brand-new housekeeper can follow it on their phone with no
// prior coaching. The flow mirrors the real work order:
//   1. Grant location access  →  2. Sign in (slider / button)
//   3. Take a break / end a break (so they know how)
//   4. Open My Tasks  →  5. (proactive) Start the first room when one is
//      actually assigned and waiting  →  6. In-room tools  →
//   7. Complete the room  →  8. Sign out at end of shift.
//
// Steps 5–7 are gated on `has_active_assignment` / `has_in_progress_cleaning`
// so they appear PROACTIVELY only when the housekeeper actually has work,
// instead of being shown as abstract slides. Selectors point at real anchors
// (`data-training="…"`) that already exist in the dashboard components.
import type { TrainingCurriculum } from '../types';

export const housekeeperCurriculum: TrainingCurriculum = {
  slug: 'v2_housekeeper_first_day',
  name: {
    en: 'Your First Day — Housekeeper',
    hu: 'Az első napod — Szobaasszony',
    es: 'Tu primer día — Camarera',
    vi: 'Ngày đầu tiên của bạn',
    mn: 'Анхны ажлын өдөр',
  },
  description: {
    en: 'A friendly walkthrough of everything you need to clean rooms confidently.',
    hu: 'Barátságos bemutató mindenhez, ami a szobák magabiztos takarításához kell.',
    es: 'Un recorrido amable de todo lo que necesitas para limpiar habitaciones con confianza.',
    vi: 'Hướng dẫn thân thiện về mọi thứ bạn cần để dọn phòng tự tin.',
    mn: 'Өрөө цэвэрлэхэд хэрэгтэй бүхнийг танилцуулах.',
  },
  roles: ['housekeeping'],
  category: 'core',
  priority: 10,
  steps: [
    {
      key: 'welcome',
      title: {
        en: 'Welcome to Hotel Care 👋',
        hu: 'Üdvözlünk a Hotel Care-ben 👋',
        es: 'Bienvenido a Hotel Care 👋',
        vi: 'Chào mừng đến Hotel Care 👋',
        mn: 'Hotel Care-д тавтай морил 👋',
      },
      body: {
        en: 'This short tour shows you how to sign in, find your rooms, clean them, and finish your shift. We will pause and wait for you at each step.',
        hu: 'Ez a rövid bemutató megmutatja, hogyan jelentkezz be, találd meg a szobáidat, takarítsd ki őket és fejezd be a műszakod.',
        es: 'Este breve recorrido te muestra cómo iniciar sesión, encontrar tus habitaciones, limpiarlas y terminar tu turno.',
        vi: 'Hướng dẫn ngắn này chỉ cho bạn cách đăng nhập, tìm phòng, dọn dẹp và kết thúc ca làm.',
        mn: 'Энэ богино заавар нь нэвтрэх, өрөөгөө олох, цэвэрлэх, ээлжээ дуусгахыг заана.',
      },
    },

    // ── 1. Attendance: grant location access first ─────────────────────────
    {
      key: 'grant_location',
      title: {
        en: 'Allow location access',
        hu: 'Engedélyezd a helymeghatározást',
        es: 'Permite acceso a la ubicación',
        vi: 'Cho phép truy cập vị trí',
        mn: 'Байршил руу хандах зөвшөөрөл',
      },
      body: {
        en: 'Sign-in needs your location so the hotel knows you are on site. When the phone asks, tap Allow. If you already denied it, open the Location help link on the Attendance tab.',
        hu: 'A bejelentkezéshez szükség van a helyzetedre. Amikor a telefon kérdezi, koppints az Engedélyezés gombra.',
        es: 'El registro necesita tu ubicación. Cuando el teléfono pregunte, toca Permitir.',
        vi: 'Đăng nhập cần vị trí của bạn. Khi điện thoại hỏi, hãy bấm Cho phép.',
        mn: 'Бүртгүүлэхэд таны байршил хэрэгтэй. Утас асуухад "Зөвшөөрөх" дар.',
      },
      tab: 'attendance',
      selector: '[data-training="check-in-button"]',
    },

    // ── 2. Sign in (slider / button) ───────────────────────────────────────
    {
      key: 'signin',
      title: {
        en: 'Slide / tap to sign in',
        hu: 'Húzd / koppints a bejelentkezéshez',
        es: 'Desliza / toca para iniciar sesión',
        vi: 'Trượt / chạm để đăng nhập',
        mn: 'Гүйлгэж / товшиж бүртгүүл',
      },
      body: {
        en: 'On the Attendance tab use the Sign In control to start your shift. We will wait here until you are signed in.',
        hu: 'A Jelenlét fülön használd a Bejelentkezés vezérlőt. Megvárjuk.',
        es: 'En la pestaña Asistencia usa el control Iniciar Sesión. Esperaremos.',
        vi: 'Tại tab Chấm công, dùng nút Đăng nhập. Chúng tôi sẽ chờ.',
        mn: 'Ирц табд Бүртгүүлэх товчийг ашиглан ээлжээ эхлүүл.',
      },
      tab: 'attendance',
      selector: '[data-training="check-in-button"]',
      waitFor: 'is_signed_in',
    },

    // ── 3. Breaks ──────────────────────────────────────────────────────────
    {
      key: 'breaks',
      title: {
        en: 'Take a break',
        hu: 'Tarts szünetet',
        es: 'Toma un descanso',
        vi: 'Nghỉ giải lao',
        mn: 'Завсарлах',
      },
      body: {
        en: 'When you need a break, pick the type (lunch, rest, personal) and press Start Break. Press End Break to come back. Your shift time stops and resumes automatically.',
        hu: 'Ha szünetet szeretnél, válaszd ki a típust és nyomd meg a Szünet Indítása gombot.',
        es: 'Cuando necesites un descanso, elige el tipo y pulsa Iniciar Descanso.',
        vi: 'Khi cần nghỉ, chọn loại và bấm Bắt đầu nghỉ.',
        mn: 'Завсарлахдаа төрлийг сонгож "Завсар эхлүүлэх" дар.',
      },
      tab: 'attendance',
      selector: '[data-training="break-button"]',
      precondition: 'is_signed_in',
      optional: true,
    },

    // ── 4. Open the My Tasks list ──────────────────────────────────────────
    {
      key: 'my_tasks',
      title: {
        en: 'Your rooms for today',
        hu: 'Mai szobáid',
        es: 'Tus habitaciones de hoy',
        vi: 'Phòng hôm nay',
        mn: 'Өнөөдрийн өрөөнүүд',
      },
      body: {
        en: 'My Tasks shows the rooms assigned to you. Each card has the room number, type (Daily / Checkout), priority and any guest notes.',
        hu: 'A Feladataim a rád osztott szobákat mutatja.',
        es: 'Mis Tareas muestra tus habitaciones asignadas.',
        vi: 'Nhiệm vụ của tôi hiển thị các phòng được giao.',
        mn: '"Миний даалгавар" танд хуваарилсан өрөөг харуулна.',
      },
      tab: 'housekeeping',
      selector: '[data-training="my-tasks-tab"]',
      precondition: 'is_signed_in',
    },

    // ── 5. PROACTIVE: only fires when an active room is assigned & waiting ─
    {
      key: 'start_cleaning',
      title: {
        en: 'Start your first room',
        hu: 'Kezdd el az első szobát',
        es: 'Comienza tu primera habitación',
        vi: 'Bắt đầu phòng đầu tiên',
        mn: 'Эхний өрөөгөө эхлүүл',
      },
      body: {
        en: 'You have a room waiting. Tap Start Cleaning on the card to open the in-room tools. We will continue once you start.',
        hu: 'Vár rád egy szoba. Koppints a Takarítás kezdése gombra.',
        es: 'Tienes una habitación esperando. Toca Comenzar Limpieza.',
        vi: 'Bạn có phòng đang chờ. Bấm Bắt đầu Dọn.',
        mn: 'Танд өрөө хүлээж байна. "Цэвэрлэж эхлэх" дар.',
      },
      selector: '[data-training="start-room-button"]',
      precondition: 'has_active_assignment',
      waitFor: 'has_in_progress_cleaning',
    },

    // ── 6. In-room tools (only relevant once a room is in progress) ────────
    {
      key: 'in_session_photos',
      title: {
        en: 'Add the required photos',
        hu: 'Készítsd el a kötelező fotókat',
        es: 'Toma las fotos requeridas',
        vi: 'Chụp ảnh bắt buộc',
        mn: 'Шаардлагатай зургуудыг ав',
      },
      body: {
        en: 'Tap Photos and capture bathroom, bed and floor. You cannot complete the room without them.',
        hu: 'Koppints a Fotók gombra és készíts fotót a fürdőről, ágyról, padlóról.',
        es: 'Toca Fotos y captura baño, cama y suelo.',
        vi: 'Bấm Ảnh và chụp phòng tắm, giường, sàn.',
        mn: '"Зураг" товч дээр дарж угаалгын өрөө, ор, шалыг ав.',
      },
      selector: '[data-training="room-photos-button"]',
      precondition: 'has_in_progress_cleaning',
    },
    {
      key: 'in_session_maintenance',
      title: {
        en: 'Found something broken?',
        hu: 'Találtál valami hibásat?',
        es: '¿Algo está roto?',
        vi: 'Có gì hỏng?',
        mn: 'Эвдэрсэн зүйл байна уу?',
      },
      body: {
        en: 'Tap Maintenance to create a ticket with a photo. The maintenance team gets it instantly.',
        hu: 'Koppints a Karbantartás gombra, hogy jegyet készíts fényképpel.',
        es: 'Toca Mantenimiento para crear un ticket con foto.',
        vi: 'Bấm Bảo trì để tạo phiếu kèm ảnh.',
        mn: 'Засвар үйлчилгээ дээр дарж зураг хавсаргасан тасалбар үүсгэ.',
      },
      selector: '[data-training="maintenance-button"]',
      precondition: 'has_in_progress_cleaning',
      optional: true,
    },
    {
      key: 'in_session_linen',
      title: {
        en: 'Log dirty linen',
        hu: 'Rögzítsd a piszkos ágyneműt',
        es: 'Registra ropa sucia',
        vi: 'Ghi nhận khăn bẩn',
        mn: 'Бохир даавууг бүртгэ',
      },
      body: {
        en: 'Use Dirty Linen to count what you removed. Laundry uses this for the next delivery.',
        hu: 'A Piszkos Ágynemű gombbal számold meg a kivett tételeket.',
        es: 'Usa Ropa Sucia para contar lo que retiraste.',
        vi: 'Dùng Khăn Bẩn để đếm những gì bạn đã lấy ra.',
        mn: '"Бохир даавуу" товчоор хассан зүйлээ тоол.',
      },
      selector: '[data-training="dirty-linen-button"]',
      precondition: 'has_in_progress_cleaning',
      optional: true,
    },
    {
      key: 'in_session_lostfound',
      title: {
        en: 'Lost & found',
        hu: 'Elveszett és talált',
        es: 'Objetos perdidos',
        vi: 'Mất & tìm',
        mn: 'Олдсон зүйл',
      },
      body: {
        en: 'Found something a guest left? Tap Lost & Found and log it with a photo so reception can return it.',
        hu: 'Találtál valamit? Koppints az Elveszett és Talált gombra.',
        es: '¿Encontraste algo? Toca Perdidos y Encontrados.',
        vi: 'Tìm thấy gì? Bấm Mất & Tìm.',
        mn: 'Олсон зүйлийг "Олдсон зүйл" дээр бүртгэ.',
      },
      selector: '[data-training="lost-found-button"]',
      precondition: 'has_in_progress_cleaning',
      optional: true,
    },
    {
      key: 'in_session_dnd',
      title: {
        en: 'DND or refused service',
        hu: 'Ne zavarj / elutasított',
        es: 'No molestar / rechazado',
        vi: 'DND / từ chối',
        mn: 'Бүү саатуул / татгалзсан',
      },
      body: {
        en: 'If the guest has DND or refuses cleaning, tap the orange No Service / DND button instead of completing the room.',
        hu: 'Ha DND vagy elutasítás van, használd a narancssárga gombot.',
        es: 'Si hay DND o rechazo, usa el botón naranja.',
        vi: 'Nếu DND hoặc bị từ chối, dùng nút cam.',
        mn: 'DND эсвэл татгалзвал улбар шар товчийг ашигла.',
      },
      selector: '[data-training="dnd-button"]',
      precondition: 'has_in_progress_cleaning',
      optional: true,
    },
    {
      key: 'in_session_complete',
      title: {
        en: 'Finish the room',
        hu: 'Fejezd be a szobát',
        es: 'Terminar la habitación',
        vi: 'Hoàn tất phòng',
        mn: 'Өрөөг дуусгах',
      },
      body: {
        en: 'When the photos are in and the room is ready, tap Mark Complete. It becomes ready for inspection.',
        hu: 'Ha kész vagy, koppints a Kész jelölésre.',
        es: 'Cuando termines, pulsa Marcar Completo.',
        vi: 'Khi xong, bấm Hoàn tất.',
        mn: 'Дууссан үед "Дуусгах" дар.',
      },
      selector: '[data-training="complete-room-button"]',
      precondition: 'has_in_progress_cleaning',
    },

    // ── 7. End of shift ────────────────────────────────────────────────────
    {
      key: 'signout',
      title: {
        en: 'End of shift — sign out',
        hu: 'Műszak vége — jelentkezz ki',
        es: 'Fin de turno — cierra sesión',
        vi: 'Kết thúc ca — đăng xuất',
        mn: 'Ээлжээ дуусгах',
      },
      body: {
        en: 'When all rooms are done, go back to Attendance and tap Sign Out. Your manager sees your finish time automatically.',
        hu: 'Ha minden szoba kész, nyisd meg a Jelenlét fület és koppints a Kijelentkezés gombra.',
        es: 'Cuando termines, abre Asistencia y toca Cerrar Sesión.',
        vi: 'Khi xong, mở Chấm công và bấm Đăng xuất.',
        mn: 'Бүх өрөө дууссан үед Ирц рүү ороод "Гарах" дарна уу.',
      },
      tab: 'attendance',
      selector: '[data-training="sign-out-button"]',
      precondition: 'is_signed_in',
    },
  ],
};
