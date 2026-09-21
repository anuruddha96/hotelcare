// Existing worker language strings retained when the ticket-content translation panel is enabled.
// Dynamic ticket text is translated independently by the authorized Edge Function.
export const maintenanceStaffLanguageOverrides: Record<string, Record<string, string>> = {
  es: {
    subtitle: 'Trabaje solo en los tickets asignados a usted para este hotel.', signedIn: 'Registrado', notSignedIn: 'Regístrese antes de comenzar', noTasks: 'No tiene tareas de mantenimiento asignadas.',
    room: 'Habitación', statusOpen: 'Abierto', statusProgress: 'En curso', statusHold: 'Pendiente', statusApproval: 'Esperando aprobación', statusDone: 'Hecho',
    note: 'Añadir nota', hold: 'Pendiente / pausa', resume: 'Reanudar', complete: 'Completar', holdReason: '¿Por qué está pendiente?',
    parts: 'Esperando piezas', purchase: 'Compra en curso', access: 'Esperando acceso a la habitación', approvalReason: 'Esperando aprobación', contractor: 'Se necesita contratista externo', other: 'Otro',
    cancel: 'Cancelar', pendingDetails: 'Añada detalles para que el supervisor sepa qué bloquea la reparación.', saveHold: 'Guardar motivo', saveNote: 'Guardar nota', notePlaceholder: 'Escriba una actualización para el supervisor…',
    resolutionPlaceholder: 'Describa la reparación y el trabajo realizado…', photoRequired: 'Añada una foto final antes de enviar.', submitApproval: 'Enviar para aprobación',
    workStarted: 'Trabajo iniciado', holdSaved: 'Ticket marcado como pendiente', resumed: 'Trabajo reanudado', noteSaved: 'Nota añadida', submitted: 'Enviado para aprobación del supervisor', failed: 'La acción falló',
  },
  vi: {
    subtitle: 'Chỉ xử lý các phiếu được giao cho bạn tại khách sạn này.', signedIn: 'Đã đăng nhập', notSignedIn: 'Hãy đăng nhập trước khi bắt đầu', noTasks: 'Không có công việc bảo trì được giao.',
    room: 'Phòng', statusOpen: 'Mở', statusProgress: 'Đang xử lý', statusHold: 'Đang chờ', statusApproval: 'Chờ duyệt', statusDone: 'Hoàn tất',
    start: 'Bắt đầu', note: 'Thêm ghi chú', hold: 'Đang chờ', resume: 'Tiếp tục', complete: 'Hoàn tất công việc', holdReason: 'Vì sao đang chờ?',
    pendingDetails: 'Thêm chi tiết để giám sát biết điều gì đang cản trở việc sửa chữa.', saveHold: 'Lưu lý do', saveNote: 'Lưu ghi chú', resolutionPlaceholder: 'Mô tả công việc đã sửa…', submitApproval: 'Gửi để giám sát duyệt',
    history: 'Công việc hoàn tất gần đây', refresh: 'Làm mới',
  },
  mn: {
    subtitle: 'Зөвхөн энэ зочид буудалд танд хуваарилсан ажлыг гүйцэтгэнэ.', signedIn: 'Нэвтэрсэн', notSignedIn: 'Ажил эхлэхийн өмнө нэвтэрнэ үү', noTasks: 'Танд хуваарилсан засварын ажил алга.',
    room: 'Өрөө', statusOpen: 'Нээлттэй', statusProgress: 'Хийгдэж байна', statusHold: 'Хүлээгдэж байна', statusApproval: 'Зөвшөөрөл хүлээж байна', statusDone: 'Дууссан',
    start: 'Ажил эхлэх', note: 'Тэмдэглэл', hold: 'Хүлээгдэж байна', resume: 'Үргэлжлүүлэх', complete: 'Ажил дуусгах', holdReason: 'Яагаад хүлээгдэж байна?',
    saveHold: 'Шалтгаан хадгалах', saveNote: 'Тэмдэглэл хадгалах', submitApproval: 'Хянагчид зөвшөөрүүлэхээр илгээх', refresh: 'Шинэчлэх',
  },
  az: {
    subtitle: 'Yalnız bu hoteldə sizə təyin edilmiş tapşırıqlar üzərində işləyin.', signedIn: 'Giriş edilib', notSignedIn: 'İşə başlamazdan əvvəl giriş edin', noTasks: 'Sizə təyin edilmiş texniki xidmət tapşırığı yoxdur.',
    room: 'Otaq', statusOpen: 'Açıq', statusProgress: 'İşlənir', statusHold: 'Gözləmədə', statusApproval: 'Təsdiq gözləyir', statusDone: 'Tamamlandı',
    start: 'İşə başla', note: 'Qeyd əlavə et', hold: 'Gözləmədə', resume: 'Davam et', complete: 'İşi tamamla', holdReason: 'Niyə gözləmədədir?',
    saveHold: 'Səbəbi saxla', saveNote: 'Qeydi saxla', submitApproval: 'Nəzarətçi təsdiqinə göndər', refresh: 'Yenilə',
  },
  tl: {
    subtitle: 'Gawin lamang ang mga ticket na naka-assign sa iyo para sa hotel na ito.', signedIn: 'Naka-sign in', notSignedIn: 'Mag-sign in bago magsimula', noTasks: 'Walang maintenance task na naka-assign sa iyo.',
    room: 'Kuwarto', statusOpen: 'Bukas', statusProgress: 'Ginagawa', statusHold: 'Pending', statusApproval: 'Naghihintay ng approval', statusDone: 'Tapos',
    start: 'Simulan ang trabaho', note: 'Magdagdag ng note', hold: 'Pending / hold', resume: 'Ipagpatuloy', complete: 'Tapusin ang trabaho',
    cancel: 'Kanselahin', submitApproval: 'Ipadala para sa approval', refresh: 'I-refresh',
  },
  uk: {
    subtitle: 'Працюйте лише із заявками, призначеними вам у цьому готелі.', signedIn: 'Вхід виконано', notSignedIn: 'Увійдіть перед початком роботи', noTasks: 'Немає призначених вам заявок.',
    room: 'Кімната', statusOpen: 'Відкрита', statusProgress: 'У роботі', statusHold: 'Очікує', statusApproval: 'Очікує схвалення', statusDone: 'Готово',
    start: 'Почати роботу', note: 'Додати нотатку', hold: 'Очікує / пауза', resume: 'Продовжити', complete: 'Завершити роботу',
    holdReason: 'Чому заявка очікує?', saveHold: 'Зберегти причину', saveNote: 'Зберегти нотатку', cancel: 'Скасувати', submitApproval: 'Надіслати на схвалення', refresh: 'Оновити',
  },
  ru: {
    subtitle: 'Работайте только с заявками, назначенными вам в этом отеле.', signedIn: 'Вход выполнен', notSignedIn: 'Войдите перед началом работы', noTasks: 'Нет назначенных вам заявок.',
    room: 'Комната', statusOpen: 'Открыта', statusProgress: 'В работе', statusHold: 'Ожидание', statusApproval: 'Ожидает одобрения', statusDone: 'Готово',
    start: 'Начать работу', note: 'Добавить заметку', hold: 'Ожидание / пауза', resume: 'Продолжить', complete: 'Завершить работу',
    holdReason: 'Почему заявка ожидает?', saveHold: 'Сохранить причину', saveNote: 'Сохранить заметку', cancel: 'Отмена', submitApproval: 'Отправить на одобрение', refresh: 'Обновить',
  },
  si: {
    title: 'මගේ නඩත්තු කාර්යයන්', active: 'සක්‍රීය', approval: 'අනුමැතියට රැඳී ඇත', done: 'අවසන්', room: 'කාමරය', start: 'වැඩ අරඹන්න',
    note: 'සටහනක් එකතු කරන්න', complete: 'වැඩ අවසන් කරන්න', refresh: 'නැවුම් කරන්න',
  },
};
