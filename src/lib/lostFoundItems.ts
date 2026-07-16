// Curated list of common lost & found items with per-language labels.
// Sorted by weight (higher = more common) — top-ranked entries surface first.
export type LangKey = 'en' | 'hu' | 'es' | 'vi' | 'mn' | 'uk';

export interface LostFoundItem {
  id: string;
  weight: number;
  labels: Record<LangKey, string>;
}

export const LOST_FOUND_ITEMS: LostFoundItem[] = [
  { id: 'phone_charger', weight: 100, labels: { en: 'Phone charger', hu: 'Telefontöltő', es: 'Cargador de teléfono', vi: 'Sạc điện thoại', mn: 'Утасны цэнэглэгч', uk: 'Зарядка для телефону' } },
  { id: 'phone', weight: 98, labels: { en: 'Mobile phone', hu: 'Mobiltelefon', es: 'Teléfono móvil', vi: 'Điện thoại', mn: 'Гар утас', uk: 'Мобільний телефон' } },
  { id: 'wallet', weight: 96, labels: { en: 'Wallet', hu: 'Pénztárca', es: 'Cartera', vi: 'Ví', mn: 'Түрийвч', uk: 'Гаманець' } },
  { id: 'passport', weight: 94, labels: { en: 'Passport', hu: 'Útlevél', es: 'Pasaporte', vi: 'Hộ chiếu', mn: 'Паспорт', uk: 'Паспорт' } },
  { id: 'id_card', weight: 92, labels: { en: 'ID card', hu: 'Személyi igazolvány', es: 'Documento de identidad', vi: 'Chứng minh thư', mn: 'Иргэний үнэмлэх', uk: 'Посвідчення особи' } },
  { id: 'keys', weight: 90, labels: { en: 'Keys', hu: 'Kulcsok', es: 'Llaves', vi: 'Chìa khóa', mn: 'Түлхүүр', uk: 'Ключі' } },
  { id: 'glasses', weight: 88, labels: { en: 'Glasses', hu: 'Szemüveg', es: 'Gafas', vi: 'Kính', mn: 'Нүдний шил', uk: 'Окуляри' } },
  { id: 'sunglasses', weight: 86, labels: { en: 'Sunglasses', hu: 'Napszemüveg', es: 'Gafas de sol', vi: 'Kính râm', mn: 'Наран шил', uk: 'Сонцезахисні окуляри' } },
  { id: 'umbrella', weight: 85, labels: { en: 'Umbrella', hu: 'Esernyő', es: 'Paraguas', vi: 'Ô', mn: 'Шүхэр', uk: 'Парасолька' } },
  { id: 'headphones', weight: 84, labels: { en: 'Headphones / earbuds', hu: 'Fejhallgató', es: 'Auriculares', vi: 'Tai nghe', mn: 'Чихэвч', uk: 'Навушники' } },
  { id: 'watch', weight: 82, labels: { en: 'Watch', hu: 'Karóra', es: 'Reloj', vi: 'Đồng hồ', mn: 'Цаг', uk: 'Годинник' } },
  { id: 'jewellery', weight: 80, labels: { en: 'Jewellery', hu: 'Ékszer', es: 'Joyería', vi: 'Trang sức', mn: 'Гоёл чимэглэл', uk: 'Прикраси' } },
  { id: 'ring', weight: 78, labels: { en: 'Ring', hu: 'Gyűrű', es: 'Anillo', vi: 'Nhẫn', mn: 'Бөгж', uk: 'Каблучка' } },
  { id: 'necklace', weight: 76, labels: { en: 'Necklace', hu: 'Nyaklánc', es: 'Collar', vi: 'Vòng cổ', mn: 'Зүүлт', uk: 'Кольє' } },
  { id: 'earrings', weight: 75, labels: { en: 'Earrings', hu: 'Fülbevaló', es: 'Aretes', vi: 'Bông tai', mn: 'Ээмэг', uk: 'Сережки' } },
  { id: 'laptop', weight: 74, labels: { en: 'Laptop', hu: 'Laptop', es: 'Portátil', vi: 'Máy tính xách tay', mn: 'Зөөврийн компьютер', uk: 'Ноутбук' } },
  { id: 'tablet', weight: 72, labels: { en: 'Tablet', hu: 'Táblagép', es: 'Tableta', vi: 'Máy tính bảng', mn: 'Таблет', uk: 'Планшет' } },
  { id: 'camera', weight: 70, labels: { en: 'Camera', hu: 'Fényképezőgép', es: 'Cámara', vi: 'Máy ảnh', mn: 'Камер', uk: 'Фотоапарат' } },
  { id: 'book', weight: 68, labels: { en: 'Book', hu: 'Könyv', es: 'Libro', vi: 'Sách', mn: 'Ном', uk: 'Книга' } },
  { id: 'medication', weight: 66, labels: { en: 'Medication', hu: 'Gyógyszer', es: 'Medicamento', vi: 'Thuốc', mn: 'Эм', uk: 'Ліки' } },
  { id: 'cosmetics', weight: 64, labels: { en: 'Cosmetics / makeup', hu: 'Kozmetikum', es: 'Cosméticos', vi: 'Mỹ phẩm', mn: 'Гоо сайхны бүтээгдэхүүн', uk: 'Косметика' } },
  { id: 'toothbrush', weight: 62, labels: { en: 'Toothbrush', hu: 'Fogkefe', es: 'Cepillo de dientes', vi: 'Bàn chải đánh răng', mn: 'Шүдний сойз', uk: 'Зубна щітка' } },
  { id: 'clothing_shirt', weight: 60, labels: { en: 'Shirt / T-shirt', hu: 'Ing / póló', es: 'Camisa / camiseta', vi: 'Áo sơ mi', mn: 'Цамц', uk: 'Сорочка / футболка' } },
  { id: 'clothing_pants', weight: 58, labels: { en: 'Trousers', hu: 'Nadrág', es: 'Pantalones', vi: 'Quần', mn: 'Өмд', uk: 'Штани' } },
  { id: 'clothing_underwear', weight: 56, labels: { en: 'Underwear', hu: 'Fehérnemű', es: 'Ropa interior', vi: 'Đồ lót', mn: 'Дотуур хувцас', uk: 'Білизна' } },
  { id: 'clothing_socks', weight: 55, labels: { en: 'Socks', hu: 'Zokni', es: 'Calcetines', vi: 'Tất', mn: 'Оймс', uk: 'Шкарпетки' } },
  { id: 'jacket', weight: 54, labels: { en: 'Jacket / coat', hu: 'Kabát', es: 'Chaqueta', vi: 'Áo khoác', mn: 'Пальто', uk: 'Куртка / пальто' } },
  { id: 'shoes', weight: 52, labels: { en: 'Shoes', hu: 'Cipő', es: 'Zapatos', vi: 'Giày', mn: 'Гутал', uk: 'Взуття' } },
  { id: 'bag', weight: 50, labels: { en: 'Bag / handbag', hu: 'Táska', es: 'Bolso', vi: 'Túi xách', mn: 'Цүнх', uk: 'Сумка' } },
  { id: 'backpack', weight: 48, labels: { en: 'Backpack', hu: 'Hátizsák', es: 'Mochila', vi: 'Ba lô', mn: 'Үүргэвч', uk: 'Рюкзак' } },
  { id: 'toy', weight: 46, labels: { en: 'Toy / stuffed animal', hu: 'Játék / plüss', es: 'Juguete / peluche', vi: 'Đồ chơi', mn: 'Тоглоом', uk: 'Іграшка' } },
  { id: 'baby_bottle', weight: 44, labels: { en: 'Baby bottle / pacifier', hu: 'Cumisüveg', es: 'Biberón / chupete', vi: 'Bình sữa', mn: 'Хүүхдийн сав', uk: 'Пляшечка / соска' } },
  { id: 'hair_dryer', weight: 42, labels: { en: 'Hair dryer / straightener', hu: 'Hajszárító', es: 'Secador de pelo', vi: 'Máy sấy tóc', mn: 'Үс хатаагч', uk: 'Фен / праска для волосся' } },
  { id: 'perfume', weight: 40, labels: { en: 'Perfume', hu: 'Parfüm', es: 'Perfume', vi: 'Nước hoa', mn: 'Үнэртэй ус', uk: 'Парфуми' } },
  { id: 'documents', weight: 38, labels: { en: 'Documents / papers', hu: 'Iratok', es: 'Documentos', vi: 'Giấy tờ', mn: 'Бичиг баримт', uk: 'Документи' } },
  { id: 'bank_card', weight: 36, labels: { en: 'Bank card', hu: 'Bankkártya', es: 'Tarjeta bancaria', vi: 'Thẻ ngân hàng', mn: 'Банкны карт', uk: 'Банківська картка' } },
  { id: 'cash', weight: 34, labels: { en: 'Cash', hu: 'Készpénz', es: 'Efectivo', vi: 'Tiền mặt', mn: 'Бэлэн мөнгө', uk: 'Готівка' } },
  { id: 'power_bank', weight: 32, labels: { en: 'Power bank', hu: 'Power bank', es: 'Batería externa', vi: 'Pin sạc dự phòng', mn: 'Пауэр банк', uk: 'Павербанк' } },
  { id: 'usb_cable', weight: 30, labels: { en: 'USB cable', hu: 'USB kábel', es: 'Cable USB', vi: 'Cáp USB', mn: 'USB кабель', uk: 'USB-кабель' } },
  { id: 'other', weight: 1, labels: { en: 'Other item', hu: 'Egyéb tárgy', es: 'Otro artículo', vi: 'Vật khác', mn: 'Бусад зүйл', uk: 'Інший предмет' } },
];

export function searchLostFoundItems(query: string, lang: LangKey): LostFoundItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...LOST_FOUND_ITEMS].sort((a, b) => b.weight - a.weight).slice(0, 12);
  const matches = LOST_FOUND_ITEMS.filter((it) => {
    const label = (it.labels[lang] || it.labels.en).toLowerCase();
    const en = it.labels.en.toLowerCase();
    return label.includes(q) || en.includes(q);
  });
  return matches
    .sort((a, b) => {
      const al = (a.labels[lang] || a.labels.en).toLowerCase();
      const bl = (b.labels[lang] || b.labels.en).toLowerCase();
      const aStarts = al.startsWith(q) ? 1 : 0;
      const bStarts = bl.startsWith(q) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      return b.weight - a.weight;
    })
    .slice(0, 12);
}

export function labelFor(item: LostFoundItem, lang: LangKey): string {
  return item.labels[lang] || item.labels.en;
}
