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
    
    // Language
    'language.changed': 'Language Changed',
    'language.switchedTo': 'Language switched to',
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
    
    // Language
    'language.changed': 'Nyelv megváltoztatva',
    'language.switchedTo': 'Nyelv váltva erre:',
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
    
    // Language
    'language.changed': 'Idioma Cambiado',
    'language.switchedTo': 'Idioma cambiado a',
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
    throw new Error('useTranslation must be used within a TranslationProvider');
  }
  return context;
};