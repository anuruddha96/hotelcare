/**
 * A full stayover clean includes both bed linen AND towels.
 * Use the PMS current-night counter carefully: night 5 means four nights
 * have been completed, not five. This is housekeeper-facing display copy,
 * never a guest-facing message or a persisted task note.
 */
const RD_HOTELS = new Set([
  'ottofiori', 'hotel ottofiori',
  'mika-downtown', 'hotel mika downtown', 'mika downtown',
  'gozsdu-court', 'gozsdu court budapest',
  'memories-budapest', 'hotel memories budapest', 'memories budapest',
]);

export function isRdHousekeepingHotel(hotel?: string | null): boolean {
  return RD_HOTELS.has(String(hotel || '').trim().toLowerCase().replace(/\s+/g, ' '));
}

export interface RdFullCleanInput {
  hotel?: string | null;
  isCheckout: boolean;
  linenChangeRequired?: boolean | null;
  fullRoomCleaningRequired?: boolean | null;
  currentNight?: number | null;
  language?: string | null;
}

export interface RdFullCleanInstruction {
  title: string;
  message: string;
}

export function getRdFullCleanInstruction(input: RdFullCleanInput): RdFullCleanInstruction | null {
  if (!isRdHousekeepingHotel(input.hotel) || input.isCheckout ||
      (!input.linenChangeRequired && !input.fullRoomCleaningRequired)) return null;

  const value = Number(input.currentNight);
  const currentNight = Number.isInteger(value) && value > 0 ? value : null;
  const completedNights = currentNight === null ? null : currentNight - 1;

  const en = {
    title: 'Full room cleaning required',
    action: 'Please change the bed linen and all towels.',
    stay: completedNights === null ? '' :
      completedNights === 0 ? 'Guest stay: night 1. ' :
      `Guest stayed ${completedNights} night${completedNights === 1 ? '' : 's'} (now on night ${currentNight}). `,
  };
  const hu = {
    title: 'Teljes szobatakarítás szükséges',
    action: 'Kérjük, cserélje ki az ágyneműt és az összes törölközőt.',
    stay: completedNights === null ? '' :
      completedNights === 0 ? 'A vendég tartózkodásának 1. éjszakája. ' :
      `A vendég ${completedNights} éjszakát töltött itt (most a ${currentNight}. éjszaka következik). `,
  };
  const es = {
    title: 'Limpieza completa de la habitación',
    action: 'Cambie la ropa de cama y todas las toallas, por favor.',
    stay: completedNights === null ? '' :
      completedNights === 0 ? 'Primera noche de estancia. ' :
      `El huésped lleva ${completedNights} noche${completedNights === 1 ? '' : 's'} (ahora en la noche ${currentNight}). `,
  };
  const vi = {
    title: 'Cần vệ sinh toàn bộ phòng',
    action: 'Vui lòng thay ga giường và tất cả khăn tắm.',
    stay: completedNights === null ? '' :
      completedNights === 0 ? 'Đêm lưu trú đầu tiên. ' :
      `Khách đã ở ${completedNights} đêm (hiện là đêm thứ ${currentNight}). `,
  };
  const mn = {
    title: 'Өрөөг бүрэн цэвэрлэнэ',
    action: 'Орны цагаан хэрэглэл болон бүх алчуурыг солино уу.',
    stay: completedNights === null ? '' :
      completedNights === 0 ? 'Зочны эхний шөнө. ' :
      `Зочин ${completedNights} шөнө хоносон (одоо ${currentNight} дахь шөнө). `,
  };
  const language = input.language?.toLowerCase();
  const copy = language === 'hu' ? hu : language === 'es' ? es :
    language === 'vi' ? vi : language === 'mn' ? mn : en;
  return { title: copy.title, message: copy.stay + copy.action };
}
