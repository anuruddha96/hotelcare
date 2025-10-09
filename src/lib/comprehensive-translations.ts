// Comprehensive translations to be added to useTranslation.tsx
// This includes all missing translations for attendance, approval, team management,
// performance, PMS, photos, linen, reports, and minibar sections

export const additionalTranslations = {
  en: {
    // Attendance - complete
    'attendance.title': 'Attendance Management',
    'attendance.checkIn': 'Check In',
    'attendance.checkOut': 'Check Out',
    'attendance.currentLocation': 'Current Location',
    'attendance.notCheckedIn': 'Not Checked In',
    'attendance.addNotes': 'Add notes for today...',
    'attendance.readyToStart': 'Ready to start?',
    'attendance.swipeToCheckIn': 'Swipe right to check in',
    'attendance.workStatus': 'Work Status & Attendance',
    
    // Approval - complete
    'approval.pendingApprovals': 'Pending Approvals',
    'approval.reviewTasks': 'Review completed housekeeping tasks',
    'approval.noTasksPending': 'No Tasks Pending Review',
    'approval.allTasksReviewed': 'All completed tasks have been reviewed for this date',
    'approval.pendingBreakRequests': 'Pending Break Requests',
    'approval.noPendingBreakRequests': 'No pending break requests',
    'approval.staff': 'Staff',
    'approval.staffManagement': 'Staff Management',
    
    // Team - complete
    'team.management': 'Team Management',
    'team.assignRoom': 'Assign Room',
    'team.progress': 'Progress',
    'team.done': 'Done',
    'team.working': 'Working',
    'team.pending': 'Pending',
    'team.clickToView': 'Click to view',
    'team.rooms': 'rooms',
    
    // Performance - complete
    'performance.leaderboard': 'Performance Leaderboard',
    'performance.stats': 'Performance Stats',
    'performance.scoreBreakdown': 'Performance Score Breakdown',
    'performance.howCalculated': 'How Performance Score is Calculated',
    'performance.speed': 'Speed',
    'performance.speedDesc': 'Daily cleaning (20pts) + Checkout cleaning (15pts) - Faster = More points',
    'performance.punctuality': 'Punctuality',
    'performance.punctualityDesc': 'Based on check-in times before 9:00 AM',
    'performance.productivity': 'Productivity',
    'performance.productivityDesc': 'Total rooms completed (0.5pt per room, max 25pts)',
    'performance.efficiency': 'Efficiency',
    'performance.efficiencyDesc': 'Average efficiency score from completed tasks',
    'performance.bestPerformers': 'Best Performers Selection',
    'performance.bestTime': 'Best Time',
    'performance.fastestCompletion': 'Fastest room completion (minutes)',
    
    // PMS - complete
    'pms.dataUpload': 'PMS Data Upload',
    'pms.uploadFile': 'Upload PMS File',
    'pms.selectFile': 'Select Excel file',
    'pms.uploadHistory': 'Upload History',
    'pms.processedRooms': 'Processed Rooms',
    
    // Photos - complete
    'photos.completionManagement': 'Room Completion Photos Management',
    'photos.dndManagement': 'Do Not Disturb (DND) Photos Management',
    'photos.completion': 'Room Completion Photos',
    'photos.dnd': 'DND Photos',
    
    // Linen - complete  
    'linen.management': 'Dirty Linen Management',
    'linen.items': 'Linen Items',
    'linen.count': 'Count',
    'linen.total': 'Total',
    'linen.myCart': 'My Dirty Linen Cart',
    'linen.todayTotal': "Today's Total",
    'linen.breakdown': 'Breakdown by Type',
    'linen.detailedRecords': 'Detailed Records',
    'linen.emptyCart': 'No items collected yet',
    'linen.collectionSummary': 'Collection Summary',
    'linen.housekeepers': 'Housekeepers',
    'linen.totalCollected': 'Total Collected',
    'linen.byHousekeeper': 'By Housekeeper',
    'linen.byItemType': 'By Item Type',
    'linen.bathMat': 'Bath Mat',
    'linen.bedSheetsQueenSize': 'Bed Sheets Queen Size',
    'linen.bedSheetsTwinSize': 'Bed Sheets Twin Size',
    'linen.bigPillow': 'Big Pillow',
    'linen.bigTowel': 'Big Towel',
    'linen.duvetCovers': 'Duvet Covers',
    'linen.smallTowel': 'Small Towel',
    'linen.total': 'TOTAL',
    
    // Housekeeping tab names
    'housekeeping.tabs.roomPhotos': 'Room Photos',
    'housekeeping.tabs.dndPhotos': 'DND Photos',
    'housekeeping.tabs.maintenance': 'Maintenance',
    'housekeeping.tabs.lostFound': 'Lost & Found',
    'housekeeping.tabs.dirtyLinen': 'Dirty Linen',
    'housekeeping.tabs.generalTasks': 'General Tasks',

    // PMS Upload
    'pms.title': 'PMS File Upload',
    'pms.description': 'Upload an Excel file from the PMS system for automatic room status updates and cleaning task creation',
    'pms.hotelFilter': 'Hotel Filter Active',
    'pms.currentlyOperating': 'Currently operating on:',
    'pms.onlyRoomsAffected': 'Only rooms in this hotel will be affected by the PMS upload.',
    'pms.dataResetWarning': 'Data Reset Warning',
    'pms.uploadWillReset': 'Uploading a PMS file will reset all room assignments and data for',
    'pms.forCurrentDay': 'for the current day',
    'pms.dragDropFile': 'Drag & drop PMS export file, or click to browse',
    'pms.viewHistory': 'View History',

    // Supervisor
    'supervisor.pendingApprovals': 'Pending Approvals',
    'supervisor.reviewCompletedTasks': 'Review completed cleaning tasks',
    'supervisor.noTasksPending': 'No tasks pending approval',
    'supervisor.allTasksReviewed': 'All completed tasks have been reviewed',
    'supervisor.cleanedBy': 'Cleaned By',
    'supervisor.roomMarkedClean': 'Room marked as clean',
    
    // Room
    'room.label': 'Room',
    
    // Reports - complete
    'reports.attendance': 'Attendance Reports',
    'reports.export': 'Export to CSV',
    'reports.totalDays': 'Total Days',
    'reports.totalHours': 'Total Hours',
    'reports.avgHours': 'Avg Hours/Day',
    'reports.punctualDays': 'Punctual Days',
    'reports.lateArrivals': 'Late Arrivals',
    
    // Minibar - complete
    'minibar.usage': 'Minibar Usage',
    'minibar.items': 'Minibar Items',
    'minibar.tracking': 'Minibar Tracking',
    'minibar.history': 'Minibar History',
    'minibar.summary': 'Minibar Summary',
    'minibar.totalRevenue': 'Total Revenue',
    'minibar.roomsWithUsage': 'Rooms with Usage',
    'minibar.selectDateRange': 'Select Date Range',
    'minibar.viewDetails': 'View Details',
    'minibar.noData': 'No minibar usage data for selected period',
  },
  
  es: {
    // Attendance
    'attendance.title': 'Gestión de Asistencia',
    'attendance.checkIn': 'Registrar Entrada',
    'attendance.checkOut': 'Registrar Salida',
    'attendance.currentLocation': 'Ubicación Actual',
    'attendance.notCheckedIn': 'No Registrado',
    'attendance.addNotes': 'Agregar notas para hoy...',
    'attendance.readyToStart': '¿Listo para comenzar?',
    'attendance.swipeToCheckIn': 'Desliza a la derecha para registrar entrada',
    'attendance.workStatus': 'Estado de Trabajo y Asistencia',
    
    // Approval
    'approval.pendingApprovals': 'Aprobaciones Pendientes',
    'approval.reviewTasks': 'Revisar tareas de limpieza completadas',
    'approval.noTasksPending': 'No Hay Tareas Pendientes de Revisión',
    'approval.allTasksReviewed': 'Todas las tareas completadas han sido revisadas para esta fecha',
    'approval.pendingBreakRequests': 'Solicitudes de Descanso Pendientes',
    'approval.noPendingBreakRequests': 'No hay solicitudes de descanso pendientes',
    'approval.staff': 'Personal',
    'approval.staffManagement': 'Gestión del Personal',
    
    // Team
    'team.management': 'Gestión de Equipo',
    'team.assignRoom': 'Asignar Habitación',
    'team.progress': 'Progreso',
    'team.done': 'Hecho',
    'team.working': 'Trabajando',
    'team.pending': 'Pendiente',
    'team.clickToView': 'Haz clic para ver',
    'team.rooms': 'habitaciones',
    
    // Performance
    'performance.leaderboard': 'Tabla de Clasificación de Rendimiento',
    'performance.stats': 'Estadísticas de Rendimiento',
    'performance.scoreBreakdown': 'Desglose de Puntuación de Rendimiento',
    'performance.howCalculated': 'Cómo se Calcula la Puntuación de Rendimiento',
    'performance.speed': 'Velocidad',
    'performance.speedDesc': 'Limpieza diaria (20pts) + Limpieza de salida (15pts) - Más rápido = Más puntos',
    'performance.punctuality': 'Puntualidad',
    'performance.punctualityDesc': 'Basado en horarios de entrada antes de las 9:00 AM',
    'performance.productivity': 'Productividad',
    'performance.productivityDesc': 'Total de habitaciones completadas (0.5pt por habitación, máx 25pts)',
    'performance.efficiency': 'Eficiencia',
    'performance.efficiencyDesc': 'Puntuación promedio de eficiencia de tareas completadas',
    'performance.bestPerformers': 'Selección de Mejores Trabajadores',
    'performance.bestTime': 'Mejor Tiempo',
    'performance.fastestCompletion': 'Finalización de habitación más rápida (minutos)',
    
    // PMS
    'pms.dataUpload': 'Carga de Datos PMS',
    'pms.uploadFile': 'Subir Archivo PMS',
    'pms.selectFile': 'Seleccionar archivo Excel',
    'pms.uploadHistory': 'Historial de Cargas',
    'pms.processedRooms': 'Habitaciones Procesadas',
    
    // Photos
    'photos.completionManagement': 'Gestión de Fotos de Finalización de Habitaciones',
    'photos.dndManagement': 'Gestión de Fotos No Molestar (DND)',
    'photos.completion': 'Fotos de Finalización de Habitaciones',
    'photos.dnd': 'Fotos DND',
    
    // Linen
    'linen.management': 'Gestión de Ropa Sucia',
    'linen.items': 'Artículos de Ropa',
    'linen.count': 'Cantidad',
    'linen.total': 'Total',
    'linen.myCart': 'Mi Carrito de Ropa Sucia',
    'linen.todayTotal': 'Total de Hoy',
    'linen.breakdown': 'Desglose por Tipo',
    'linen.detailedRecords': 'Registros Detallados',
    'linen.emptyCart': 'Aún no se han recolectado artículos',
    'linen.collectionSummary': 'Resumen de Recolección',
    'linen.housekeepers': 'Camareras',
    'linen.totalCollected': 'Total Recolectado',
    'linen.byHousekeeper': 'Por Camarera',
    'linen.byItemType': 'Por Tipo de Artículo',
    'linen.bathMat': 'Alfombra de Baño',
    'linen.bedSheetsQueenSize': 'Sábanas Queen',
    'linen.bedSheetsTwinSize': 'Sábanas Twin',
    'linen.bigPillow': 'Almohada Grande',
    'linen.bigTowel': 'Toalla Grande',
    'linen.duvetCovers': 'Fundas de Edredón',
    'linen.smallTowel': 'Toalla Pequeña',
    
    // Room
    'room.label': 'Habitación',
    
    // Reports
    'reports.attendance': 'Informes de Asistencia',
    'reports.export': 'Exportar a CSV',
    'reports.totalDays': 'Días Totales',
    'reports.totalHours': 'Horas Totales',
    'reports.avgHours': 'Horas Promedio/Día',
    'reports.punctualDays': 'Días Puntuales',
    'reports.lateArrivals': 'Llegadas Tarde',
    
    // Minibar
    'minibar.usage': 'Uso del Minibar',
    'minibar.items': 'Artículos del Minibar',
    'minibar.tracking': 'Seguimiento del Minibar',
    'minibar.history': 'Historial del Minibar',
    'minibar.summary': 'Resumen del Minibar',
    'minibar.totalRevenue': 'Ingresos Totales',
    'minibar.roomsWithUsage': 'Habitaciones con Uso',
    'minibar.selectDateRange': 'Seleccionar Rango de Fechas',
    'minibar.viewDetails': 'Ver Detalles',
    'minibar.noData': 'No hay datos de uso del minibar para el período seleccionado',
  },
  
  vi: {
    // Attendance
    'attendance.title': 'Quản Lý Chấm Công',
    'attendance.checkIn': 'Điểm Danh Vào',
    'attendance.checkOut': 'Điểm Danh Ra',
    'attendance.currentLocation': 'Vị Trí Hiện Tại',
    'attendance.notCheckedIn': 'Chưa Điểm Danh',
    'attendance.addNotes': 'Thêm ghi chú cho hôm nay...',
    'attendance.readyToStart': 'Sẵn sàng bắt đầu?',
    'attendance.swipeToCheckIn': 'Vuốt sang phải để điểm danh',
    'attendance.workStatus': 'Trạng Thái Làm Việc & Chấm Công',
    
    // Approval
    'approval.pendingApprovals': 'Phê Duyệt Đang Chờ',
    'approval.reviewTasks': 'Xem xét các nhiệm vụ dọn phòng đã hoàn thành',
    'approval.noTasksPending': 'Không Có Nhiệm Vụ Chờ Xem Xét',
    'approval.allTasksReviewed': 'Tất cả nhiệm vụ đã hoàn thành đã được xem xét cho ngày này',
    'approval.pendingBreakRequests': 'Yêu Cầu Nghỉ Đang Chờ',
    'approval.noPendingBreakRequests': 'Không có yêu cầu nghỉ đang chờ',
    'approval.staff': 'Nhân Viên',
    'approval.staffManagement': 'Quản Lý Nhân Viên',
    
    // Team
    'team.management': 'Quản Lý Nhóm',
    'team.assignRoom': 'Giao Phòng',
    'team.progress': 'Tiến Độ',
    'team.done': 'Hoàn Thành',
    'team.working': 'Đang Làm',
    'team.pending': 'Đang Chờ',
    'team.clickToView': 'Nhấp để xem',
    'team.rooms': 'phòng',
    
    // Performance
    'performance.leaderboard': 'Bảng Xếp Hạng Hiệu Suất',
    'performance.stats': 'Thống Kê Hiệu Suất',
    'performance.scoreBreakdown': 'Phân Tích Điểm Hiệu Suất',
    'performance.howCalculated': 'Cách Tính Điểm Hiệu Suất',
    'performance.speed': 'Tốc Độ',
    'performance.speedDesc': 'Dọn phòng hàng ngày (20đ) + Dọn phòng trả (15đ) - Nhanh hơn = Nhiều điểm hơn',
    'performance.punctuality': 'Đúng Giờ',
    'performance.punctualityDesc': 'Dựa trên giờ điểm danh trước 9:00 sáng',
    'performance.productivity': 'Năng Suất',
    'performance.productivityDesc': 'Tổng số phòng hoàn thành (0.5đ mỗi phòng, tối đa 25đ)',
    'performance.efficiency': 'Hiệu Quả',
    'performance.efficiencyDesc': 'Điểm hiệu quả trung bình từ các nhiệm vụ đã hoàn thành',
    'performance.bestPerformers': 'Lựa Chọn Nhân Viên Xuất Sắc Nhất',
    'performance.bestTime': 'Thời Gian Tốt Nhất',
    'performance.fastestCompletion': 'Hoàn thành phòng nhanh nhất (phút)',
    
    // PMS
    'pms.dataUpload': 'Tải Dữ Liệu PMS',
    'pms.uploadFile': 'Tải Lên Tệp PMS',
    'pms.selectFile': 'Chọn tệp Excel',
    'pms.uploadHistory': 'Lịch Sử Tải Lên',
    'pms.processedRooms': 'Phòng Đã Xử Lý',
    
    // Photos
    'photos.completionManagement': 'Quản Lý Ảnh Hoàn Thành Phòng',
    'photos.dndManagement': 'Quản Lý Ảnh Không Làm Phiền (DND)',
    'photos.completion': 'Ảnh Hoàn Thành Phòng',
    'photos.dnd': 'Ảnh DND',
    
    // Linen
    'linen.management': 'Quản Lý Đồ Giặt Bẩn',
    'linen.items': 'Mặt Hàng Đồ Giặt',
    'linen.count': 'Số Lượng',
    'linen.total': 'Tổng Cộng',
    'linen.myCart': 'Giỏ Đồ Giặt Bẩn Của Tôi',
    'linen.todayTotal': 'Tổng Hôm Nay',
    'linen.breakdown': 'Phân Loại Theo Loại',
    'linen.detailedRecords': 'Hồ Sơ Chi Tiết',
    'linen.emptyCart': 'Chưa thu thập mặt hàng nào',
    'linen.collectionSummary': 'Tóm Tắt Thu Thập',
    'linen.housekeepers': 'Nhân Viên Dọn Phòng',
    'linen.totalCollected': 'Tổng Đã Thu Thập',
    'linen.byHousekeeper': 'Theo Nhân Viên',
    'linen.byItemType': 'Theo Loại Mặt Hàng',
    'linen.bathMat': 'Thảm Tắm',
    'linen.bedSheetsQueenSize': 'Ga Giường Queen',
    'linen.bedSheetsTwinSize': 'Ga Giường Twin',
    'linen.bigPillow': 'Gối Lớn',
    'linen.bigTowel': 'Khăn Lớn',
    'linen.duvetCovers': 'Vỏ Chăn',
    'linen.smallTowel': 'Khăn Nhỏ',
    
    // Room
    'room.label': 'Phòng',
    
    // Reports
    'reports.attendance': 'Báo Cáo Chấm Công',
    'reports.export': 'Xuất ra CSV',
    'reports.totalDays': 'Tổng Số Ngày',
    'reports.totalHours': 'Tổng Số Giờ',
    'reports.avgHours': 'Giờ Trung Bình/Ngày',
    'reports.punctualDays': 'Ngày Đúng Giờ',
    'reports.lateArrivals': 'Đến Muộn',
    
    // Minibar
    'minibar.usage': 'Sử Dụng Minibar',
    'minibar.items': 'Mặt Hàng Minibar',
    'minibar.tracking': 'Theo Dõi Minibar',
    'minibar.history': 'Lịch Sử Minibar',
    'minibar.summary': 'Tóm Tắt Minibar',
    'minibar.totalRevenue': 'Tổng Doanh Thu',
    'minibar.roomsWithUsage': 'Phòng Có Sử Dụng',
    'minibar.selectDateRange': 'Chọn Khoảng Thời Gian',
    'minibar.viewDetails': 'Xem Chi Tiết',
    'minibar.noData': 'Không có dữ liệu sử dụng minibar cho khoảng thời gian đã chọn',
  },
  
  mn: {
    // Attendance
    'attendance.title': 'Ирцийн Удирдлага',
    'attendance.checkIn': 'Ирсэн',
    'attendance.checkOut': 'Явсан',
    'attendance.currentLocation': 'Одоогийн Байршил',
    'attendance.notCheckedIn': 'Ирээгүй',
    'attendance.addNotes': 'Өнөөдрийн тэмдэглэл нэмэх...',
    'attendance.readyToStart': 'Эхлэхэд бэлэн үү?',
    'attendance.swipeToCheckIn': 'Ирцээ бүртгүүлэхийн тулд баруун тийш шудрах',
    'attendance.workStatus': 'Ажлын Байдал ба Ирц',
    
    // Approval
    'approval.pendingApprovals': 'Хүлээгдэж Буй Зөвшөөрөл',
    'approval.reviewTasks': 'Дууссан цэвэрлэгээний ажлуудыг хянах',
    'approval.noTasksPending': 'Хянахаар Хүлээгдэж Буй Ажил Байхгүй',
    'approval.allTasksReviewed': 'Энэ өдрийн бүх дууссан ажлууд хянагдсан',
    'approval.pendingBreakRequests': 'Хүлээгдэж Буй Амралтын Хүсэлт',
    'approval.noPendingBreakRequests': 'Хүлээгдэж буй амралтын хүсэлт байхгүй',
    'approval.staff': 'Ажилтан',
    'approval.staffManagement': 'Ажилтны Удирдлага',
    
    // Team
    'team.management': 'Багийн Удирдлага',
    'team.assignRoom': 'Өрөө Хуваарилах',
    'team.progress': 'Явц',
    'team.done': 'Дууссан',
    'team.working': 'Ажиллаж Байна',
    'team.pending': 'Хүлээгдэж Байна',
    'team.clickToView': 'Үзэхийн тулд дарах',
    'team.rooms': 'өрөө',
    
    // Performance
    'performance.leaderboard': 'Ажиллагааны Жагсаалт',
    'performance.stats': 'Ажиллагааны Статистик',
    'performance.scoreBreakdown': 'Ажиллагааны Оноо Задлал',
    'performance.howCalculated': 'Ажиллагааны Оноог Хэрхэн Тооцох',
    'performance.speed': 'Хурд',
    'performance.speedDesc': 'Өдөр тутмын цэвэрлэгээ (20о) + Гарах цэвэрлэгээ (15о) - Хурдан = Илүү оноо',
    'performance.punctuality': 'Цаг баримтлал',
    'performance.punctualityDesc': '9:00 цагаас өмнө ирсэн цаг дээр үндэслэнэ',
    'performance.productivity': 'Бүтээмж',
    'performance.productivityDesc': 'Нийт дууссан өрөө (өрөө бүрт 0.5о, хамгийн ихдээ 25о)',
    'performance.efficiency': 'Үр Ашиг',
    'performance.efficiencyDesc': 'Дууссан ажлуудын дундаж үр ашгийн оноо',
    'performance.bestPerformers': 'Шилдэг Гүйцэтгэгчдийн Сонголт',
    'performance.bestTime': 'Хамгийн Сайн Цаг',
    'performance.fastestCompletion': 'Хамгийн хурдан өрөө дуусгах (минут)',
    
    // PMS
    'pms.dataUpload': 'PMS Өгөгдөл Байршуулах',
    'pms.uploadFile': 'PMS Файл Байршуулах',
    'pms.selectFile': 'Excel файл сонгох',
    'pms.uploadHistory': 'Байршуулалтын Түүх',
    'pms.processedRooms': 'Боловсруулсан Өрөө',
    
    // Photos
    'photos.completionManagement': 'Өрөөний Дууссан Зургийн Удирдлага',
    'photos.dndManagement': 'Бүү Саад Бол (DND) Зургийн Удирдлага',
    'photos.completion': 'Өрөөний Дууссан Зураг',
    'photos.dnd': 'DND Зураг',
    
    // Linen
    'linen.management': 'Бохир Ор Дэрний Удирдлага',
    'linen.items': 'Ор Дэрний Зүйлс',
    'linen.count': 'Тоо',
    'linen.total': 'Нийт',
    'linen.myCart': 'Миний Бохир Ор Дэрний Сагс',
    'linen.todayTotal': 'Өнөөдрийн Нийт',
    'linen.breakdown': 'Төрлөөр Ангилах',
    'linen.detailedRecords': 'Нарийвчилсан Бүртгэл',
    'linen.emptyCart': 'Одоогоор зүйл цуглуулаагүй байна',
    'linen.collectionSummary': 'Цуглуулалтын Хураангуй',
    'linen.housekeepers': 'Үйлчлэгч Нар',
    'linen.totalCollected': 'Нийт Цуглуулсан',
    'linen.byHousekeeper': 'Үйлчлэгчээр',
    'linen.byItemType': 'Төрлөөр',
    'linen.bathMat': 'Ваннын Дэвсгэр',
    'linen.bedSheetsQueenSize': 'Ор Дэрний Даавуу Queen',
    'linen.bedSheetsTwinSize': 'Ор Дэрний Даавуу Twin',
    'linen.bigPillow': 'Том Дэр',
    'linen.bigTowel': 'Том Алчуур',
    'linen.duvetCovers': 'Хөнжлийн Боолт',
    'linen.smallTowel': 'Жижиг Алчуур',
    
    // Room
    'room.label': 'Өрөө',
    
    // Reports
    'reports.attendance': 'Ирцийн Тайлан',
    'reports.export': 'CSV руу экспортлох',
    'reports.totalDays': 'Нийт Өдөр',
    'reports.totalHours': 'Нийт Цаг',
    'reports.avgHours': 'Дундаж Цаг/Өдөр',
    'reports.punctualDays': 'Цаг баримталсан Өдрүүд',
    'reports.lateArrivals': 'Хоцорсон',
    
    // Minibar
    'minibar.usage': 'Мини Барын Хэрэглээ',
    'minibar.items': 'Мини Барын Зүйлс',
    'minibar.tracking': 'Мини Барын Хянах',
    'minibar.history': 'Мини Барын Түүх',
    'minibar.summary': 'Мини Барын Хураангуй',
    'minibar.totalRevenue': 'Нийт Орлого',
    'minibar.roomsWithUsage': 'Хэрэглээтэй Өрөө',
    'minibar.selectDateRange': 'Огнооны Хязгаар Сонгох',
    'minibar.viewDetails': 'Дэлгэрэнгүй Харах',
    'minibar.noData': 'Сонгосон хугацаанд мини барын хэрэглээний өгөгдөл байхгүй',
  },
  
  hu: {
    // Attendance
    'attendance.title': 'Jelenlét Kezelés',
    'attendance.checkIn': 'Bejelentkezés',
    'attendance.checkOut': 'Kijelentkezés',
    'attendance.currentLocation': 'Jelenlegi Hely',
    'attendance.notCheckedIn': 'Nem Jelentkezett Be',
    'attendance.addNotes': 'Jegyzetek hozzáadása mára...',
    'attendance.readyToStart': 'Készen áll az indulásra?',
    'attendance.swipeToCheckIn': 'Húzza jobbra a bejelentkezéshez',
    'attendance.workStatus': 'Munka Állapot és Jelenlét',
    
    // Approval
    'approval.pendingApprovals': 'Függőben Lévő Jóváhagyások',
    'approval.reviewTasks': 'Befejezett takarítási feladatok áttekintése',
    'approval.noTasksPending': 'Nincs Feladat Áttekintésre Várva',
    'approval.allTasksReviewed': 'Minden befejezett feladat áttekintésre került ezen a napon',
    'approval.pendingBreakRequests': 'Függőben Lévő Szünetkérések',
    'approval.noPendingBreakRequests': 'Nincsenek függőben lévő szünetkérések',
    'approval.staff': 'Személyzet',
    'approval.staffManagement': 'Személyzet Kezelés',
    
    // Team
    'team.management': 'Csapat Kezelés',
    'team.assignRoom': 'Szoba Hozzárendelés',
    'team.progress': 'Haladás',
    'team.done': 'Kész',
    'team.working': 'Dolgozik',
    'team.pending': 'Függőben',
    'team.clickToView': 'Kattintson a megtekintéshez',
    'team.rooms': 'szobák',
    
    // Performance
    'performance.leaderboard': 'Teljesítmény Rangsor',
    'performance.stats': 'Teljesítmény Statisztika',
    'performance.scoreBreakdown': 'Teljesítmény Pontok Lebontása',
    'performance.howCalculated': 'Hogyan Kerül Kiszámításra a Teljesítmény Pontszám',
    'performance.speed': 'Sebesség',
    'performance.speedDesc': 'Napi takarítás (20pt) + Távozó szoba (15pt) - Gyorsabb = Több pont',
    'performance.punctuality': 'Pontosság',
    'performance.punctualityDesc': '9:00 előtti érkezések alapján',
    'performance.productivity': 'Termelékenység',
    'performance.productivityDesc': 'Összes befejezett szoba (0.5pt szobánként, max 25pt)',
    'performance.efficiency': 'Hatékonyság',
    'performance.efficiencyDesc': 'Átlagos hatékonyság a befejezett feladatok alapján',
    'performance.bestPerformers': 'Legjobb Teljesítők Kiválasztása',
    'performance.bestTime': 'Legjobb Idő',
    'performance.fastestCompletion': 'Leggyorsabb szoba befejezés (percben)',
    
    // PMS
    'pms.dataUpload': 'PMS Adat Feltöltés',
    'pms.uploadFile': 'PMS Fájl Feltöltés',
    'pms.selectFile': 'Excel fájl kiválasztása',
    'pms.uploadHistory': 'Feltöltési Előzmények',
    'pms.processedRooms': 'Feldolgozott Szobák',
    
    // Photos
    'photos.completionManagement': 'Szoba Befejezési Fotók Kezelése',
    'photos.dndManagement': 'Ne Zavarjon (DND) Fotók Kezelése',
    'photos.completion': 'Szoba Befejezési Fotók',
    'photos.dnd': 'DND Fotók',
    
    // Linen
    'linen.management': 'Piszkos Ágynemű Kezelés',
    'linen.items': 'Ágynemű Cikkek',
    'linen.count': 'Darab',
    'linen.total': 'Összesen',
    'linen.myCart': 'Piszkos Ágynemű Kosár',
    'linen.todayTotal': 'Mai Összesen',
    'linen.breakdown': 'Típus Szerinti Bontás',
    'linen.detailedRecords': 'Részletes Bejegyzések',
    'linen.emptyCart': 'Még nincsenek összegyűjtött tételek',
    'linen.collectionSummary': 'Gyűjtési Összesítés',
    'linen.housekeepers': 'Takarítók',
    'linen.totalCollected': 'Összes Begyűjtött',
    'linen.byHousekeeper': 'Takarító Szerint',
    'linen.byItemType': 'Cikk Típus Szerint',
    'linen.bathMat': 'Fürdőszoba Szőnyeg',
    'linen.bedSheetsQueenSize': 'Queen Méretű Lepedő',
    'linen.bedSheetsTwinSize': 'Twin Méretű Lepedő',
    'linen.bigPillow': 'Nagy Párna',
    'linen.bigTowel': 'Nagy Törölköző',
    'linen.duvetCovers': 'Paplan Huzat',
    'linen.smallTowel': 'Kis Törölköző',
    
    // Room
    'room.label': 'Szoba',
    
    // Reports
    'reports.attendance': 'Jelenlét Jelentések',
    'reports.export': 'Exportálás CSV-be',
    'reports.totalDays': 'Összes Nap',
    'reports.totalHours': 'Összes Óra',
    'reports.avgHours': 'Átlag Óra/Nap',
    'reports.punctualDays': 'Pontos Napok',
    'reports.lateArrivals': 'Késések',
    
    // Minibar
    'minibar.usage': 'Minibar Használat',
    'minibar.items': 'Minibar Tételek',
    'minibar.tracking': 'Minibar Követés',
    'minibar.history': 'Minibar Előzmények',
    'minibar.summary': 'Minibar Összesítés',
    'minibar.totalRevenue': 'Összes Bevétel',
    'minibar.roomsWithUsage': 'Szobák Használattal',
    'minibar.selectDateRange': 'Dátumtartomány Kiválasztása',
    'minibar.viewDetails': 'Részletek Megtekintése',
    'minibar.noData': 'Nincs minibar használati adat a kiválasztott időszakra',

    // Housekeeping tab names
    // Housekeeping tab names - added to en section
    // PMS Upload - added to en section
    // Supervisor/Pending approvals - added to en section
    // Attendance - already exists in previous section

  },
};
