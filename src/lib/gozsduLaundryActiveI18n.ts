// Extra Gozsdu-only Laundryner labels. Never infer physical presence: the badge
// reports HotelCare's current in_progress housekeeping assignment only.
export type GozsduLaundryActiveCopy = {
  cleaningNow: string;
  nameUnavailable: string;
  activeCount: string;
  separateQueues: string;
};
const copies: Record<string, GozsduLaundryActiveCopy> = {
  en: { cleaningNow: 'Cleaning in progress', nameUnavailable: 'Name unavailable', activeCount: 'being cleaned now', separateQueues: 'Separate room lists: checkout, second-day stayover and other rooms.' },
  hu: { cleaningNow: 'Takarítás folyamatban', nameUnavailable: 'A név nem elérhető', activeCount: 'takarítás alatt', separateQueues: 'Külön szobalisták: kijelentkezés, második napi lakott szobák és egyéb szobák.' },
  es: { cleaningNow: 'Limpieza en curso', nameUnavailable: 'Nombre no disponible', activeCount: 'en limpieza', separateQueues: 'Listas separadas: salidas, estancias de segundo día y otras habitaciones.' },
  vi: { cleaningNow: 'Đang dọn phòng', nameUnavailable: 'Không có tên', activeCount: 'đang được dọn', separateQueues: 'Danh sách riêng: phòng trả, phòng lưu trú ngày hai và phòng khác.' },
  mn: { cleaningNow: 'Өрөөг цэвэрлэж байна', nameUnavailable: 'Нэр байхгүй', activeCount: 'цэвэрлэж байна', separateQueues: 'Тусдаа жагсаалт: гарах, хоёр дахь өдрийн болон бусад өрөө.' },
  az: { cleaningNow: 'Təmizlik davam edir', nameUnavailable: 'Ad mövcud deyil', activeCount: 'təmizlənir', separateQueues: 'Ayrı siyahılar: çıxış, ikinci gün qalma və digər otaqlar.' },
  tl: { cleaningNow: 'Kasalukuyang nililinis', nameUnavailable: 'Hindi available ang pangalan', activeCount: 'nililinis ngayon', separateQueues: 'Hiwalay ang checkout, second-day stayover at iba pang mga kuwarto.' },
  uk: { cleaningNow: 'Прибирання триває', nameUnavailable: 'Ім’я недоступне', activeCount: 'прибираються зараз', separateQueues: 'Окремі списки: виїзди, проживання другого дня та інші номери.' },
  ru: { cleaningNow: 'Идёт уборка', nameUnavailable: 'Имя недоступно', activeCount: 'убираются сейчас', separateQueues: 'Отдельные списки: выезды, проживание второго дня и другие номера.' },
};
export const gozsduLaundryActiveCopy = (language: string): GozsduLaundryActiveCopy => copies[language] || copies.en;
