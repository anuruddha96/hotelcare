const en = {
  title: "Today's linen collection", total: 'Total collected', checkout: 'Checkout rooms', daily: 'Daily / stayover rooms',
  roomDaily: 'Daily linen recorded by room', unallocated: 'Daily batch — room unknown', details: 'Tap to see rooms and items',
  items: 'Item-by-item breakdown', room: 'Room', collector: 'Collected by', none: 'No saved items yet',
  edit: 'Record daily batch', editExisting: 'Edit daily batch', save: 'Save daily batch', saving: 'Saving…', cancel: 'Cancel',
  note: 'Only enter linen NOT already recorded for individual rooms. Do not guess room numbers.',
  explanation: 'The total includes saved checkout rooms, daily rooms and separately recorded daily batches. Unidentified linen stays unallocated.',
  roomReport: 'Existing room-based report remains unchanged; unallocated daily linen is shown separately here.',
  setup: 'Daily batch entry requires the database migration. Existing room figures remain available.',
  error: 'Could not load today’s linen totals. Refresh to retry.', saved: 'Daily linen batch saved.', saveError: 'Daily batch was not saved. Please retry.',
  legacy: 'Earlier catalogue items are preserved and shown separately, not counted in the current 15-item sheet.',
  recorded: 'Saved room records', unknown: 'Unallocated — no room attribution', updated: 'Refresh',
};
type Copy = typeof en;
const hu: Copy = {
  title: 'Mai szennyes textília', total: 'Összes begyűjtött', checkout: 'Távozó szobák', daily: 'Napi / maradó szobák',
  roomDaily: 'Szobához rendelt napi textília', unallocated: 'Napi összesítés – szoba ismeretlen', details: 'Koppintson a szobák és tételek megtekintéséhez',
  items: 'Összesítés tételenként', room: 'Szoba', collector: 'Gyűjtötte', none: 'Még nincs rögzített tétel',
  edit: 'Napi összesítés rögzítése', editExisting: 'Napi összesítés módosítása', save: 'Napi összesítés mentése', saving: 'Mentés…', cancel: 'Mégse',
  note: 'Csak a még szobánként NEM rögzített textíliát adja meg. Ne találjon ki szobaszámot.',
  explanation: 'Az összesen tartalmazza a távozó és napi szobák mentett adatait, valamint a külön rögzített napi gyűjtést.',
  roomReport: 'A meglévő szobánkénti jelentés változatlan; a szobához nem rendelt gyűjtés itt külön szerepel.',
  setup: 'A napi összesítéshez adatbázis-frissítés szükséges. A meglévő szobaszámok láthatók.',
  error: 'A mai összesítés nem tölthető be. Próbálja újra.', saved: 'A napi összesítés mentve.', saveError: 'A mentés sikertelen. Próbálja újra.',
  legacy: 'A korábbi tételek megmaradnak, de nem szerepelnek az új 15 tételes összesítésben.',
  recorded: 'Mentett szobák', unknown: 'Nincs szobához rendelve', updated: 'Frissítés',
};
const es: Copy = { ...en, title: 'Recogida de ropa de hoy', total: 'Total recogido', checkout: 'Salidas', daily: 'Habitaciones de estancia', unallocated: 'Lote diario sin habitación', details: 'Toca para ver habitaciones y artículos', items: 'Detalle por artículo', edit: 'Registrar lote diario', save: 'Guardar lote diario', cancel: 'Cancelar', note: 'Registra solo artículos NO guardados por habitación. No inventes habitaciones.' };
const vi: Copy = { ...en, title: 'Đồ vải thu gom hôm nay', total: 'Tổng đã thu', checkout: 'Phòng trả', daily: 'Phòng ở tiếp', unallocated: 'Lô hàng ngày chưa rõ phòng', details: 'Nhấn xem phòng và từng món', items: 'Chi tiết từng loại', edit: 'Ghi lô hàng ngày', save: 'Lưu lô hàng ngày', cancel: 'Hủy', note: 'Chỉ nhập đồ CHƯA ghi theo phòng. Không đoán số phòng.' };
const mn: Copy = { ...en, title: 'Өнөөдрийн цагаан хэрэглэлийн цуглуулга', total: 'Нийт цуглуулсан', checkout: 'Гарсан өрөөнүүд', daily: 'Үргэлжлэн байрлах өрөөнүүд', unallocated: 'Өрөө нь тодорхойгүй өдрийн багц', items: 'Төрөл тус бүрээр', edit: 'Өдрийн багц бүртгэх', save: 'Өдрийн багц хадгалах', cancel: 'Болих', note: 'Өрөөгөөр бүртгээгүй зүйлсийг л оруулна. Өрөөний дугаарыг бүү таа.' };
const az: Copy = { ...en, title: 'Bugünkü çirkli tekstil', total: 'Cəmi yığılan', checkout: 'Çıxış otaqları', daily: 'Qalan qonaq otaqları', unallocated: 'Otağı bilinməyən gündəlik toplu', items: 'Maddələr üzrə bölgü', edit: 'Gündəlik toplunu yaz', save: 'Gündəlik toplunu saxla', cancel: 'Ləğv et', note: 'Yalnız otaq üzrə qeyd edilməyənləri əlavə edin. Otaq nömrəsi uydurmayın.' };
const tl: Copy = { ...en, title: 'Nakolektang linen ngayong araw', total: 'Kabuuang nakolekta', checkout: 'Mga checkout room', daily: 'Mga stayover room', unallocated: 'Daily batch na hindi alam ang kuwarto', items: 'Detalye bawat item', edit: 'I-record ang daily batch', save: 'I-save ang daily batch', cancel: 'Kanselahin', note: 'Ilagay lang ang HINDI pa naitala sa bawat kuwarto. Huwag manghula ng kuwarto.' };
const uk: Copy = { ...en, title: 'Зібрана білизна сьогодні', total: 'Усього зібрано', checkout: 'Номери після виїзду', daily: 'Номери з проживанням', unallocated: 'Денна партія без номера', items: 'За видами білизни', edit: 'Записати денну партію', save: 'Зберегти партію', cancel: 'Скасувати', note: 'Вносьте лише те, що ще НЕ записано за номерами. Не вгадуйте номер.' };
const ru: Copy = { ...en, title: 'Собранное бельё сегодня', total: 'Всего собрано', checkout: 'Номера после выезда', daily: 'Номера с проживанием', unallocated: 'Дневная партия без номера', items: 'По видам белья', edit: 'Записать дневную партию', save: 'Сохранить партию', cancel: 'Отмена', note: 'Вносите только то, что ещё НЕ записано по номерам. Не угадывайте номер.' };
const copies: Record<string, Copy> = { en, hu, es, vi, mn, az, tl, uk, ru };
export const gozsduLinenSummaryCopy = (language: string): Copy => copies[language] || en;
