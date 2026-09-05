// Housekeeper-facing presentation of public-area (general) tasks.
//
// `general_tasks` rows carry manager/configuration data: `task_type` keys,
// internal instructions and a "Mapped section: <zone>" prefix written by the
// `assign_housekeeping_section_tasks` RPC. Housekeepers must never see that.
// Here we reduce every row to one short area name plus one plain instruction,
// both translated through the normal `t()` bundle.

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

export function resolvePublicAreaKey(task: PublicAreaTaskLike): string | null {
  const haystack = `${task.task_type || ''} ${task.task_name || ''}`;
  for (const [key, pattern] of AREA_MATCHERS) {
    if (pattern.test(haystack)) return key;
  }
  return null;
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
}

/**
 * One translated title + one short instruction for the housekeeper card.
 * Falls back to the manager's own free text, then to a generic instruction.
 */
export function publicAreaTaskCopy(
  task: PublicAreaTaskLike,
  t: (key: string) => string,
): PublicAreaTaskCopy {
  const key = resolvePublicAreaKey(task);
  const freeText = stripManagerMetadata(task.task_description);

  const translatedTitle = key ? t(`publicAreaTask.area.${key}.name`) : '';
  const translatedInstruction = key ? t(`publicAreaTask.area.${key}.instruction`) : '';

  const title = translatedTitle && !translatedTitle.startsWith('publicAreaTask.')
    ? translatedTitle
    : task.task_name;

  const instruction = translatedInstruction && !translatedInstruction.startsWith('publicAreaTask.')
    ? translatedInstruction
    : (freeText || t('publicAreaTask.generic'));

  return { title, instruction };
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
