// Simple translation utility for notes and messages
// This provides basic translation mappings for common maintenance terms

const translationMappings = {
  // English to other languages
  en: {
    hu: {
      // Common maintenance terms
      'broken': 'törött',
      'fixed': 'javított',
      'clean': 'tiszta',
      'dirty': 'piszkos',
      'maintenance': 'karbantartás',
      'completed': 'befejezett',
      'in progress': 'folyamatban',
      'urgent': 'sürgős',
      'repair needed': 'javítás szükséges',
      'working': 'működik',
      'not working': 'nem működik',
      'replacement needed': 'csere szükséges',
      'checked': 'ellenőrizve',
      'approved': 'jóváhagyva',
      'rejected': 'elutasítva',
      'toilet': 'WC',
      'bathroom': 'fürdőszoba',
      'shower': 'zuhany',
      'air conditioning': 'légkondicionáló',
      'heating': 'fűtés',
      'light': 'világítás',
      'window': 'ablak',
      'door': 'ajtó',
      'bed': 'ágy',
      'carpet': 'szőnyeg',
      'curtains': 'függöny'
    },
    es: {
      'broken': 'roto',
      'fixed': 'arreglado',
      'clean': 'limpio',
      'dirty': 'sucio',
      'maintenance': 'mantenimiento',
      'completed': 'completado',
      'in progress': 'en progreso',
      'urgent': 'urgente',
      'repair needed': 'reparación necesaria',
      'working': 'funcionando',
      'not working': 'no funciona',
      'replacement needed': 'reemplazo necesario',
      'checked': 'revisado',
      'approved': 'aprobado',
      'rejected': 'rechazado',
      'toilet': 'inodoro',
      'bathroom': 'baño',
      'shower': 'ducha',
      'air conditioning': 'aire acondicionado',
      'heating': 'calefacción',
      'light': 'luz',
      'window': 'ventana',
      'door': 'puerta',
      'bed': 'cama',
      'carpet': 'alfombra',
      'curtains': 'cortinas'
    },
    vi: {
      'broken': 'hỏng',
      'fixed': 'đã sửa',
      'clean': 'sạch',
      'dirty': 'bẩn',
      'maintenance': 'bảo trì',
      'completed': 'hoàn thành',
      'in progress': 'đang thực hiện',
      'urgent': 'khẩn cấp',
      'repair needed': 'cần sửa chữa',
      'working': 'hoạt động',
      'not working': 'không hoạt động',
      'replacement needed': 'cần thay thế',
      'checked': 'đã kiểm tra',
      'approved': 'đã phê duyệt',
      'rejected': 'đã từ chối',
      'toilet': 'toilet',
      'bathroom': 'phòng tắm',
      'shower': 'vòi sen',
      'air conditioning': 'điều hòa',
      'heating': 'sưởi ấm',
      'light': 'đèn',
      'window': 'cửa sổ',
      'door': 'cửa',
      'bed': 'giường',
      'carpet': 'thảm',
      'curtains': 'rèm cửa'
    }
  }
};

export function translateText(text: string, targetLanguage: string): string {
  // If target language is English, return as-is
  if (targetLanguage === 'en') {
    return text;
  }

  // Get translation mapping for target language
  const mapping = translationMappings.en[targetLanguage as keyof typeof translationMappings.en];
  if (!mapping) {
    return text; // Return original text if language not supported
  }

  // Simple word-by-word translation for common terms
  let translatedText = text.toLowerCase();
  
  // Sort by length (longest first) to handle multi-word phrases
  const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
  
  for (const englishTerm of sortedKeys) {
    const translatedTerm = mapping[englishTerm as keyof typeof mapping];
    const regex = new RegExp('\\b' + englishTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    translatedText = translatedText.replace(regex, translatedTerm);
  }

  // Preserve original capitalization pattern
  if (text.charAt(0) === text.charAt(0).toUpperCase()) {
    translatedText = translatedText.charAt(0).toUpperCase() + translatedText.slice(1);
  }

  return translatedText;
}

export function shouldTranslateContent(currentLanguage: string): boolean {
  return currentLanguage !== 'en';
}