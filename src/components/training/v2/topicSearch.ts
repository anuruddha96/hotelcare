import type { I18nText, TrainingCurriculum } from './types';

const intentWords: Record<string, string> = {
  osszam: 'kioszt', osztom: 'kioszt', osszak: 'kioszt', kiosztani: 'kioszt', kiosztas: 'kioszt',
  kiosztasa: 'kioszt', rendelje: 'kioszt', automatikusan: 'automatikus',
  szobakat: 'szoba', szobak: 'szoba', szobat: 'szoba',
  hibajegyet: 'hibajegy', hibajegyek: 'hibajegy', hibat: 'hiba', szerelot: 'szerelo',
  bejelenteni: 'bejelent', jelentsek: 'bejelent', piszkosra: 'piszkos', koszos: 'piszkos',
};

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function trainingSearchTerms(query: string): string[] {
  return normalize(query)
    .replace(/^(?:how (?:do i|can i|to)|hogyan(?: tudom| lehet)?|hogy(?: tudom| lehet)?|mikent|como(?: puedo)?|lam the nao(?: de)?|cach|яаж|хэрхэн|як)(?: |$)/u, '')
    .split(' ')
    .filter((term) => term && !['a', 'az', 'ki', 'the', 'my', 'un', 'una', 'el', 'la'].includes(term))
    .map((term) => intentWords[term] || term);
}

export function matchesTrainingTopic(topic: TrainingCurriculum, moduleLabel: I18nText, terms: string[]): boolean {
  const text = [topic.name, topic.description, moduleLabel, topic.module, ...topic.steps.map((step) => step.title)];
  const haystack = normalize(text.flatMap((entry) => entry ? Object.values(entry) : []).join(' '));
  return terms.every((term) => haystack.includes(term));
}
