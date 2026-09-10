import { describe, expect, it } from 'vitest';
import { translateLinenItem } from './linen-item-i18n';

type Lang = 'en' | 'hu' | 'es' | 'vi' | 'mn' | 'az' | 'tl' | 'uk' | 'ru';

const markers: Record<Lang, { changed: string; bigPillow: string }> = {
  en: { changed: 'Language Changed', bigPillow: 'Big Pillow' },
  hu: { changed: 'Nyelv megváltoztatva', bigPillow: 'Nagy Párna' },
  es: { changed: 'language.changed', bigPillow: 'Almohada Grande' },
  vi: { changed: 'language.changed', bigPillow: 'Gối Lớn' },
  mn: { changed: 'language.changed', bigPillow: 'Том Дэр' },
  az: { changed: 'Dil dəyişdirildi', bigPillow: 'linen.bigPillow' },
  tl: { changed: 'Nabago ang wika', bigPillow: 'linen.bigPillow' },
  uk: { changed: 'Мову змінено', bigPillow: 'Велика подушка' },
  ru: { changed: 'Язык изменен', bigPillow: 'Большая подушка' },
};

const tFor = (language: Lang) => (key: string) => {
  if (key === 'language.changed') return markers[language].changed;
  if (key === 'linen.bigPillow') return markers[language].bigPillow;
  return key;
};

const expected: Record<Lang, string[]> = {
  en: ['Small Pillow', 'Blankets – Blue', 'Blankets – Brown', 'Mattress Protector – Waterproof', 'Small Pillow Protector', 'Large Pillow Protector', 'Small Pillowcase', 'Large Pillowcase', 'Mattress Protector – Soft'],
  hu: ['Kispárna', 'Takarók – Kék', 'Takarók – Barna', 'Matracvédő – Vízálló', 'Kispárnavédő', 'Nagypárnavédő', 'Kispárnahuzat', 'Nagypárnahuzat', 'Matracvédő – Puha'],
  es: ['Almohada pequeña', 'Mantas – Azules', 'Mantas – Marrones', 'Protector de colchón – Impermeable', 'Protector para almohada pequeña', 'Protector para almohada grande', 'Funda de almohada pequeña', 'Funda de almohada grande', 'Protector de colchón – Suave'],
  vi: ['Gối nhỏ', 'Chăn – Xanh dương', 'Chăn – Nâu', 'Tấm bảo vệ nệm – Chống thấm nước', 'Vỏ bảo vệ gối nhỏ', 'Vỏ bảo vệ gối lớn', 'Vỏ gối nhỏ', 'Vỏ gối lớn', 'Tấm bảo vệ nệm – Mềm'],
  mn: ['Жижиг дэр', 'Хөнжил – Цэнхэр', 'Хөнжил – Бор', 'Гудасны хамгаалалт – Ус нэвтэрдэггүй', 'Жижиг дэрний хамгаалалт', 'Том дэрний хамгаалалт', 'Жижиг дэрний уут', 'Том дэрний уут', 'Гудасны хамгаалалт – Зөөлөн'],
  az: ['Kiçik yastıq', 'Ədyallar – Mavi', 'Ədyallar – Qəhvəyi', 'Döşək qoruyucusu – Su keçirməz', 'Kiçik yastıq qoruyucusu', 'Böyük yastıq qoruyucusu', 'Kiçik yastıq üzü', 'Böyük yastıq üzü', 'Döşək qoruyucusu – Yumşaq'],
  tl: ['Maliit na unan', 'Mga kumot – Asul', 'Mga kumot – Kayumanggi', 'Proteksiyon sa kutson – Hindi tinatablan ng tubig', 'Proteksiyon sa maliit na unan', 'Proteksiyon sa malaking unan', 'Punda ng maliit na unan', 'Punda ng malaking unan', 'Proteksiyon sa kutson – Malambot'],
  uk: ['Маленька подушка', 'Ковдри — сині', 'Ковдри — коричневі', 'Наматрацник — водонепроникний', 'Захисний чохол для маленької подушки', 'Захисний чохол для великої подушки', 'Наволочка для маленької подушки', 'Наволочка для великої подушки', 'Наматрацник — м’який'],
  ru: ['Маленькая подушка', 'Одеяла — синие', 'Одеяла — коричневые', 'Наматрасник — водонепроницаемый', 'Защитный чехол для маленькой подушки', 'Защитный чехол для большой подушки', 'Наволочка для маленькой подушки', 'Наволочка для большой подушки', 'Наматрасник — мягкий'],
};

const rawNames = [
  'Small Pillow',
  'Blankets - Blue',
  'Blankets - Brown',
  'Mattress Protector - Water Proof',
  'Small pillow protector',
  'Big pillow protector',
  'Small pillow cover',
  'Big pillow cover',
  'Mattress Protector - Soft',
];

describe('Mika linen item translations', () => {
  it.each(Object.keys(expected) as Lang[])('translates every configured Mika linen item in %s', language => {
    const t = tFor(language);
    expect(rawNames.map(name => translateLinenItem(name, t))).toEqual(expected[language]);
  });

  it('normalizes the legacy Water Proof label without changing the stored value', () => {
    expect(translateLinenItem('Mattress Protector - Water Proof', tFor('en')))
      .toBe('Mattress Protector – Waterproof');
  });

  it('still falls back to an unknown configurable item unchanged', () => {
    expect(translateLinenItem('Custom Linen Item', tFor('hu'))).toBe('Custom Linen Item');
  });
});
