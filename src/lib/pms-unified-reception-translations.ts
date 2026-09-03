import { pmsTranslations } from '@/lib/pms-translations';

const LANGS = ['en', 'hu', 'es', 'vi', 'mn', 'az', 'tl', 'uk', 'ru'] as const;
type Row = readonly [string, string, string, string, string, string, string, string, string];

// en, hu, es, vi, mn, az, tl, uk, ru
const rows: Record<string, Row> = {
  'pms.unified.reception': ['Reception', 'Recepció', 'Recepción', 'Lễ tân', 'Ресепшн', 'Resepsiya', 'Reception', 'Рецепція', 'Ресепшен'],
  'pms.unified.liveSnapshotFallback': ['PMS live snapshot fallback', 'Élő PMS-pillanatkép tartalék', 'Respaldo de instantánea PMS en vivo', 'Dữ liệu PMS trực tiếp dự phòng', 'PMS шууд агшны нөөц', 'Canlı PMS görüntüsü ehtiyatı', 'PMS live snapshot fallback', 'Резервний live-знімок PMS', 'Резервный live-снимок PMS'],
  'pms.unified.snapshotReadOnly': ['Read-only PMS snapshot — sync to open the reservation record', 'Csak olvasható PMS-pillanatkép — szinkronizálj a foglalás megnyitásához', 'Instantánea PMS de solo lectura — sincroniza para abrir la reserva', 'Ảnh chụp PMS chỉ đọc — đồng bộ để mở hồ sơ đặt phòng', 'Зөвхөн унших PMS агшин — захиалгыг нээхийн тулд синк хийнэ үү', 'Yalnız oxunan PMS görüntüsü — rezervasiyanı açmaq üçün sinxronlaşdırın', 'Read-only PMS snapshot — mag-sync para mabuksan ang reservation', 'PMS-знімок лише для читання — синхронізуйте, щоб відкрити бронювання', 'PMS-снимок только для чтения — синхронизируйте, чтобы открыть бронирование'],
  'pms.unified.unassigned': ['Unassigned', 'Kiosztatlan', 'Sin asignar', 'Chưa gán', 'Хуваарилаагүй', 'Təyin edilməyib', 'Unassigned', 'Не призначено', 'Не назначено'],
  'pms.unified.previoLive': ['Previo live', 'Previo élő', 'Previo en vivo', 'Previo trực tiếp', 'Previo шууд', 'Previo canlı', 'Previo live', 'Previo live', 'Previo live'],
  'pms.unified.futureReservations': ['Upcoming online reservations', 'Közelgő online foglalások', 'Próximas reservas online', 'Đặt phòng trực tuyến sắp tới', 'Удахгүй ирэх онлайн захиалга', 'Qarşıdakı onlayn rezervasiyalar', 'Paparating online reservations', 'Майбутні онлайн-бронювання', 'Предстоящие онлайн-бронирования'],
  'pms.unified.rooms': ['rooms', 'szoba', 'habitaciones', 'phòng', 'өрөө', 'otaq', 'rooms', 'номерів', 'номеров'],
  'pms.unified.liveSnapshotReadOnly': ['Previo live snapshot (read-only)', 'Previo élő pillanatkép (csak olvasható)', 'Instantánea Previo en vivo (solo lectura)', 'Ảnh chụp Previo trực tiếp (chỉ đọc)', 'Previo шууд агшин (зөвхөн унших)', 'Previo canlı görüntüsü (yalnız oxuma)', 'Previo live snapshot (read-only)', 'Previo live-знімок (лише читання)', 'Previo live-снимок (только чтение)'],
  'pms.planner.legend_checked_out': ['Checked out', 'Kijelentkezett', 'Check-out hecho', 'Đã trả phòng', 'Гарсан', 'Çıxış edib', 'Checked out', 'Виїхав', 'Выезд'],
};

for (const [key, values] of Object.entries(rows)) {
  LANGS.forEach((lang, index) => {
    pmsTranslations[lang] = {
      ...(pmsTranslations[lang] ?? {}),
      [key]: values[index],
    };
  });
}
