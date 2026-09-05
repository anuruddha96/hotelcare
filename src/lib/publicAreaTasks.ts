// Housekeeper-facing presentation of public-area (general) tasks.
//
// `general_tasks` rows carry manager/configuration data: `task_type` keys,
// internal instructions and a "Mapped section: <zone>" prefix written by the
// `assign_housekeeping_section_tasks` RPC. Housekeepers should not see the
// verbose manager metadata, but they still need a short location cue when the
// same kind of work exists in more than one section (for example two staircases).

export interface PublicAreaTaskLike {
  task_name: string;
  task_type?: string | null;
  task_description?: string | null;
  status?: string | null;
  priority?: number | null;
}

/** Ordered keyword matchers — first hit wins, so put specific words first. */
const AREA_MATCHERS: Array<[string, RegExp]> = [
  ['staircase', /stair|steps|lepcso|lépcső|escalera|cauthang|cầu thang|шат|сход/i],
  ['elevator', /lift|elevator|ascensor|thangmay|thang máy|цахилгаан|ліфт/i],
  ['corridor', /corridor|hallway|folyoso|folyosó|pasillo|hanhlang|hành lang|коридор/i],
  ['toilet', /toilet|restroom|wc|washroom|mosdo|mosdó|aseo|vesinh|vệ sinh|ариун|туалет/i],
  ['decorations', /decor|dekor|adorn|trangtri|trang trí|чимэглэл|декор/i],
  ['breakfast', /breakfast|reggeli|desayuno|ansang|ăn sáng|өглөө|сніданк/i],
  ['dining', /dining|restaurant|etkezo|étkező|comedor|hoal|обід/i],
  ['kitchen', /kitchen|konyha|cocina|bep|bếp|тогоо|кухн/i],
  ['gym', /gym|fitness|kondi|gimnas|заал|спортзал/i],
  ['sauna', /sauna|szauna|xonghoi|xông hơi|саун/i],
  ['jacuzzi', /jacuzzi|whirlpool|jakuzzi|bonsuc|bồn sục|жакузи|джакузі/i],
  ['laundry', /laundry|mosoda|lavander|giat|giặt|угаалг|пральн/i],
  ['reception', /reception|recepci|letan|lễ tân|ресепшн|рецепц/i],
  ['lobby', /lobby|lobbi|recibidor|sanh|sảnh|лобб|лобі/i],
  ['office', /office|iroda|oficina|vanphong|văn phòng|оффис|офіс/i],
  ['entrance', /entrance|entry|bejarat|bejárat|entrada|loivao|lối vào|үүд|вхід/i],
  ['terrace', /terrace|balcony|terasz|terraza|santhuong|тераc|терас/i],
  ['storage', /storage|store\s?room|raktar|raktár|almacen|almacén|kho|агуулах|комор/i],
  ['trolley', /trolley|cart|kocsi|carro|xeday|xe đẩy|тэргэнц|візок/i],
  ['windows', /window|ablak|ventana|cuaso|cửa sổ|цонх|вікн/i],
  ['commonAreas', /common|public|shared|kozos|közös|comun|común|chung|нийт|спільн/i],
];

// Only replace a task's stored name with a translated generic area name when
// the stored name itself is generic. Specific names such as "Storage 1",
// "Small Corridor" and "New-side Decorations" must stay intact; otherwise two
// different configured tasks become visually identical on the housekeeper UI.
const GENERIC_TASK_NAMES: Partial<Record<string, RegExp>> = {
  staircase: /^(staircase|stairs?|stairways?|steps)$/i,
  elevator: /^(lift|elevator)$/i,
  corridor: /^(corridor|hallway)$/i,
  toilet: /^(public\s+)?(toilet|restroom|wc|washroom)$/i,
  decorations: /^decorations?$/i,
  breakfast: /^(breakfast|breakfast\s+room)$/i,
  dining: /^(dining|dining\s+area|restaurant)$/i,
  kitchen: /^kitchen$/i,
  gym: /^(gym|fitness)$/i,
  sauna: /^sauna$/i,
  jacuzzi: /^(jacuzzi|whirlpool)$/i,
  laundry: /^laundry$/i,
  reception: /^reception$/i,
  lobby: /^lobby$/i,
  office: /^(office|back\s+office)$/i,
  entrance: /^(entrance|entry)$/i,
  terrace: /^(terrace|balcony)$/i,
  storage: /^(storage|storeroom|store\s+room)$/i,
  trolley: /^(trolley|cart)$/i,
  windows: /^windows?$/i,
  commonAreas: /^(common|public|shared)(\s+areas?)?$/i,
};

export function resolvePublicAreaKey(task: PublicAreaTaskLike): string | null {
  const haystack = `${task.task_type || ''} ${task.task_name || ''}`;
  for (const [key, pattern] of AREA_MATCHERS) {
    if (pattern.test(haystack)) return key;
  }
  return null;
}

/**
 * Pull only the useful section name out of manager metadata. The housekeeper
 * sees e.g. "200 Side", never the verbose "Mapped section:" label.
 */
export function extractPublicAreaSection(description: string | null | undefined): string {
  if (!description) return '';
  const match = description.match(/^\s*(?:mapped section|section|zone)\s*:\s*(.+?)\s*$/im);
  return match?.[1]?.trim() || '';
}

/**
 * Remove manager-only metadata that the RPC stores in `task_description`
 * ("Mapped section: 200 Side"), keeping any genuine free-text instruction.
 */
export function stripManagerMetadata(description: string | null | undefined): string {
  if (!description) return '';
  return description
    .split('\n')
    .filter(line => !/^\s*(mapped section|section|zone)\s*:/i.test(line))
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

export interface PublicAreaTaskCopy {
  title: string;
  instruction: string;
  location: string;
}

/**
 * One translated/genuine title + one short translated instruction for the
 * housekeeper card. A concise section name is returned separately so equal
 * area types from different mapped sections are never mistaken for duplicates.
 */
export function publicAreaTaskCopy(
  task: PublicAreaTaskLike,
  t: (key: string) => string,
): PublicAreaTaskCopy {
  const key = resolvePublicAreaKey(task);
  const freeText = stripManagerMetadata(task.task_description);
  const location = extractPublicAreaSection(task.task_description);
  const storedTitle = (task.task_name || '').trim();

  const translatedTitle = key ? t(`publicAreaTask.area.${key}.name`) : '';
  const translatedInstruction = key ? t(`publicAreaTask.area.${key}.instruction`) : '';
  const hasTranslatedTitle = !!translatedTitle && !translatedTitle.startsWith('publicAreaTask.');
  const genericNameMatcher = key ? GENERIC_TASK_NAMES[key] : undefined;
  const storedNameIsGeneric = !!genericNameMatcher && genericNameMatcher.test(storedTitle);

  // Generic configured names can be translated. Specific configured names are
  // operational identifiers and must not be collapsed to a generic category.
  const title = hasTranslatedTitle && (storedNameIsGeneric || !storedTitle)
    ? translatedTitle
    : (storedTitle || translatedTitle || t('publicAreaTask.generic'));

  const instruction = translatedInstruction && !translatedInstruction.startsWith('publicAreaTask.')
    ? translatedInstruction
    : (freeText || t('publicAreaTask.generic'));

  return { title, instruction, location };
}

/** Only exceptional work deserves a chip on the housekeeper card. */
export function isExceptionalPublicAreaTask(task: PublicAreaTaskLike): boolean {
  return (task.priority ?? 1) >= 3;
}

export function isPublicAreaTaskOpen(status: string | null | undefined): boolean {
  return status !== 'completed' && status !== 'cancelled';
}

export function formatElapsed(startedAt: string | null | undefined, now = Date.now()): string {
  if (!startedAt) return '';
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return '';
  const minutes = Math.max(0, Math.floor((now - started) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
