// Tap-to-answer clarifying questions for Mira.
//
// When a required detail is missing, Mira asks with `ask_user` instead of a
// free-text question. The app shows the most probable answers as buttons and
// always adds "Other" so the person can type anything else. A tap is sent back
// as an ordinary chat message, so nothing here writes data.
//
// Pure TypeScript (no Deno APIs) so the rules are covered by deno test.

export type ClarifyingOption = { label: string; recommended: boolean };

export type ClarifyingQuestion = {
  id: string;
  question: string;
  /** Short name shown with a combined answer, e.g. "Room", "Priority". */
  label: string;
  options: ClarifyingOption[];
  multiSelect: boolean;
  /** The app always offers "Other" with a text box. */
  allowOther: true;
};

export type ClarifyingQuestions = {
  kind: "clarifying_questions";
  version: 1;
  id: string;
  questions: ClarifyingQuestion[];
};

export const MAX_CLARIFYING_QUESTIONS = 3;
export const MAX_CLARIFYING_OPTIONS = 4;

// The app adds its own "Other"; a model-made one would appear twice.
const OTHER_OPTION = /^(?:other|others|something else|none of (?:these|the above)|egyéb|más|anderes?|sonstiges)\b/i;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Turns the model's ask_user arguments into a safe, bounded card. Returns null
 * when nothing usable was supplied (then Mira should simply ask in words).
 */
export function buildClarifyingQuestions(raw: unknown, id: string = crypto.randomUUID()): ClarifyingQuestions | null {
  const list = Array.isArray((raw as { questions?: unknown })?.questions)
    ? (raw as { questions: unknown[] }).questions
    : [];
  const questions: ClarifyingQuestion[] = [];
  const usedIds = new Set<string>();

  for (const item of list) {
    if (questions.length >= MAX_CLARIFYING_QUESTIONS) break;
    const entry = (item ?? {}) as Record<string, unknown>;
    const question = clean(entry.question, 160);
    if (!question) continue;

    const seen = new Set<string>();
    const labels: string[] = [];
    for (const option of Array.isArray(entry.options) ? entry.options : []) {
      const label = clean(typeof option === "string" ? option : (option as { label?: unknown })?.label, 48);
      const key = comparable(label);
      if (!label || !key || OTHER_OPTION.test(label) || seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
      if (labels.length >= MAX_CLARIFYING_OPTIONS) break;
    }
    if (!labels.length) continue;

    let questionId = clean(entry.id, 32).replace(/[^\w-]/g, "") || `q${questions.length + 1}`;
    while (usedIds.has(questionId)) questionId = `${questionId}_${questions.length + 1}`;
    usedIds.add(questionId);

    questions.push({
      id: questionId,
      question,
      label: clean(entry.label, 24) || `Answer ${questions.length + 1}`,
      // Options arrive best first; the first one is highlighted as the likely answer.
      options: labels.map((label, index) => ({ label, recommended: index === 0 })),
      multiSelect: entry.multiSelect === true,
      allowOther: true,
    });
  }

  return questions.length ? { kind: "clarifying_questions", version: 1, id, questions } : null;
}

export function isClarifyingQuestions(value: unknown): value is ClarifyingQuestions {
  return Boolean(value) && typeof value === "object" &&
    (value as { kind?: unknown }).kind === "clarifying_questions" &&
    Array.isArray((value as { questions?: unknown }).questions);
}

/**
 * The stored answer text. Mira normally writes the question in her reply; if
 * she only showed the buttons, the question is added so the conversation still
 * reads correctly after a reload and in the next turn's history.
 */
export function persistedAssistantText(answer: string, attachments: readonly unknown[]): string {
  const text = String(answer ?? "").trim();
  const present = comparable(text);
  const missing = attachments
    .filter(isClarifyingQuestions)
    .flatMap((card) => card.questions.map((q) => q.question))
    .filter((question) => !present.includes(comparable(question)));
  return [text, ...missing].filter(Boolean).join("\n\n");
}

/**
 * Context for the next turn: the history Mira sees is rebuilt from stored text,
 * so the buttons she offered are described in words. Never shown to the user.
 */
export function clarifyingHistoryNote(attachments: unknown): string {
  const cards = Array.isArray(attachments) ? attachments.filter(isClarifyingQuestions) : [];
  const lines = cards.flatMap((card) =>
    card.questions.map((q) => `- ${q.question} Buttons offered: ${q.options.map((o) => o.label).join(" | ")} | Other (typed)`)
  );
  return lines.length ? `\n\n[Mira asked the user to tap an answer:\n${lines.join("\n")}]` : "";
}

// Provider and model names never reach the person: Mira is HotelCare's assistant.
const PROVIDER_NAME = /\b(?:open\s?ai|chat\s?gpt|gpt-?[\d.o][\w.-]*|gemini[\w.-]*|google\s+(?:ai|gemini)|generativelanguage|vertex\s?ai|anthropic|claude)\b/i;

export function brandSafeError(message: string): string {
  const text = String(message ?? "").trim();
  if (!text) return "HotelCare could not complete the response. Please try again.";
  return PROVIDER_NAME.test(text) ? "HotelCare AI is busy right now. Please try again in a moment." : text;
}

export function mentionsAiProvider(text: string): boolean {
  return PROVIDER_NAME.test(String(text ?? ""));
}
