import { createContext, useContext, useEffect, useState } from 'react';

const translations = {
  en: {
    // Dashboard
    'dashboard.title': 'Hotel Management Dashboard',
    'dashboard.subtitle': 'Manage all service requests of RD Hotels',
    'dashboard.tickets': 'Tickets',
    'dashboard.rooms': 'Rooms',
    'dashboard.reports': 'Reports',
    'dashboard.manageUsers': 'Manage Users',
    'dashboard.newTicket': 'New Ticket',
    
    // Tickets
    'tickets.total': 'Total',
    'tickets.open': 'Open',
    'tickets.inProgress': 'In Progress',
    'tickets.completed': 'Completed',
    'tickets.search': 'Search tickets...',
    'tickets.allStatus': 'All Status',
    'tickets.allPriority': 'All Priority',
    'tickets.priority.urgent': 'Urgent',
    'tickets.priority.high': 'High',
    'tickets.priority.medium': 'Medium',
    'tickets.priority.low': 'Low',
    
    // Room Management
    'rooms.title': 'Room Management',
    'rooms.subtitle': 'Monitor and manage hotel room status',
    'rooms.search': 'Search by room number or hotel...',
    'rooms.addRoom': 'Add Room',
    'rooms.minibarSettings': 'Minibar Settings',
    'rooms.allHotels': 'All Hotels',
    'rooms.allStatus': 'All Status',
    'rooms.clean': 'Clean',
    'rooms.dirty': 'Dirty',
    'rooms.maintenance': 'Maintenance',
    'rooms.outOfOrder': 'Out Of Order',
    
    // Room Status
    'room.status.clean': 'Clean',
    'room.status.dirty': 'Dirty',
    'room.status.maintenance': 'Maintenance',
    'room.status.out_of_order': 'Out of Order',
    
    // Create Room
    'createRoom.title': 'Create New Room',
    'createRoom.hotel': 'Hotel',
    'createRoom.roomName': 'Room Name',
    'createRoom.roomNumber': 'Room Number',
    'createRoom.roomType': 'Room Type',
    'createRoom.floorNumber': 'Floor Number',
    'createRoom.create': 'Create Room',
    
    // Common
    'common.loading': 'Loading...',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.edit': 'Edit',
    'common.delete': 'Delete',
    'common.search': 'Search',
    'common.filter': 'Filter',
    'common.status': 'Status',
    'common.priority': 'Priority',
    'common.hotel': 'Hotel',
    'common.room': 'Room',
    'common.profile': 'Profile',
    'common.settings': 'Settings',
    'common.logout': 'Log out',
    
    // Language
    'language.changed': 'Language Changed',
    'language.switchedTo': 'Language switched to',
    
    // PMS Upload
    'pms.title': 'PMS Data Upload',
    'pms.subtitle': 'Upload Excel file from your PMS system to automatically update room statuses and create cleaning assignments',
    'pms.dragDrop': 'Drag & drop your PMS export file here, or click to browse',
    'pms.dropHere': 'Drop your PMS file here',
    'pms.releaseToUpload': 'Release to upload your file',
    'pms.processing': 'Processing PMS data...',
    'pms.backgroundUpload': 'Running in background',
    'pms.uploadComplete': 'Upload Complete',
    'pms.roomsProcessed': 'Rooms Processed',
    'pms.statusesUpdated': 'Statuses Updated',
    'pms.tasksAssigned': 'Tasks Assigned',
    'pms.checkoutRooms': 'Checkout Rooms',
    'pms.dailyCleaningRooms': 'Daily Cleaning Rooms',
    'pms.issuesFound': 'Issues Found',
    'pms.uploadAnother': 'Upload Another File',
    'pms.checkoutToday': 'Checkout Today',
    'pms.stayingGuests': 'Staying Guests',
    'pms.departureTime': 'Departure Time',
    'rooms.checkoutRoom': 'Checkout Room',
    'rooms.dailyCleaningRoom': 'Daily Cleaning',
    'rooms.checkoutTime': 'Checkout Time',
    'rooms.stayingGuest': 'Staying Guest',
    'rooms.assignmentDetails': 'Assignment Details',
    'rooms.assignToStaff': 'Assign to Staff',
    'rooms.selectStaff': 'Select housekeeping staff',
    'rooms.assignmentType': 'Assignment Type',
    'rooms.deepCleaning': 'Deep Cleaning',
    'rooms.selectRooms': 'Select Rooms',
    'rooms.selected': 'selected',
    'rooms.selectAll': 'Select All',
    'rooms.clearAll': 'Clear All',
    'rooms.creatingAssignments': 'Creating Assignments...',
    'rooms.assign': 'Assign',
    'rooms.rooms': 'Room(s)',
    
    // Housekeeping
    'housekeeping.myTasks': 'My Tasks',
    'housekeeping.quickAssign': 'Quick Assign',
    'housekeeping.pmsUpload': 'PMS Upload',
    'housekeeping.performance': 'Performance',
    'housekeeping.staff': 'Staff',
    'housekeeping.teamView': 'Team View',
    'housekeeping.accessRestricted': 'Access restricted to housekeeping staff and managers',
  },
  
  hu: {
    // Dashboard
    'dashboard.title': 'Szálloda Menedzsment Irányítópult',
    'dashboard.subtitle': 'RD Szállodák összes szolgáltatási kérésének kezelése',
    'dashboard.tickets': 'Jegyek',
    'dashboard.rooms': 'Szobák',
    'dashboard.reports': 'Jelentések',
    'dashboard.manageUsers': 'Felhasználók kezelése',
    'dashboard.newTicket': 'Új jegy',
    
    // Tickets
    'tickets.total': 'Összesen',
    'tickets.open': 'Nyitott',
    'tickets.inProgress': 'Folyamatban',
    'tickets.completed': 'Befejezett',
    'tickets.search': 'Jegyek keresése...',
    'tickets.allStatus': 'Minden állapot',
    'tickets.allPriority': 'Minden prioritás',
    'tickets.priority.urgent': 'Sürgős',
    'tickets.priority.high': 'Magas',
    'tickets.priority.medium': 'Közepes',
    'tickets.priority.low': 'Alacsony',
    
    // Room Management
    'rooms.title': 'Szoba kezelés',
    'rooms.subtitle': 'Szállodai szobák állapotának figyelése és kezelése',
    'rooms.search': 'Keresés szobaszám vagy szálloda szerint...',
    'rooms.addRoom': 'Szoba hozzáadása',
    'rooms.minibarSettings': 'Minibar beállítások',
    'rooms.allHotels': 'Minden szálloda',
    'rooms.allStatus': 'Minden állapot',
    'rooms.clean': 'Tiszta',
    'rooms.dirty': 'Piszkos',
    'rooms.maintenance': 'Karbantartás',
    'rooms.outOfOrder': 'Használaton kívül',
    
    // Room Status
    'room.status.clean': 'Tiszta',
    'room.status.dirty': 'Piszkos',
    'room.status.maintenance': 'Karbantartás',
    'room.status.out_of_order': 'Használaton kívül',
    
    // Create Room
    'createRoom.title': 'Új szoba létrehozása',
    'createRoom.hotel': 'Szálloda',
    'createRoom.roomName': 'Szoba neve',
    'createRoom.roomNumber': 'Szobaszám',
    'createRoom.roomType': 'Szoba típusa',
    'createRoom.floorNumber': 'Emelet száma',
    'createRoom.create': 'Szoba létrehozása',
    
    // Common
    'common.loading': 'Betöltés...',
    'common.save': 'Mentés',
    'common.cancel': 'Mégse',
    'common.close': 'Bezárás',
    'common.edit': 'Szerkesztés',
    'common.delete': 'Törlés',
    'common.search': 'Keresés',
    'common.filter': 'Szűrés',
    'common.status': 'Állapot',
    'common.priority': 'Prioritás',
    'common.hotel': 'Szálloda',
    'common.room': 'Szoba',
    'common.profile': 'Profil',
    'common.settings': 'Beállítások',
    'common.logout': 'Kijelentkezés',
    
    // Language
    'language.changed': 'Nyelv megváltoztatva',
    'language.switchedTo': 'Nyelv váltva erre:',
    
    // PMS Upload
    'pms.title': 'PMS Adatok Feltöltése',
    'pms.subtitle': 'Töltse fel az Excel fájlt a PMS rendszeréből a szobák állapotának automatikus frissítéséhez és takarítási feladatok létrehozásához',
    'pms.dragDrop': 'Húzza ide a PMS export fájlt, vagy kattintson a tallózáshoz',
    'pms.dropHere': 'Dobja ide a PMS fájlt',
    'pms.releaseToUpload': 'Engedje el a feltöltéshez',
    'pms.processing': 'PMS adatok feldolgozása...',
    'pms.backgroundUpload': 'Háttérben fut',
    'pms.uploadComplete': 'Feltöltés kész',
    'pms.roomsProcessed': 'Feldolgozott szobák',
    'pms.statusesUpdated': 'Frissített állapotok',
    'pms.tasksAssigned': 'Hozzárendelt feladatok',
    'pms.checkoutRooms': 'Kijelentkezős szobák',
    'pms.dailyCleaningRooms': 'Napi takarítás szobák',
    'pms.issuesFound': 'Talált problémák',
    'pms.uploadAnother': 'Másik fájl feltöltése',
    'pms.checkoutToday': 'Ma kijelentkezik',
    'pms.stayingGuests': 'Maradó vendégek',
    'pms.departureTime': 'Távozás',
    'rooms.checkoutRoom': 'Kijelentkezős szoba',
    'rooms.dailyCleaningRoom': 'Napi takarítás',
    'rooms.checkoutTime': 'Kijelentkezés ideje',
    'rooms.stayingGuest': 'Maradó vendég',
    'rooms.assignmentDetails': 'Feladat részletei',
    'rooms.assignToStaff': 'Személyzethez rendelés',
    'rooms.selectStaff': 'Takarító személyzet kiválasztása',
    'rooms.assignmentType': 'Feladat típusa',
    'rooms.deepCleaning': 'Mélyítő takarítás',
    'rooms.selectRooms': 'Szobák kiválasztása',
    'rooms.selected': 'kiválasztva',
    'rooms.selectAll': 'Összes kiválasztása',
    'rooms.clearAll': 'Összes törlése',
    'rooms.creatingAssignments': 'Feladatok létrehozása...',
    'rooms.assign': 'Hozzárendelés',
    'rooms.rooms': 'Szoba(k)',
    
    // Housekeeping
    'housekeeping.myTasks': 'Feladataim',
    'housekeeping.quickAssign': 'Gyors hozzárendelés',
    'housekeeping.pmsUpload': 'PMS feltöltés',
    'housekeeping.performance': 'Teljesítmény',
    'housekeeping.staff': 'Személyzet',
    'housekeeping.teamView': 'Csapat nézet',
    'housekeeping.accessRestricted': 'Hozzáférés korlátozott takarítószemélyzetre és vezetőkre',
  },
  
  es: {
    // Dashboard
    'dashboard.title': 'Panel de Gestión Hotelera',
    'dashboard.subtitle': 'Gestionar todas las solicitudes de servicio de RD Hotels',
    'dashboard.tickets': 'Tickets',
    'dashboard.rooms': 'Habitaciones',
    'dashboard.reports': 'Informes',
    'dashboard.manageUsers': 'Gestionar Usuarios',
    'dashboard.newTicket': 'Nuevo Ticket',
    
    // Tickets
    'tickets.total': 'Total',
    'tickets.open': 'Abierto',
    'tickets.inProgress': 'En Progreso',
    'tickets.completed': 'Completado',
    'tickets.search': 'Buscar tickets...',
    'tickets.allStatus': 'Todos los Estados',
    'tickets.allPriority': 'Todas las Prioridades',
    'tickets.priority.urgent': 'Urgente',
    'tickets.priority.high': 'Alta',
    'tickets.priority.medium': 'Media',
    'tickets.priority.low': 'Baja',
    
    // Room Management
    'rooms.title': 'Gestión de Habitaciones',
    'rooms.subtitle': 'Monitorear y gestionar el estado de las habitaciones del hotel',
    'rooms.search': 'Buscar por número de habitación u hotel...',
    'rooms.addRoom': 'Agregar Habitación',
    'rooms.minibarSettings': 'Configuración Minibar',
    'rooms.allHotels': 'Todos los Hoteles',
    'rooms.allStatus': 'Todos los Estados',
    'rooms.clean': 'Limpio',
    'rooms.dirty': 'Sucio',
    'rooms.maintenance': 'Mantenimiento',
    'rooms.outOfOrder': 'Fuera de Servicio',
    
    // Room Status
    'room.status.clean': 'Limpio',
    'room.status.dirty': 'Sucio',
    'room.status.maintenance': 'Mantenimiento',
    'room.status.out_of_order': 'Fuera de Servicio',
    
    // Create Room
    'createRoom.title': 'Crear Nueva Habitación',
    'createRoom.hotel': 'Hotel',
    'createRoom.roomName': 'Nombre de la Habitación',
    'createRoom.roomNumber': 'Número de Habitación',
    'createRoom.roomType': 'Tipo de Habitación',
    'createRoom.floorNumber': 'Número de Piso',
    'createRoom.create': 'Crear Habitación',
    
    // Common
    'common.loading': 'Cargando...',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.close': 'Cerrar',
    'common.edit': 'Editar',
    'common.delete': 'Eliminar',
    'common.search': 'Buscar',
    'common.filter': 'Filtrar',
    'common.status': 'Estado',
    'common.priority': 'Prioridad',
    'common.hotel': 'Hotel',
    'common.room': 'Habitación',
    'common.profile': 'Perfil',
    'common.settings': 'Configuración',
    'common.logout': 'Cerrar sesión',
    
    // Language
    'language.changed': 'Idioma Cambiado',
    'language.switchedTo': 'Idioma cambiado a',
    
    // PMS Upload
    'pms.title': 'Carga de Datos PMS',
    'pms.subtitle': 'Sube archivo Excel desde tu sistema PMS para actualizar automáticamente estados de habitaciones y crear asignaciones de limpieza',
    'pms.dragDrop': 'Arrastra y suelta tu archivo de exportación PMS aquí, o haz clic para navegar',
    'pms.dropHere': 'Suelta tu archivo PMS aquí',
    'pms.releaseToUpload': 'Suelta para subir tu archivo',
    'pms.processing': 'Procesando datos PMS...',
    'pms.backgroundUpload': 'Ejecutándose en segundo plano',
    'pms.uploadComplete': 'Carga Completa',
    'pms.roomsProcessed': 'Habitaciones Procesadas',
    'pms.statusesUpdated': 'Estados Actualizados',
    'pms.tasksAssigned': 'Tareas Asignadas',
    'pms.checkoutRooms': 'Habitaciones de Salida',
    'pms.dailyCleaningRooms': 'Habitaciones Limpieza Diaria',
    'pms.issuesFound': 'Problemas Encontrados',
    'pms.uploadAnother': 'Subir Otro Archivo',
    'pms.checkoutToday': 'Salida Hoy',
    'pms.stayingGuests': 'Huéspedes que se Quedan',
    'pms.departureTime': 'Salida',
    'rooms.checkoutRoom': 'Habitación de Salida',
    'rooms.dailyCleaningRoom': 'Limpieza Diaria',
    'rooms.checkoutTime': 'Hora de Salida',
    'rooms.stayingGuest': 'Huésped que se Queda',
    'rooms.assignmentDetails': 'Detalles de Asignación',
    'rooms.assignToStaff': 'Asignar al Personal',
    'rooms.selectStaff': 'Seleccionar personal de limpieza',
    'rooms.assignmentType': 'Tipo de Asignación',
    'rooms.deepCleaning': 'Limpieza Profunda',
    'rooms.selectRooms': 'Seleccionar Habitaciones',
    'rooms.selected': 'seleccionadas',
    'rooms.selectAll': 'Seleccionar Todo',
    'rooms.clearAll': 'Limpiar Todo',
    'rooms.creatingAssignments': 'Creando Asignaciones...',
    'rooms.assign': 'Asignar',
    'rooms.rooms': 'Habitación(es)',
    
    // Housekeeping
    'housekeeping.myTasks': 'Mis Tareas',
    'housekeeping.quickAssign': 'Asignación Rápida',
    'housekeeping.pmsUpload': 'Subida PMS',
    'housekeeping.performance': 'Rendimiento',
    'housekeeping.staff': 'Personal',
    'housekeeping.teamView': 'Vista de Equipo',
    'housekeeping.accessRestricted': 'Acceso restringido al personal de limpieza y gerentes',
  },
  
  vi: {
    // Dashboard
    'dashboard.title': 'Bảng điều khiển quản lý khách sạn',
    'dashboard.subtitle': 'Quản lý mọi yêu cầu dịch vụ của RD Hotels',
    'dashboard.tickets': 'Phiếu',
    'dashboard.rooms': 'Phòng',
    'dashboard.reports': 'Báo cáo',
    'dashboard.manageUsers': 'Quản lý người dùng',
    'dashboard.newTicket': 'Tạo phiếu',

    // Tickets
    'tickets.total': 'Tổng',
    'tickets.open': 'Mở',
    'tickets.inProgress': 'Đang xử lý',
    'tickets.completed': 'Hoàn thành',
    'tickets.search': 'Tìm kiếm phiếu...',
    'tickets.allStatus': 'Tất cả trạng thái',
    'tickets.allPriority': 'Tất cả mức ưu tiên',
    'tickets.priority.urgent': 'Khẩn cấp',
    'tickets.priority.high': 'Cao',
    'tickets.priority.medium': 'Trung bình',
    'tickets.priority.low': 'Thấp',

    // Room Management
    'rooms.title': 'Quản lý phòng',
    'rooms.subtitle': 'Theo dõi và quản lý trạng thái phòng khách sạn',
    'rooms.search': 'Tìm theo số phòng hoặc khách sạn...',
    'rooms.addRoom': 'Thêm phòng',
    'rooms.minibarSettings': 'Cài đặt minibar',
    'rooms.allHotels': 'Tất cả khách sạn',
    'rooms.allStatus': 'Tất cả trạng thái',
    'rooms.clean': 'Sạch',
    'rooms.dirty': 'Bẩn',
    'rooms.maintenance': 'Bảo trì',
    'rooms.outOfOrder': 'Hỏng',

    // Room Status
    'room.status.clean': 'Sạch',
    'room.status.dirty': 'Bẩn',
    'room.status.maintenance': 'Bảo trì',
    'room.status.out_of_order': 'Hỏng',

    // Create Room
    'createRoom.title': 'Tạo phòng mới',
    'createRoom.hotel': 'Khách sạn',
    'createRoom.roomName': 'Tên phòng',
    'createRoom.roomNumber': 'Số phòng',
    'createRoom.roomType': 'Loại phòng',
    'createRoom.floorNumber': 'Tầng',
    'createRoom.create': 'Tạo phòng',

    // Common
    'common.loading': 'Đang tải...',
    'common.save': 'Lưu',
    'common.cancel': 'Hủy',
    'common.close': 'Đóng',
    'common.edit': 'Sửa',
    'common.delete': 'Xóa',
    'common.search': 'Tìm kiếm',
    'common.filter': 'Lọc',
    'common.status': 'Trạng thái',
    'common.priority': 'Ưu tiên',
    'common.hotel': 'Khách sạn',
    'common.room': 'Phòng',
    'common.profile': 'Hồ sơ',
    'common.settings': 'Cài đặt',
    'common.logout': 'Đăng xuất',

    // Language
    'language.changed': 'Đã đổi ngôn ngữ',
    'language.switchedTo': 'Chuyển sang',
    
    // PMS Upload
    'pms.title': 'Tải lên dữ liệu PMS',
    'pms.subtitle': 'Tải file Excel từ hệ thống PMS để tự động cập nhật trạng thái phòng và tạo phân công dọn phòng',
    'pms.dragDrop': 'Kéo thả file xuất PMS vào đây, hoặc nhấp để duyệt',
    'pms.dropHere': 'Thả file PMS vào đây',
    'pms.releaseToUpload': 'Thả để tải lên file',
    'pms.processing': 'Đang xử lý dữ liệu PMS...',
    'pms.backgroundUpload': 'Chạy ngầm',
    'pms.uploadComplete': 'Tải lên hoàn tất',
    'pms.roomsProcessed': 'Phòng đã xử lý',
    'pms.statusesUpdated': 'Trạng thái đã cập nhật',
    'pms.tasksAssigned': 'Công việc đã giao',
    'pms.checkoutRooms': 'Phòng trả',
    'pms.dailyCleaningRooms': 'Phòng dọn hàng ngày',
    'pms.issuesFound': 'Vấn đề tìm thấy',
    'pms.uploadAnother': 'Tải file khác',
    'pms.checkoutToday': 'Trả phòng hôm nay',
    'pms.stayingGuests': 'Khách ở lại',
    'pms.departureTime': 'Giờ trả phòng', 
    'rooms.checkoutRoom': 'Phòng trả',
    'rooms.dailyCleaningRoom': 'Dọn phòng hàng ngày',
    'rooms.checkoutTime': 'Giờ trả phòng',
    'rooms.stayingGuest': 'Khách ở lại',
    'rooms.assignmentDetails': 'Chi tiết phân công',
    'rooms.assignToStaff': 'Giao cho nhân viên',
    'rooms.selectStaff': 'Chọn nhân viên dọn phòng',
    'rooms.assignmentType': 'Loại phân công',
    'rooms.deepCleaning': 'Dọn sâu',
    'rooms.selectRooms': 'Chọn phòng',
    'rooms.selected': 'đã chọn',
    'rooms.selectAll': 'Chọn tất cả',
    'rooms.clearAll': 'Xóa tất cả',
    'rooms.creatingAssignments': 'Đang tạo phân công...',
    'rooms.assign': 'Phân công',
    'rooms.rooms': 'Phòng',
    
    // Housekeeping
    'housekeeping.myTasks': 'Công việc của tôi',
    'housekeeping.quickAssign': 'Giao nhanh',
    'housekeeping.pmsUpload': 'Tải PMS',
    'housekeeping.performance': 'Hiệu suất',
    'housekeeping.staff': 'Nhân viên',
    'housekeeping.teamView': 'Xem nhóm',
    'housekeeping.accessRestricted': 'Quyền truy cập hạn chế cho nhân viên dọn phòng và quản lý',
  },
};

type Language = keyof typeof translations;
type TranslationKey = keyof typeof translations.en;

interface TranslationContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const TranslationContext = createContext<TranslationContextType>({} as TranslationContextType);

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    return (localStorage.getItem('preferred-language') as Language) || 'en';
  });

  const t = (key: TranslationKey): string => {
    return translations[language]?.[key] || translations.en[key] || key;
  };

  const changeLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('preferred-language', lang);
  };

  return (
    <TranslationContext.Provider value={{ language, setLanguage: changeLanguage, t }}>
      {children}
    </TranslationContext.Provider>
  );
}

export const useTranslation = () => {
  const context = useContext(TranslationContext);
  if (!context) {
    // Return a fallback object instead of throwing an error during development
    console.warn('useTranslation must be used within a TranslationProvider');
    return {
      language: 'en' as const,
      setLanguage: () => {},
      t: (key: string) => key, // Return the key as fallback
    };
  }
  return context;
};