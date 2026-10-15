import type { LangKey } from './lostFoundItems';

export const LOST_FOUND_AREAS = [
  'Reception',
  'Lobby',
  'Conference room',
  'Restaurant',
  'Breakfast area',
  'Bar',
  'Gym',
  'Hallway',
  'Lift',
  'Parking',
  'Other public area',
] as const;

type Copy = {
  whereFound: string;
  chooseType: string;
  room: string;
  area: string;
  custom: string;
  selectRoom: string;
  searchRooms: string;
  noRooms: string;
  selectArea: string;
  customPlaceholder: string;
  locationRequired: string;
  locationUnavailable: string;
  generalTitle: string;
  notSpecified: string;
};

const copy: Record<LangKey, Copy> = {
  en: { whereFound: 'Where was the item found?', chooseType: 'Select a room or hotel area.', room: 'Guest room', area: 'Hotel area', custom: 'Custom location', selectRoom: 'Select room', searchRooms: 'Search room number…', noRooms: 'No rooms found for this hotel.', selectArea: 'Choose an area', customPlaceholder: 'e.g. Terrace, 2nd floor corridor', locationRequired: 'Please select or enter where the item was found.', locationUnavailable: 'Could not load rooms for this hotel. Please try again.', generalTitle: 'Hotel Lost & Found', notSpecified: 'Not specified' },
  hu: { whereFound: 'Hol találták a tárgyat?', chooseType: 'Válassz szobát vagy szállodai helyszínt.', room: 'Vendégszoba', area: 'Szállodai terület', custom: 'Egyéni helyszín', selectRoom: 'Szoba kiválasztása', searchRooms: 'Szobaszám keresése…', noRooms: 'Nincs található szoba ebben a szállodában.', selectArea: 'Terület kiválasztása', customPlaceholder: 'pl. Terasz, 2. emeleti folyosó', locationRequired: 'Válaszd ki vagy add meg a megtalálás helyét.', locationUnavailable: 'A szobák betöltése sikertelen. Próbáld újra.', generalTitle: 'Szállodai talált tárgyak', notSpecified: 'Nincs megadva' },
  es: { whereFound: '¿Dónde se encontró?', chooseType: 'Seleccione habitación o zona.', room: 'Habitación', area: 'Zona del hotel', custom: 'Ubicación personalizada', selectRoom: 'Elegir habitación', searchRooms: 'Buscar habitación…', noRooms: 'No hay habitaciones.', selectArea: 'Elegir zona', customPlaceholder: 'p. ej. terraza, pasillo', locationRequired: 'Seleccione o introduzca una ubicación.', locationUnavailable: 'No se pudieron cargar las habitaciones.', generalTitle: 'Objetos perdidos del hotel', notSpecified: 'Sin especificar' },
  vi: { whereFound: 'Tìm thấy vật ở đâu?', chooseType: 'Chọn phòng hoặc khu vực.', room: 'Phòng khách', area: 'Khu vực khách sạn', custom: 'Vị trí khác', selectRoom: 'Chọn phòng', searchRooms: 'Tìm số phòng…', noRooms: 'Không tìm thấy phòng.', selectArea: 'Chọn khu vực', customPlaceholder: 'VD: Sân thượng, hành lang', locationRequired: 'Vui lòng chọn hoặc nhập vị trí.', locationUnavailable: 'Không tải được danh sách phòng.', generalTitle: 'Đồ thất lạc khách sạn', notSpecified: 'Chưa xác định' },
  mn: { whereFound: 'Эд зүйлийг хаанаас олсон бэ?', chooseType: 'Өрөө эсвэл талбай сонгоно уу.', room: 'Зочны өрөө', area: 'Зочид буудлын талбай', custom: 'Өөр байршил', selectRoom: 'Өрөө сонгох', searchRooms: 'Өрөөний дугаар хайх…', noRooms: 'Өрөө олдсонгүй.', selectArea: 'Талбай сонгох', customPlaceholder: 'Жишээ: Террас, коридор', locationRequired: 'Байршлаа сонгох эсвэл оруулна уу.', locationUnavailable: 'Өрөөнүүдийг ачаалж чадсангүй.', generalTitle: 'Зочид буудлын олдвор', notSpecified: 'Тодорхойгүй' },
  uk: { whereFound: 'Де знайдено річ?', chooseType: 'Оберіть номер або місце.', room: 'Номер', area: 'Зона готелю', custom: 'Інше місце', selectRoom: 'Обрати номер', searchRooms: 'Пошук номера…', noRooms: 'Номерів не знайдено.', selectArea: 'Обрати зону', customPlaceholder: 'Напр. тераса, коридор', locationRequired: 'Оберіть або введіть місце.', locationUnavailable: 'Не вдалося завантажити номери.', generalTitle: 'Знахідки готелю', notSpecified: 'Не вказано' },
};

const areaTranslations: Partial<Record<LangKey, Record<string, string>>> = {
  hu: { Reception: 'Recepció', Lobby: 'Előtér', 'Conference room': 'Konferenciaterem', Restaurant: 'Étterem', 'Breakfast area': 'Reggeliző', Bar: 'Bár', Gym: 'Edzőterem', Hallway: 'Folyosó', Lift: 'Lift', Parking: 'Parkoló', 'Other public area': 'Egyéb közös terület' },
};

export function lostFoundLocationCopy(lang: LangKey): Copy {
  return copy[lang] || copy.en;
}

export function lostFoundAreaLabel(area: string, lang: LangKey): string {
  return areaTranslations[lang]?.[area] || area;
}

export function lostFoundLocationLabel(
  item: { rooms?: { room_number?: string | null } | null; found_location?: string | null },
  lang: LangKey = 'en',
): string {
  const roomNumber = item.rooms?.room_number?.trim();
  if (roomNumber) return `${lostFoundLocationCopy(lang).room} ${roomNumber}`;
  const location = item.found_location?.trim();
  return location ? lostFoundAreaLabel(location, lang) : lostFoundLocationCopy(lang).notSpecified;
}
