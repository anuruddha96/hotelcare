import { describe, expect, it } from 'vitest';
import { translateLinenItem } from './linen-item-i18n';

type Dictionary = Record<string, string>;

const makeT = (dictionary: Dictionary) => (key: string) => dictionary[key] ?? key;

describe('translateLinenItem small pillow', () => {
  const cases = [
    ['English', { 'language.changed': 'Language Changed', 'linen.bigPillow': 'Big Pillow' }, 'Small Pillow'],
    ['Hungarian', { 'language.changed': 'Nyelv megváltoztatva', 'linen.bigPillow': 'Nagy Párna' }, 'Kispárna'],
    ['Spanish', { 'language.changed': 'Idioma cambiado', 'linen.bigPillow': 'Almohada Grande' }, 'Almohada Pequeña'],
    ['Vietnamese', { 'language.changed': 'Đã thay đổi ngôn ngữ', 'linen.bigPillow': 'Gối Lớn' }, 'Gối Nhỏ'],
    ['Mongolian', { 'language.changed': 'Хэл солигдлоо', 'linen.bigPillow': 'Том Дэр' }, 'Жижиг Дэр'],
    ['Azerbaijani', { 'language.changed': 'Dil dəyişdirildi' }, 'Kiçik Yastıq'],
    ['Filipino', { 'language.changed': 'Nabago ang wika' }, 'Maliit na Unan'],
    ['Ukrainian', { 'language.changed': 'Мову змінено', 'linen.bigPillow': 'Велика подушка' }, 'Мала подушка'],
    ['Russian', { 'language.changed': 'Язык изменен', 'linen.bigPillow': 'Большая подушка' }, 'Маленькая подушка'],
  ] as const;

  it.each(cases)('%s renders the configured Small Pillow label', (_language, dictionary, expected) => {
    expect(translateLinenItem('Small Pillow', makeT(dictionary))).toBe(expected);
    expect(translateLinenItem('small pillows', makeT(dictionary))).toBe(expected);
  });

  it('keeps existing linen translation-key behavior unchanged', () => {
    const t = makeT({ 'linen.bathMat': 'Thảm Phòng Tắm' });
    expect(translateLinenItem('Bath Mat', t)).toBe('Thảm Phòng Tắm');
  });
});
