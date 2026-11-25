/**
 * Work schedule texts: the manager grid and the employee's own "My schedule".
 * Registered into the shared translation table on import.
 * Order: en, hu, es, vi, mn, az, tl, uk, ru
 */
import { pmsTranslations } from '@/lib/pms-translations';
import { rowsV2 } from './translationsV2';

const LANGS = ['en', 'hu', 'es', 'vi', 'mn', 'az', 'tl', 'uk', 'ru'] as const;
type Row = readonly [string, string, string, string, string, string, string, string, string];

const rowsV1: Record<string, Row> = {
  // ---- My schedule (every employee)
  'wf.my.title': ['My schedule', 'Beosztásom', 'Mi horario', 'Lịch làm việc của tôi', 'Миний хуваарь', 'Mənim qrafikim', 'Aking iskedyul', 'Мій графік', 'Мой график'],
  'wf.my.today': ['Today', 'Ma', 'Hoy', 'Hôm nay', 'Өнөөдөр', 'Bu gün', 'Ngayon', 'Сьогодні', 'Сегодня'],
  'wf.my.tomorrow': ['Tomorrow', 'Holnap', 'Mañana', 'Ngày mai', 'Маргааш', 'Sabah', 'Bukas', 'Завтра', 'Завтра'],
  'wf.my.working': ['Working', 'Munkanap', 'Trabajas', 'Đi làm', 'Ажлын өдөр', 'İş günü', 'May pasok', 'Робочий день', 'Рабочий день'],
  'wf.my.dayOff': ['Day off', 'Szabadnap', 'Día libre', 'Ngày nghỉ', 'Амралтын өдөр', 'İstirahət günü', 'Day off', 'Вихідний', 'Выходной'],
  'wf.my.notPlanned': ['Not planned yet', 'Még nincs beosztva', 'Aún sin planificar', 'Chưa xếp lịch', 'Хуваарь гараагүй', 'Hələ planlaşdırılmayıb', 'Wala pang iskedyul', 'Ще не заплановано', 'Ещё не запланировано'],
  'wf.my.night': ['Night shift', 'Éjszakai műszak', 'Turno de noche', 'Ca đêm', 'Шөнийн ээлж', 'Gecə növbəsi', 'Night shift', 'Нічна зміна', 'Ночная смена'],
  'wf.my.leave': ['Leave', 'Szabadság', 'Vacaciones', 'Nghỉ phép', 'Чөлөө', 'Məzuniyyət', 'Bakasyon', 'Відпустка', 'Отпуск'],
  'wf.my.halfLeave': ['Half-day leave', 'Fél nap szabadság', 'Medio día libre', 'Nghỉ phép nửa ngày', 'Хагас өдрийн чөлөө', 'Yarım gün məzuniyyət', 'Kalahating araw na bakasyon', 'Пів дня відпустки', 'Полдня отпуска'],
  'wf.my.sick': ['Sick leave', 'Betegszabadság', 'Baja por enfermedad', 'Nghỉ ốm', 'Өвчний чөлөө', 'Xəstəlik məzuniyyəti', 'Sick leave', 'Лікарняний', 'Больничный'],
  'wf.my.unpaid': ['Unpaid leave', 'Fizetés nélküli szabadság', 'Permiso sin sueldo', 'Nghỉ không lương', 'Цалингүй чөлөө', 'Ödənişsiz məzuniyyət', 'Unpaid leave', 'Відпустка без оплати', 'Отпуск без оплаты'],
  'wf.my.training': ['Training', 'Képzés', 'Formación', 'Đào tạo', 'Сургалт', 'Təlim', 'Training', 'Навчання', 'Обучение'],
  'wf.my.homeOffice': ['Home office', 'Home office', 'Teletrabajo', 'Làm việc tại nhà', 'Гэрээс ажиллах', 'Evdən iş', 'Work from home', 'Робота з дому', 'Работа из дома'],
  'wf.my.absent': ['Absent', 'Hiányzás', 'Ausencia', 'Vắng mặt', 'Тасалсан', 'Qayıb', 'Absent', 'Відсутність', 'Отсутствие'],
  'wf.my.other': ['See your manager', 'Kérdezd a vezetődet', 'Consulta a tu responsable', 'Hỏi quản lý', 'Менежерээсээ асуу', 'Menecerdən soruş', 'Itanong sa manager', 'Запитайте керівника', 'Спросите руководителя'],
  'wf.my.at': ['at', 'itt:', 'en', 'tại', 'байршил:', 'yer:', 'sa', 'у', 'в'],
  'wf.my.hours': ['hours', 'óra', 'horas', 'giờ', 'цаг', 'saat', 'oras', 'год', 'ч'],
  'wf.my.thisMonth': ['This month', 'Ebben a hónapban', 'Este mes', 'Tháng này', 'Энэ сар', 'Bu ay', 'Ngayong buwan', 'Цього місяця', 'В этом месяце'],
  'wf.my.shifts': ['Shifts', 'Műszakok', 'Turnos', 'Ca làm', 'Ээлж', 'Növbələr', 'Mga shift', 'Зміни', 'Смены'],
  'wf.my.hoursTotal': ['Hours', 'Órák', 'Horas', 'Số giờ', 'Цаг', 'Saatlar', 'Oras', 'Години', 'Часы'],
  'wf.my.leaveTaken': ['Leave taken', 'Kivett szabadság', 'Vacaciones usadas', 'Phép đã dùng', 'Авсан чөлөө', 'İstifadə edilən məzuniyyət', 'Nagamit na leave', 'Використано відпустки', 'Использовано отпуска'],
  'wf.my.leaveLeft': ['Leave left', 'Maradék szabadság', 'Vacaciones restantes', 'Phép còn lại', 'Үлдсэн чөлөө', 'Qalan məzuniyyət', 'Natitirang leave', 'Залишок відпустки', 'Остаток отпуска'],
  'wf.my.leaveYear': ['Annual leave {year}', 'Éves szabadság {year}', 'Vacaciones {year}', 'Phép năm {year}', '{year} оны чөлөө', '{year} illik məzuniyyət', 'Taunang leave {year}', 'Щорічна відпустка {year}', 'Ежегодный отпуск {year}'],
  'wf.my.leaveOf': ['{used} of {total} days used', '{used} / {total} nap felhasználva', '{used} de {total} días usados', 'Đã dùng {used}/{total} ngày', '{total}-с {used} өдөр ашигласан', '{total} gündən {used} istifadə olunub', '{used} sa {total} araw ang nagamit', 'Використано {used} з {total} днів', 'Использовано {used} из {total} дней'],
  'wf.my.days': ['days', 'nap', 'días', 'ngày', 'өдөр', 'gün', 'araw', 'днів', 'дней'],
  'wf.my.next': ['Next shifts', 'Következő műszakok', 'Próximos turnos', 'Ca sắp tới', 'Дараагийн ээлжүүд', 'Növbəti növbələr', 'Mga susunod na shift', 'Наступні зміни', 'Ближайшие смены'],
  'wf.my.month': ['Month', 'Hónap', 'Mes', 'Tháng', 'Сар', 'Ay', 'Buwan', 'Місяць', 'Месяц'],
  'wf.my.openFull': ['Open my schedule', 'Beosztásom megnyitása', 'Abrir mi horario', 'Mở lịch của tôi', 'Хуваариа нээх', 'Qrafikimi aç', 'Buksan ang iskedyul ko', 'Відкрити мій графік', 'Открыть мой график'],
  'wf.my.hide': ['Show less', 'Kevesebb', 'Ver menos', 'Thu gọn', 'Хураах', 'Daha az', 'Mas kaunti', 'Згорнути', 'Свернуть'],
  'wf.my.notLinked': ['Your schedule will appear here once HR connects your account to the work schedule.', 'A beosztásod itt jelenik meg, amint a HR összekapcsolja a fiókodat a beosztással.', 'Tu horario aparecerá aquí cuando RR. HH. conecte tu cuenta.', 'Lịch của bạn sẽ hiện ở đây khi nhân sự liên kết tài khoản của bạn.', 'Хүний нөөц таны бүртгэлийг холбосны дараа хуваарь энд харагдана.', 'HR hesabınızı qrafikə bağladıqdan sonra qrafikiniz burada görünəcək.', 'Lalabas dito ang iskedyul mo kapag na-link na ng HR ang account mo.', 'Ваш графік з’явиться тут, коли відділ кадрів під’єднає ваш акаунт.', 'Ваш график появится здесь, когда отдел кадров привяжет ваш аккаунт.'],
  'wf.my.private': ['Only you and your managers can see this.', 'Ezt csak te és a vezetőid látjátok.', 'Solo tú y tus responsables pueden ver esto.', 'Chỉ bạn và quản lý của bạn thấy được.', 'Зөвхөн та болон таны удирдлага харна.', 'Bunu yalnız siz və rəhbərləriniz görür.', 'Ikaw at ang mga manager mo lang ang nakakakita nito.', 'Це бачите лише ви та ваші керівники.', 'Это видите только вы и ваши руководители.'],
  'wf.my.attendance': ['Attendance', 'Jelenlét', 'Asistencia', 'Chấm công', 'Ирц', 'Davamiyyət', 'Attendance', 'Відвідуваність', 'Посещаемость'],
  'wf.my.checkedIn': ['In', 'Be', 'Entrada', 'Vào', 'Ирсэн', 'Giriş', 'Pasok', 'Прихід', 'Приход'],
  'wf.my.checkedOut': ['Out', 'Ki', 'Salida', 'Ra', 'Явсан', 'Çıxış', 'Labas', 'Вихід', 'Уход'],
  'wf.my.holiday': ['Public holiday', 'Ünnepnap', 'Festivo', 'Ngày lễ', 'Баярын өдөр', 'Bayram günü', 'Pista opisyal', 'Святковий день', 'Праздничный день'],
  'wf.my.prevMonth': ['Previous month', 'Előző hónap', 'Mes anterior', 'Tháng trước', 'Өмнөх сар', 'Əvvəlki ay', 'Nakaraang buwan', 'Попередній місяць', 'Предыдущий месяц'],
  'wf.my.nextMonth': ['Next month', 'Következő hónap', 'Mes siguiente', 'Tháng sau', 'Дараагийн сар', 'Növbəti ay', 'Susunod na buwan', 'Наступний місяць', 'Следующий месяц'],

  // ---- Manager page
  'wf.m.today': ['This month', 'Aktuális hónap', 'Este mes', 'Tháng này', 'Энэ сар', 'Bu ay', 'Ngayong buwan', 'Цей місяць', 'Этот месяц'],
  'wf.m.search': ['Search name, role or hotel…', 'Név, munkakör vagy szálloda…', 'Buscar nombre, puesto u hotel…', 'Tìm tên, vị trí hoặc khách sạn…', 'Нэр, албан тушаал, буудал…', 'Ad, vəzifə və ya otel…', 'Hanapin ang pangalan, role o hotel…', 'Ім’я, посада або готель…', 'Имя, должность или отель…'],
  'wf.m.allHotels': ['All hotels', 'Minden szálloda', 'Todos los hoteles', 'Tất cả khách sạn', 'Бүх буудал', 'Bütün otellər', 'Lahat ng hotel', 'Усі готелі', 'Все отели'],
  'wf.m.company': ['Company / outlets', 'Cég / egységek', 'Empresa / locales', 'Công ty / cơ sở', 'Компани / салбар', 'Şirkət / məntəqələr', 'Kumpanya / outlets', 'Компанія / заклади', 'Компания / точки'],
  'wf.m.allDepartments': ['All departments', 'Minden részleg', 'Todos los departamentos', 'Tất cả bộ phận', 'Бүх хэлтэс', 'Bütün şöbələr', 'Lahat ng departamento', 'Усі відділи', 'Все отделы'],
  'wf.m.viewDays': ['Days down (like the Excel)', 'Napok lefelé (mint az Excel)', 'Días en filas (como el Excel)', 'Ngày theo hàng (như Excel)', 'Өдрүүд доошоо (Excel шиг)', 'Günlər aşağı (Excel kimi)', 'Mga araw pababa (gaya ng Excel)', 'Дні вниз (як в Excel)', 'Дни вниз (как в Excel)'],
  'wf.m.viewStaff': ['Employees down', 'Dolgozók lefelé', 'Empleados en filas', 'Nhân viên theo hàng', 'Ажилтнууд доошоо', 'İşçilər aşağı', 'Mga empleyado pababa', 'Працівники вниз', 'Сотрудники вниз'],
  'wf.m.viewDay': ['One day', 'Egy nap', 'Un día', 'Một ngày', 'Нэг өдөр', 'Bir gün', 'Isang araw', 'Один день', 'Один день'],
  'wf.m.zoomOut': ['Zoom out: see more cells', 'Kicsinyítés: több cella látszik', 'Alejar: ver más celdas', 'Thu nhỏ: xem nhiều ô hơn', 'Жижигрүүлэх', 'Kiçilt: daha çox xana', 'Zoom out: mas maraming cell', 'Зменшити: більше клітинок', 'Уменьшить: больше ячеек'],
  'wf.m.zoomIn': ['Zoom in', 'Nagyítás', 'Acercar', 'Phóng to', 'Томруулах', 'Böyüt', 'Zoom in', 'Збільшити', 'Увеличить'],
  'wf.m.zoomReset': ['Back to 100%', 'Vissza 100%-ra', 'Volver al 100%', 'Về 100%', '100% руу буцах', '100%-ə qayıt', 'Balik sa 100%', 'Повернути 100%', 'Вернуть 100%'],
  'wf.m.fit': ['Fit all employees on screen', 'Minden dolgozó férjen ki', 'Ajustar todos a la pantalla', 'Vừa màn hình', 'Дэлгэцэд багтаах', 'Hamısını ekrana sığdır', 'Ipasok lahat sa screen', 'Вмістити всіх на екран', 'Уместить всех на экран'],
  'wf.m.fullscreen': ['Full screen', 'Teljes képernyő', 'Pantalla completa', 'Toàn màn hình', 'Бүтэн дэлгэц', 'Tam ekran', 'Full screen', 'На весь екран', 'На весь экран'],
  'wf.m.exitFullscreen': ['Exit full screen', 'Kilépés a teljes képernyőből', 'Salir de pantalla completa', 'Thoát toàn màn hình', 'Бүтэн дэлгэцээс гарах', 'Tam ekrandan çıx', 'Lumabas sa full screen', 'Вийти з повного екрана', 'Выйти из полного экрана'],
  'wf.m.pinTotals': ['Keep totals visible', 'Összesítők mindig látszanak', 'Mantener totales visibles', 'Luôn hiện tổng', 'Нийлбэрийг байнга харуулах', 'Cəmlər həmişə görünsün', 'Laging ipakita ang totals', 'Підсумки завжди видно', 'Итоги всегда видны'],
  'wf.m.more': ['More', 'Továbbiak', 'Más', 'Thêm', 'Бусад', 'Daha çox', 'Iba pa', 'Більше', 'Ещё'],
  'wf.m.formerStaff': ['Show former staff', 'Volt dolgozók mutatása', 'Mostrar antiguos empleados', 'Hiện nhân viên cũ', 'Хуучин ажилтнуудыг харуулах', 'Keçmiş işçiləri göstər', 'Ipakita ang dating staff', 'Показати колишніх працівників', 'Показать бывших сотрудников'],
  'wf.m.legend': ['Colour legend', 'Színmagyarázat', 'Leyenda de colores', 'Chú giải màu', 'Өнгөний тайлбар', 'Rəng izahı', 'Legend ng kulay', 'Легенда кольорів', 'Легенда цветов'],
  'wf.m.import': ['Import Excel', 'Excel importálása', 'Importar Excel', 'Nhập Excel', 'Excel импортлох', 'Excel idxal et', 'Mag-import ng Excel', 'Імпорт Excel', 'Импорт Excel'],
  'wf.m.export': ['Export Excel', 'Excel exportálása', 'Exportar Excel', 'Xuất Excel', 'Excel экспортлох', 'Excel ixrac et', 'Mag-export ng Excel', 'Експорт Excel', 'Экспорт Excel'],
  'wf.m.copy4': ['Copy last 4 weeks', 'Előző 4 hét másolása', 'Copiar últimas 4 semanas', 'Sao chép 4 tuần trước', 'Сүүлийн 4 долоо хоногийг хуулах', 'Son 4 həftəni kopyala', 'Kopyahin ang huling 4 na linggo', 'Копіювати останні 4 тижні', 'Копировать последние 4 недели'],
  'wf.m.shortcuts': ['How to edit', 'Szerkesztési súgó', 'Cómo editar', 'Cách chỉnh sửa', 'Хэрхэн засах', 'Necə redaktə etmək', 'Paano mag-edit', 'Як редагувати', 'Как редактировать'],
  'wf.m.publish': ['Publish', 'Közzététel', 'Publicar', 'Công bố', 'Нийтлэх', 'Dərc et', 'I-publish', 'Опублікувати', 'Опубликовать'],
  'wf.m.clear': ['Clear', 'Törlés', 'Borrar', 'Xóa', 'Арилгах', 'Təmizlə', 'Burahin', 'Очистити', 'Очистить'],
  'wf.m.employees': ['employees', 'dolgozó', 'empleados', 'nhân viên', 'ажилтан', 'işçi', 'empleyado', 'працівників', 'сотрудников'],
  'wf.m.selected': ['cells selected', 'cella kijelölve', 'celdas seleccionadas', 'ô đã chọn', 'нүд сонгосон', 'xana seçilib', 'cell ang napili', 'клітинок вибрано', 'ячеек выбрано'],
  'wf.m.openDetails': ['Open details', 'Részletek', 'Abrir detalles', 'Mở chi tiết', 'Дэлгэрэнгүй', 'Təfərrüatlar', 'Buksan ang detalye', 'Деталі', 'Подробности'],
  'wf.m.workingDays': ['working days', 'munkanap', 'días laborables', 'ngày làm việc', 'ажлын өдөр', 'iş günü', 'araw ng trabaho', 'робочих днів', 'рабочих дней'],
  'wf.m.loading': ['Loading schedule…', 'Beosztás betöltése…', 'Cargando horario…', 'Đang tải lịch…', 'Хуваарь ачаалж байна…', 'Qrafik yüklənir…', 'Nilo-load ang iskedyul…', 'Завантаження графіка…', 'Загрузка графика…'],
  'wf.m.help1': ['Click a cell and type a shift (08-17, éjsz, SZB, B, X) or pick a code above.', 'Kattints egy cellára és írd be a műszakot (08-17, éjsz, SZB, B, X), vagy válassz kódot fent.', 'Haz clic en una celda y escribe el turno (08-17, éjsz, SZB, B, X) o elige un código arriba.', 'Bấm vào ô rồi nhập ca (08-17, éjsz, SZB, B, X) hoặc chọn mã ở trên.', 'Нүдэн дээр дарж ээлжээ бичнэ (08-17, éjsz, SZB, B, X) эсвэл дээрээс код сонгоно.', 'Xanaya klikləyin və növbəni yazın (08-17, éjsz, SZB, B, X) və ya yuxarıdan kod seçin.', 'I-click ang cell at i-type ang shift (08-17, éjsz, SZB, B, X) o pumili ng code sa itaas.', 'Клацніть клітинку й введіть зміну (08-17, éjsz, SZB, B, X) або виберіть код угорі.', 'Щёлкните ячейку и введите смену (08-17, éjsz, SZB, B, X) или выберите код сверху.'],
  'wf.m.help2': ['Copy and paste work like in Excel (Ctrl+C / Ctrl+V), also to and from Excel.', 'A másolás és beillesztés úgy működik, mint az Excelben (Ctrl+C / Ctrl+V), Excelből és Excelbe is.', 'Copiar y pegar funciona como en Excel (Ctrl+C / Ctrl+V), también desde y hacia Excel.', 'Sao chép và dán như Excel (Ctrl+C / Ctrl+V), cả với Excel.', 'Excel шиг хуулж буулгана (Ctrl+C / Ctrl+V), Excel рүү болон Excel-ээс.', 'Kopyala və yapışdır Excel-dəki kimi işləyir (Ctrl+C / Ctrl+V).', 'Copy at paste gaya ng Excel (Ctrl+C / Ctrl+V), pati mula at papunta sa Excel.', 'Копіювання та вставка як в Excel (Ctrl+C / Ctrl+V), також з Excel і в Excel.', 'Копирование и вставка как в Excel (Ctrl+C / Ctrl+V), также из Excel и в Excel.'],
  'wf.m.help3': ['Drag the small square in the corner of a selection to repeat it. Ctrl+D fills down, Ctrl+Z undoes.', 'Húzd a kijelölés sarkában lévő kis négyzetet az ismétléshez. Ctrl+D lefelé tölt, Ctrl+Z visszavon.', 'Arrastra el cuadradito de la esquina de la selección para repetirla. Ctrl+D rellena hacia abajo, Ctrl+Z deshace.', 'Kéo ô vuông nhỏ ở góc vùng chọn để lặp lại. Ctrl+D điền xuống, Ctrl+Z hoàn tác.', 'Сонголтын булан дахь жижиг дөрвөлжинг чирж давтана. Ctrl+D доош бөглөнө, Ctrl+Z буцаана.', 'Təkrarlamaq üçün seçimin küncündəki kiçik kvadratı sürükləyin. Ctrl+D aşağı doldurur, Ctrl+Z geri qaytarır.', 'I-drag ang maliit na parisukat sa sulok ng selection para ulitin. Ctrl+D fill down, Ctrl+Z undo.', 'Потягніть маленький квадрат у куті виділення, щоб повторити. Ctrl+D заповнює вниз, Ctrl+Z скасовує.', 'Потяните маленький квадрат в углу выделения, чтобы повторить. Ctrl+D заполняет вниз, Ctrl+Z отменяет.'],
  'wf.m.help4': ['Double-click a cell for details. Past days are locked. Hold Ctrl and scroll to zoom.', 'Dupla kattintás a részletekért. A múltbeli napok zároltak. Ctrl + görgetés: nagyítás.', 'Doble clic en una celda para ver detalles. Los días pasados están bloqueados. Ctrl + rueda para zoom.', 'Nhấp đúp vào ô để xem chi tiết. Ngày đã qua bị khóa. Giữ Ctrl và cuộn để thu phóng.', 'Дэлгэрэнгүйг харахын тулд давхар дарна. Өнгөрсөн өдрүүд түгжээтэй. Ctrl барьж гүйлгэн томруулна.', 'Təfərrüat üçün iki dəfə klikləyin. Keçmiş günlər kilidlidir. Ctrl + sürüşdürmə: miqyas.', 'I-double-click ang cell para sa detalye. Naka-lock ang mga nakaraang araw. Ctrl + scroll para mag-zoom.', 'Двічі клацніть клітинку для деталей. Минулі дні заблоковано. Ctrl + прокрутка — масштаб.', 'Дважды щёлкните ячейку для подробностей. Прошедшие дни заблокированы. Ctrl + прокрутка — масштаб.'],
  'wf.m.day': ['Day', 'Nap', 'Día', 'Ngày', 'Өдөр', 'Gün', 'Araw', 'День', 'День'],
  'wf.m.employee': ['Employee', 'Dolgozó', 'Empleado', 'Nhân viên', 'Ажилтан', 'İşçi', 'Empleyado', 'Працівник', 'Сотрудник'],
  'wf.m.note': ['Note', 'Megjegyzés', 'Nota', 'Ghi chú', 'Тэмдэглэл', 'Qeyd', 'Tala', 'Примітка', 'Примечание'],
  // Totals
  'wf.t.days': ['Day shifts', 'Nappalok', 'Turnos de día', 'Ca ngày', 'Өдрийн ээлж', 'Gündüz növbələri', 'Day shift', 'Денні зміни', 'Дневные смены'],
  'wf.t.nights': ['Night shifts', 'Éjszakák', 'Turnos de noche', 'Ca đêm', 'Шөнийн ээлж', 'Gecə növbələri', 'Night shift', 'Нічні зміни', 'Ночные смены'],
  'wf.t.leave': ['Leave', 'Szabadság', 'Vacaciones', 'Nghỉ phép', 'Чөлөө', 'Məzuniyyət', 'Leave', 'Відпустка', 'Отпуск'],
  'wf.t.sick': ['Sick', 'Betegség', 'Enfermedad', 'Nghỉ ốm', 'Өвчтэй', 'Xəstəlik', 'Sakit', 'Лікарняний', 'Больничный'],
  'wf.t.off': ['Days off', 'Szabadnap', 'Días libres', 'Ngày nghỉ', 'Амралтын өдөр', 'İstirahət günləri', 'Day off', 'Вихідні', 'Выходные'],
  'wf.t.holiday': ['Holiday shifts', 'Ünnepi műszak', 'Turnos en festivo', 'Ca ngày lễ', 'Баярын ээлж', 'Bayram növbələri', 'Holiday shift', 'Святкові зміни', 'Праздничные смены'],
  'wf.t.hours': ['Hours', 'Órák', 'Horas', 'Số giờ', 'Цаг', 'Saatlar', 'Oras', 'Години', 'Часы'],
  'wf.t.balance': ['Over / under', 'Túlóra / hiány', 'Extra / falta', 'Thừa / thiếu', 'Илүү / дутуу', 'Artıq / əskik', 'Sobra / kulang', 'Понад / менше', 'Сверх / меньше'],
  'wf.t.leaveLeft': ['Leave left', 'Szabi maradt', 'Vacaciones restantes', 'Phép còn lại', 'Үлдсэн чөлөө', 'Qalan məzuniyyət', 'Natitirang leave', 'Залишок відпустки', 'Остаток отпуска'],
  'wf.t.balanceHint': ['Hours worked plus paid leave and sick days, compared with this month\'s working days × daily hours. Plus = overtime, minus = hours still owed.', 'Ledolgozott órák plusz fizetett szabadság és betegnapok, a havi munkanapok × napi óraszámhoz képest. Plusz = túlóra, mínusz = hiányzó óra.', 'Horas trabajadas más vacaciones y bajas pagadas, frente a los días laborables del mes × horas diarias. Más = horas extra, menos = horas pendientes.', 'Giờ làm cộng nghỉ phép và nghỉ ốm có lương, so với số ngày làm việc trong tháng × giờ mỗi ngày.', 'Ажилласан цаг дээр цалинтай чөлөө, өвчний өдрийг нэмж, сарын ажлын өдөр × өдрийн цагтай харьцуулна.', 'İşlənmiş saatlar üstəgəl ödənişli məzuniyyət və xəstəlik günləri, ayın iş günləri × gündəlik saatla müqayisədə.', 'Oras na natrabaho plus bayad na leave at sick days, kumpara sa working days ng buwan × oras kada araw.', 'Відпрацьовані години плюс оплачувана відпустка й лікарняні, порівняно з робочими днями місяця × денна норма.', 'Отработанные часы плюс оплачиваемый отпуск и больничные, по сравнению с рабочими днями месяца × дневная норма.'],
};

const rows: Record<string, Row> = { ...rowsV1, ...rowsV2 };

export const workforceTranslations: Record<string, Record<string, string>> = Object.fromEntries(
  LANGS.map((lang, index) => [lang, Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[index] ?? values[0]]))]),
);

for (const lang of LANGS) {
  pmsTranslations[lang] = { ...(pmsTranslations[lang] ?? {}), ...workforceTranslations[lang] };
}
