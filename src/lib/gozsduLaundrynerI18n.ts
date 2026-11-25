// Gozsdu-only laundry workflow copy; selected from HotelCare's existing
// language setting. English is the fallback for an unsupported language.
export type LaundryCopy = {
  title: string; recorded: string; refresh: string; duty: string; loading: string;
  checkout: string; checkoutHint: string; stayover: string; stayoverHint: string;
  other: string; otherHint: string; room: string; dnd: string; collected: string;
  nothing: string; noAccess: string; notRecorded: string; noRooms: string;
  dirtyLinen: string; dndWarning: string; quantityHint: string; save: string;
  nothingButton: string; accessLabel: string; reasonPlaceholder: string;
  accessButton: string; saving: string; syncError: string; newDayError: string;
  dndError: string; countError: string; reasonError: string; successCollected: string;
  successNothing: string; successBlocked: string; saveError: string; quantity: string;
};

const en: LaundryCopy = {
  title: 'Laundryner • My Tasks', recorded: 'rooms recorded', refresh: 'Refresh',
  duty: 'Laundry-only duty: attendance, breaks and tickets remain in their usual tabs. Enter stayovers only with guest permission; record DND rooms as no access.',
  loading: 'Loading laundry tasks…', checkout: 'Checkout rooms',
  checkoutHint: 'Prioritize after guest checkout and room release.',
  stayover: 'Second-day stayovers', stayoverHint: 'Confirm guest access before collecting.',
  other: 'Other rooms', otherHint: 'For other stayovers, follow the Gozsdu service cycle.',
  room: 'Room', dnd: 'DND • no entry', collected: 'collected',
  nothing: 'Nothing to collect', noAccess: 'No access', notRecorded: 'Not recorded',
  noRooms: 'No eligible rooms in this group.', dirtyLinen: 'Dirty linen',
  dndWarning: 'Do not enter: this room is DND. Record an access blocker below.',
  quantityHint: 'Enter quantities actually collected. Saving updates the dirty linen and manager records together.',
  save: 'Save collected linen', nothingButton: 'Nothing to collect',
  accessLabel: 'Could not access room', reasonPlaceholder: 'DND, guest refused, occupied…',
  accessButton: 'Record access blocker', saving: 'Saving securely…',
  syncError: 'Laundry tasks could not be synchronized. Retry before entering counts.',
  newDayError: 'A new Budapest business date has started. Reload tasks before recording linen.',
  dndError: 'This room is DND. Record no access or ask reception to resolve guest access.',
  countError: 'Enter at least one linen item or select Nothing to collect.',
  reasonError: 'Please provide a reason (DND, occupied, guest refused, etc.).',
  successCollected: 'Linen collected and manager records updated.',
  successNothing: 'Room recorded: nothing to collect.',
  successBlocked: 'Access blocker recorded.',
  saveError: 'Linen collection was not saved. Nothing was marked complete.', quantity: 'quantity',
};

const hu: LaundryCopy = {
  title: 'Textíliagyűjtő • Feladataim', recorded: 'szoba rögzítve', refresh: 'Frissítés',
  duty: 'Csak textíliagyűjtés: a jelenlét, a szünetek és a jegyek a megszokott füleken maradnak. Lakott szobába csak vendégengedéllyel lépj be; a DND szobát jelöld nem hozzáférhetőként.',
  loading: 'Textíliagyűjtési feladatok betöltése…', checkout: 'Kijelentkező szobák',
  checkoutHint: 'A vendég távozása és a szoba felszabadítása után elsőbbséget élveznek.',
  stayover: 'Második napi, lakott szobák', stayoverHint: 'Gyűjtés előtt ellenőrizd, hogy a vendég engedélyezte-e a belépést.',
  other: 'Egyéb szobák', otherHint: 'A többi lakott szobánál kövesd a Gozsdu szervizrendjét.',
  room: 'Szoba', dnd: 'Ne zavarjanak • belépni tilos', collected: 'begyűjtve',
  nothing: 'Nincs begyűjthető textília', noAccess: 'Nem lehet belépni', notRecorded: 'Nincs rögzítve',
  noRooms: 'Nincs megfelelő szoba ebben a csoportban.', dirtyLinen: 'Szennyes textília',
  dndWarning: 'Ne lépj be: a szoba DND státuszú. Rögzítsd az akadályt alább.',
  quantityHint: 'Add meg a ténylegesen begyűjtött darabszámokat. Mentéskor a szennyeslista és a vezetői nézet együtt frissül.',
  save: 'Begyűjtött textília mentése', nothingButton: 'Nincs mit begyűjteni',
  accessLabel: 'Nem sikerült belépni', reasonPlaceholder: 'DND, vendég elutasította, foglalt…',
  accessButton: 'Belépési akadály rögzítése', saving: 'Biztonságos mentés…',
  syncError: 'Nem sikerült szinkronizálni a feladatokat. Darabszám megadása előtt próbáld újra.',
  newDayError: 'Új budapesti munkanap kezdődött. Textília rögzítése előtt frissítsd a feladatokat.',
  dndError: 'A szoba DND státuszú. Rögzítsd a sikertelen belépést, vagy egyeztess a recepcióval.',
  countError: 'Adj meg legalább egy darabot, vagy válaszd a Nincs mit begyűjteni lehetőséget.',
  reasonError: 'Add meg az okot (DND, foglalt, vendég elutasította stb.).',
  successCollected: 'Textília begyűjtve, vezetői nyilvántartás frissítve.',
  successNothing: 'Szoba rögzítve: nincs mit begyűjteni.', successBlocked: 'Belépési akadály rögzítve.',
  saveError: 'A textíliagyűjtés mentése sikertelen. A feladat nem lett késznek jelölve.', quantity: 'darabszám',
};

const es: LaundryCopy = {
  title: 'Recogida de ropa • Mis tareas', recorded: 'habitaciones registradas', refresh: 'Actualizar',
  duty: 'Solo recogida de ropa: asistencia, descansos e incidencias siguen en sus pestañas. Entra en habitaciones ocupadas solo con permiso del huésped; registra las habitaciones DND como sin acceso.',
  loading: 'Cargando tareas de lavandería…', checkout: 'Habitaciones de salida', checkoutHint: 'Priorizar después de la salida y liberación de la habitación.',
  stayover: 'Estancias del segundo día', stayoverHint: 'Confirma el permiso del huésped antes de recoger.', other: 'Otras habitaciones', otherHint: 'Sigue el ciclo de servicio de Gozsdu para las demás estancias.',
  room: 'Habitación', dnd: 'No molestar • no entrar', collected: 'recogidos', nothing: 'Nada que recoger', noAccess: 'Sin acceso', notRecorded: 'Sin registrar', noRooms: 'No hay habitaciones disponibles en este grupo.',
  dirtyLinen: 'Ropa sucia', dndWarning: 'No entres: la habitación está en DND. Registra el impedimento de acceso.', quantityHint: 'Introduce solo las cantidades recogidas. Al guardar se actualizan la ropa sucia y el registro del responsable.',
  save: 'Guardar ropa recogida', nothingButton: 'Nada que recoger', accessLabel: 'No se pudo acceder', reasonPlaceholder: 'DND, huésped rechazó, ocupada…', accessButton: 'Registrar falta de acceso', saving: 'Guardando de forma segura…',
  syncError: 'No se pudieron sincronizar las tareas. Vuelve a intentarlo antes de anotar cantidades.', newDayError: 'Ha empezado un nuevo día laboral en Budapest. Recarga las tareas.', dndError: 'Esta habitación está en DND. Registra sin acceso o consulta con recepción.',
  countError: 'Introduce al menos un artículo o selecciona Nada que recoger.', reasonError: 'Indica un motivo (DND, ocupada, rechazo del huésped, etc.).', successCollected: 'Ropa recogida y registros del responsable actualizados.', successNothing: 'Habitación registrada: nada que recoger.', successBlocked: 'Impedimento de acceso registrado.', saveError: 'No se guardó la recogida. La tarea no se marcó como terminada.', quantity: 'cantidad',
};

const vi: LaundryCopy = {
  title: 'Nhân viên thu đồ vải • Việc của tôi', recorded: 'phòng đã ghi nhận', refresh: 'Làm mới',
  duty: 'Chỉ thu đồ vải: chấm công, nghỉ giải lao và phiếu việc vẫn ở các tab thông thường. Chỉ vào phòng khách đang ở khi được đồng ý; ghi phòng DND là không thể vào.',
  loading: 'Đang tải công việc thu đồ vải…', checkout: 'Phòng trả', checkoutHint: 'Ưu tiên sau khi khách trả phòng và phòng được bàn giao.', stayover: 'Phòng ở ngày thứ hai', stayoverHint: 'Xác nhận khách cho phép trước khi thu.', other: 'Phòng khác', otherHint: 'Theo lịch phục vụ Gozsdu đối với các phòng còn lại.',
  room: 'Phòng', dnd: 'Không làm phiền • không vào', collected: 'đã thu', nothing: 'Không có gì để thu', noAccess: 'Không thể vào', notRecorded: 'Chưa ghi nhận', noRooms: 'Không có phòng phù hợp trong nhóm này.', dirtyLinen: 'Đồ vải bẩn',
  dndWarning: 'Không được vào: phòng đang DND. Hãy ghi nhận lý do không thể vào.', quantityHint: 'Nhập số lượng thực tế đã thu. Khi lưu, dữ liệu đồ vải và quản lý cùng được cập nhật.', save: 'Lưu đồ vải đã thu', nothingButton: 'Không có gì để thu', accessLabel: 'Không thể vào phòng', reasonPlaceholder: 'DND, khách từ chối, đang có khách…', accessButton: 'Ghi nhận không thể vào', saving: 'Đang lưu an toàn…',
  syncError: 'Không thể đồng bộ công việc. Thử lại trước khi nhập số lượng.', newDayError: 'Ngày làm việc mới tại Budapest đã bắt đầu. Hãy tải lại công việc.', dndError: 'Phòng đang DND. Ghi không thể vào hoặc nhờ lễ tân xác nhận.', countError: 'Nhập ít nhất một món hoặc chọn Không có gì để thu.', reasonError: 'Vui lòng nhập lý do (DND, có khách, khách từ chối…).', successCollected: 'Đã thu đồ vải và cập nhật thông tin quản lý.', successNothing: 'Đã ghi nhận phòng: không có gì để thu.', successBlocked: 'Đã ghi nhận lý do không thể vào.', saveError: 'Không thể lưu đồ vải. Công việc chưa được đánh dấu hoàn thành.', quantity: 'số lượng',
};

const mn: LaundryCopy = {
  title: 'Цагаан хэрэглэл цуглуулагч • Миний ажил', recorded: 'өрөө бүртгэгдсэн', refresh: 'Шинэчлэх',
  duty: 'Зөвхөн цагаан хэрэглэл: ирц, завсарлага, тасалбарууд өмнөх цэсэнд хэвээр байна. Зочин байгаа өрөөнд зөвшөөрөлтэй ор; DND өрөөг нэвтрэх боломжгүй гэж тэмдэглэ.',
  loading: 'Ажил ачаалж байна…', checkout: 'Гарах өрөөнүүд', checkoutHint: 'Зочин гарч, өрөө чөлөөлөгдсөний дараа түрүүлж цуглуул.', stayover: 'Хоёр дахь өдрийн өрөөнүүд', stayoverHint: 'Цуглуулахаасаа өмнө зочны зөвшөөрлийг шалга.', other: 'Бусад өрөө', otherHint: 'Бусад өрөөнд Gozsdu-гийн үйлчилгээний хуваарийг дага.',
  room: 'Өрөө', dnd: 'Бүү саад бол • орж болохгүй', collected: 'цуглуулсан', nothing: 'Цуглуулах зүйлгүй', noAccess: 'Нэвтрэх боломжгүй', notRecorded: 'Бүртгээгүй', noRooms: 'Энэ бүлэгт тохирох өрөө алга.', dirtyLinen: 'Бохир цагаан хэрэглэл',
  dndWarning: 'Бүү ор: энэ өрөө DND байна. Нэвтрэх боломжгүй шалтгааныг бич.', quantityHint: 'Бодитоор цуглуулсан тоог оруул. Хадгалахад менежерийн бүртгэл шинэчлэгдэнэ.', save: 'Цуглуулснаа хадгалах', nothingButton: 'Цуглуулах зүйлгүй', accessLabel: 'Өрөөнд орж чадсангүй', reasonPlaceholder: 'DND, зочин татгалзсан, хүнтэй…', accessButton: 'Нэвтрэх саадыг бүртгэх', saving: 'Аюулгүй хадгалж байна…',
  syncError: 'Ажлыг синк хийж чадсангүй. Тоо оруулахаасаа өмнө дахин оролд.', newDayError: 'Будапештийн ажлын шинэ өдөр эхэллээ. Ажлаа шинэчил.', dndError: 'DND өрөө. Нэвтрэх боломжгүй гэж тэмдэглэ эсвэл ресепшнээс зөвшөөрөл ав.', countError: 'Дор хаяж нэг зүйл оруул эсвэл Цуглуулах зүйлгүй-г сонго.', reasonError: 'Шалтгаан оруул (DND, хүнтэй, татгалзсан гэх мэт).', successCollected: 'Цагаан хэрэглэл болон менежерийн бүртгэл шинэчлэгдлээ.', successNothing: 'Өрөө бүртгэгдлээ: цуглуулах зүйлгүй.', successBlocked: 'Нэвтрэх саад бүртгэгдлээ.', saveError: 'Цуглуулалтыг хадгалсангүй. Ажлыг дууссан гэж тэмдэглээгүй.', quantity: 'тоо',
};

const az: LaundryCopy = {
  title: 'Camaşır toplayan • Tapşırıqlarım', recorded: 'otaq qeydə alınıb', refresh: 'Yenilə',
  duty: 'Yalnız camaşır toplama: davamiyyət, fasilə və biletlər əvvəlki bölmələrdə qalır. Qonaqlı otağa yalnız icazə ilə daxil olun; DND otaqlarını giriş yoxdur kimi qeyd edin.',
  loading: 'Tapşırıqlar yüklənir…', checkout: 'Çıxış otaqları', checkoutHint: 'Qonaq çıxdıqdan və otaq boşaldıqdan sonra üstünlük verin.', stayover: 'İkinci gün qalan otaqlar', stayoverHint: 'Toplamadan əvvəl qonaq icazəsini təsdiqləyin.', other: 'Digər otaqlar', otherHint: 'Digər otaqlarda Gozsdu xidmət dövrünə əməl edin.',
  room: 'Otaq', dnd: 'Narahat etməyin • girməyin', collected: 'toplandı', nothing: 'Toplanacaq bir şey yoxdur', noAccess: 'Giriş yoxdur', notRecorded: 'Qeyd edilməyib', noRooms: 'Bu qrupda uyğun otaq yoxdur.', dirtyLinen: 'Çirkli camaşır',
  dndWarning: 'Daxil olmayın: otaq DND statusundadır. Giriş maneəsini qeyd edin.', quantityHint: 'Faktiki toplanan miqdarı daxil edin. Yadda saxlamaq menecer qeydini də yeniləyir.', save: 'Toplanan camaşırı saxla', nothingButton: 'Toplanacaq bir şey yoxdur', accessLabel: 'Otağa daxil olmaq mümkün olmadı', reasonPlaceholder: 'DND, qonaq imtina etdi, doludur…', accessButton: 'Giriş maneəsini qeyd et', saving: 'Təhlükəsiz saxlanılır…',
  syncError: 'Tapşırıqlar sinxronlaşdırılmadı. Sayları daxil etməzdən əvvəl yenidən cəhd edin.', newDayError: 'Budapeştdə yeni iş günü başlayıb. Tapşırıqları yeniləyin.', dndError: 'Bu otaq DND-dir. Giriş yoxdur qeyd edin və ya resepsiyadan icazə alın.', countError: 'Ən azı bir əşya daxil edin və ya Toplanacaq bir şey yoxdur seçin.', reasonError: 'Səbəb daxil edin (DND, dolu, qonaq imtina edib və s.).', successCollected: 'Camaşır toplandı və menecer qeydləri yeniləndi.', successNothing: 'Otaq qeyd edildi: toplanacaq bir şey yoxdur.', successBlocked: 'Giriş maneəsi qeyd edildi.', saveError: 'Camaşır qeydi saxlanılmadı. Tapşırıq tamamlanmadı.', quantity: 'miqdar',
};

const tl: LaundryCopy = {
  title: 'Tagakolekta ng labahin • Mga gawain ko', recorded: 'kuwartong naitala', refresh: 'I-refresh',
  duty: 'Pagkolekta lang ng labahin: nasa karaniwang tab pa rin ang attendance, pahinga at tickets. Pumasok sa kuwartong may bisita kung may pahintulot lamang; itala ang DND bilang walang access.',
  loading: 'Kinukuha ang mga gawain…', checkout: 'Mga kuwartong magche-checkout', checkoutHint: 'Unahin pagkatapos umalis ang bisita at ma-release ang kuwarto.', stayover: 'Mga kuwartong ikalawang araw', stayoverHint: 'Kumpirmahin muna ang pahintulot ng bisita.', other: 'Ibang mga kuwarto', otherHint: 'Sundin ang iskedyul ng serbisyo ng Gozsdu.',
  room: 'Kuwarto', dnd: 'Huwag istorbohin • bawal pumasok', collected: 'nakolekta', nothing: 'Walang kukolektahin', noAccess: 'Walang access', notRecorded: 'Hindi pa naitala', noRooms: 'Walang kuwarto sa grupong ito.', dirtyLinen: 'Maruming linen',
  dndWarning: 'Huwag pumasok: DND ang kuwarto. Itala ang dahilan ng hindi pagpasok.', quantityHint: 'Ilagay ang aktuwal na bilang na nakolekta. Maa-update rin ang talaan ng manager.', save: 'I-save ang nakolektang linen', nothingButton: 'Walang kukolektahin', accessLabel: 'Hindi makapasok sa kuwarto', reasonPlaceholder: 'DND, tumanggi ang bisita, okupado…', accessButton: 'Itala ang hadlang sa pagpasok', saving: 'Ligtas na sine-save…',
  syncError: 'Hindi ma-sync ang mga gawain. Subukang muli bago maglagay ng bilang.', newDayError: 'Nagsimula ang bagong araw ng trabaho sa Budapest. I-reload ang mga gawain.', dndError: 'DND ang kuwarto. Itala na walang access o kumonsulta sa reception.', countError: 'Maglagay ng kahit isang linen o piliin ang Walang kukolektahin.', reasonError: 'Magbigay ng dahilan (DND, okupado, tumanggi ang bisita, atbp.).', successCollected: 'Nakolekta ang linen at na-update ang talaan ng manager.', successNothing: 'Naitala ang kuwarto: walang kukolektahin.', successBlocked: 'Naitala ang hadlang sa pagpasok.', saveError: 'Hindi na-save ang koleksyon. Hindi minarkahang tapos ang gawain.', quantity: 'bilang',
};

const uk: LaundryCopy = {
  title: 'Збирач білизни • Мої завдання', recorded: 'номерів зареєстровано', refresh: 'Оновити',
  duty: 'Лише збір білизни: відвідуваність, перерви й заявки лишаються у звичних вкладках. Заходьте в зайняті номери лише з дозволу гостя; DND позначайте як відсутність доступу.',
  loading: 'Завантаження завдань…', checkout: 'Номери з виїздом', checkoutHint: 'Спочатку дочекайтеся виїзду гостя та звільнення номера.', stayover: 'Номери другого дня проживання', stayoverHint: 'Підтвердьте дозвіл гостя перед збором.', other: 'Інші номери', otherHint: 'Дотримуйтеся графіка обслуговування Gozsdu.',
  room: 'Номер', dnd: 'Не турбувати • не входити', collected: 'зібрано', nothing: 'Нічого збирати', noAccess: 'Немає доступу', notRecorded: 'Не зареєстровано', noRooms: 'Немає відповідних номерів у цій групі.', dirtyLinen: 'Брудна білизна',
  dndWarning: 'Не входьте: номер має статус DND. Зареєструйте причину відсутності доступу.', quantityHint: 'Вкажіть фактично зібрані кількості. Збереження оновлює записи менеджера.', save: 'Зберегти зібрану білизну', nothingButton: 'Нічого збирати', accessLabel: 'Не вдалося потрапити в номер', reasonPlaceholder: 'DND, гість відмовив, зайнято…', accessButton: 'Зареєструвати відсутність доступу', saving: 'Безпечне збереження…',
  syncError: 'Не вдалося синхронізувати завдання. Повторіть спробу перед введенням кількостей.', newDayError: 'Почався новий робочий день у Будапешті. Оновіть завдання.', dndError: 'Номер DND. Позначте відсутність доступу або зверніться на рецепцію.', countError: 'Вкажіть хоча б один предмет або виберіть Нічого збирати.', reasonError: 'Вкажіть причину (DND, зайнято, гість відмовив тощо).', successCollected: 'Білизну зібрано, записи менеджера оновлено.', successNothing: 'Номер зареєстровано: нічого збирати.', successBlocked: 'Причину відсутності доступу зареєстровано.', saveError: 'Збір білизни не збережено. Завдання не позначено виконаним.', quantity: 'кількість',
};

const ru: LaundryCopy = {
  title: 'Сборщик белья • Мои задачи', recorded: 'номеров записано', refresh: 'Обновить',
  duty: 'Только сбор белья: учет рабочего времени, перерывы и заявки остаются в обычных вкладках. Входите в занятые номера только с разрешения гостя; DND отмечайте как отсутствие доступа.',
  loading: 'Загрузка задач…', checkout: 'Номера с выездом', checkoutHint: 'Приоритет после выезда гостя и освобождения номера.', stayover: 'Номера второго дня проживания', stayoverHint: 'Перед сбором подтвердите разрешение гостя.', other: 'Другие номера', otherHint: 'Следуйте графику обслуживания Gozsdu.',
  room: 'Номер', dnd: 'Не беспокоить • не входить', collected: 'собрано', nothing: 'Нечего собирать', noAccess: 'Нет доступа', notRecorded: 'Не записано', noRooms: 'В этой группе нет подходящих номеров.', dirtyLinen: 'Грязное белье',
  dndWarning: 'Не входите: номер имеет статус DND. Укажите причину отсутствия доступа.', quantityHint: 'Введите фактически собранные количества. Сохранение обновит также записи менеджера.', save: 'Сохранить собранное белье', nothingButton: 'Нечего собирать', accessLabel: 'Не удалось попасть в номер', reasonPlaceholder: 'DND, отказ гостя, занято…', accessButton: 'Указать причину отсутствия доступа', saving: 'Безопасное сохранение…',
  syncError: 'Не удалось синхронизировать задачи. Повторите попытку перед вводом количества.', newDayError: 'Начался новый рабочий день в Будапеште. Обновите задачи.', dndError: 'Этот номер DND. Отметьте отсутствие доступа или обратитесь на ресепшен.', countError: 'Введите хотя бы одну вещь или выберите Нечего собирать.', reasonError: 'Укажите причину (DND, занято, отказ гостя и т. д.).', successCollected: 'Белье собрано, записи менеджера обновлены.', successNothing: 'Номер записан: нечего собирать.', successBlocked: 'Причина отсутствия доступа записана.', saveError: 'Сбор белья не сохранен. Задача не отмечена выполненной.', quantity: 'количество',
};

const languages: Record<string, LaundryCopy> = { en, hu, es, vi, mn, az, tl, uk, ru };
export const laundryCopy = (language: string): LaundryCopy => languages[language] || en;
