import { useState } from "react";
import { Check, PencilLine, SendHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

/** Mirrors supabase/functions/_shared/assistantClarify.ts (Mira's ask_user). */
export type ClarifyingOption = { label: string; recommended?: boolean };
export type ClarifyingQuestion = {
  id: string;
  question: string;
  label?: string;
  options: ClarifyingOption[];
  multiSelect?: boolean;
  allowOther?: boolean;
};
export type ClarifyingQuestions = { kind: "clarifying_questions"; id?: string; questions: ClarifyingQuestion[] };

type Answers = Record<string, string[]>;

const COPY = {
  en: { other: "Other", placeholder: "Type your answer…", send: "Send answer", sendAll: "Send answers", sent: "Sent", likely: "most likely", group: "Quick answer for Mira" },
  hu: { other: "Egyéb", placeholder: "Írja be a választ…", send: "Válasz küldése", sendAll: "Válaszok küldése", sent: "Elküldve", likely: "legvalószínűbb", group: "Gyors válasz Mirának" },
};

export function isClarifyingQuestions(value: unknown): value is ClarifyingQuestions {
  if (!value || typeof value !== "object") return false;
  const spec = value as { kind?: unknown; questions?: unknown };
  return spec.kind === "clarifying_questions" && Array.isArray(spec.questions) &&
    spec.questions.some((item: unknown) => {
      const q = item as { question?: unknown; options?: unknown } | null;
      return typeof q?.question === "string" && Array.isArray(q.options) && q.options.length > 0;
    });
}

/** The reply sent for the taps: "406" for one question, "Room: 406 · Priority: High" for several. */
export function composeClarifyingAnswer(spec: ClarifyingQuestions, answers: Answers): string {
  const filled = spec.questions
    .map((q) => ({ q, values: (answers[q.id] ?? []).map((v) => v.trim()).filter(Boolean) }))
    .filter((row) => row.values.length > 0);
  if (!filled.length) return "";
  if (spec.questions.length === 1) return filled[0].values.join(", ");
  return filled.map(({ q, values }) => `${q.label || q.question}: ${values.join(", ")}`).join(" · ");
}

function comparable(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Mira's clarifying question as buttons: the most probable answers first, and
 * "Other" to type anything else. One tap answers a single question; with
 * several questions the reply goes once each has an answer.
 */
export default function ClarifyingQuestionCard({
  spec,
  onAnswer,
  interactive = true,
  messageText = "",
}: {
  spec: ClarifyingQuestions;
  /** Return false when the reply could not be sent (e.g. no messages left). */
  onAnswer: (text: string) => boolean | void;
  interactive?: boolean;
  /** Mira's reply text; a question she already wrote is not repeated. */
  messageText?: string;
}) {
  const { language } = useTranslation();
  const c = language === "hu" ? COPY.hu : COPY.en;
  const questions = spec.questions.filter((q) => q?.question && Array.isArray(q.options) && q.options.length > 0);
  const [answers, setAnswers] = useState<Answers>({});
  const [otherFor, setOtherFor] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const needsSendButton = questions.some((q) => q.multiSelect);
  const locked = !interactive || sent !== null;
  const written = comparable(messageText);

  if (!questions.length) return null;

  const complete = (next: Answers) => questions.every((q) => (next[q.id] ?? []).length > 0);

  const deliver = (next: Answers) => {
    const text = composeClarifyingAnswer({ ...spec, questions }, next);
    if (!text) return;
    if (onAnswer(text) === false) return;
    setSent(text);
    setOtherFor(null);
  };

  const choose = (q: ClarifyingQuestion, value: string, typed = false) => {
    if (locked) return;
    const current = answers[q.id] ?? [];
    const values = q.multiSelect
      ? current.includes(value) && !typed ? current.filter((v) => v !== value) : [...new Set([...current, value])]
      : [value];
    const next = { ...answers, [q.id]: values };
    setAnswers(next);
    if (!needsSendButton && complete(next)) deliver(next);
  };

  const submitOther = (q: ClarifyingQuestion) => {
    const value = otherText.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!value) return;
    setOtherText("");
    setOtherFor(null);
    choose(q, value, true);
  };

  return (
    <div className="mt-3 rounded-2xl border bg-card/80 p-3 shadow-sm" role="group" aria-label={c.group} data-testid="clarifying-question-card">
      <div className="space-y-3">
        {questions.map((q) => {
          const picked = answers[q.id] ?? [];
          const typed = picked.filter((value) => !q.options.some((option) => option.label === value));
          const showQuestion = !written.includes(comparable(q.question));
          return (
            <div key={q.id}>
              {showQuestion ? (
                <p className="text-sm font-medium">{q.question}</p>
              ) : questions.length > 1 ? (
                <p className="text-xs font-medium text-muted-foreground">{q.label || q.question}</p>
              ) : null}
              <div className={cn("flex flex-wrap gap-2", (showQuestion || questions.length > 1) && "mt-2")}>
                {q.options.map((option) => {
                  const selected = picked.includes(option.label);
                  return (
                    <Button
                      key={option.label}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      aria-pressed={selected}
                      disabled={locked}
                      onClick={() => choose(q, option.label)}
                      className={cn(
                        "h-9 rounded-full px-3.5 text-sm",
                        option.recommended && !selected && "border-primary/50 text-primary hover:text-primary",
                      )}
                    >
                      {option.recommended && <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                      {option.label}
                      {option.recommended && <span className="sr-only"> ({c.likely})</span>}
                    </Button>
                  );
                })}
                {typed.map((value) => (
                  <Button
                    key={`typed-${value}`}
                    type="button"
                    size="sm"
                    variant="default"
                    aria-pressed
                    disabled={locked}
                    onClick={() => choose(q, value)}
                    className="h-9 rounded-full px-3.5 text-sm"
                  >
                    {value}
                  </Button>
                ))}
                {q.allowOther !== false && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={locked}
                    aria-expanded={otherFor === q.id}
                    onClick={() => {
                      setOtherFor(otherFor === q.id ? null : q.id);
                      setOtherText("");
                    }}
                    className="h-9 rounded-full border border-dashed px-3.5 text-sm text-muted-foreground"
                  >
                    <PencilLine className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    {c.other}
                  </Button>
                )}
              </div>
              {otherFor === q.id && !locked && (
                <form
                  className="mt-2 flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitOther(q);
                  }}
                >
                  <Input
                    autoFocus
                    value={otherText}
                    onChange={(event) => setOtherText(event.target.value)}
                    placeholder={c.placeholder}
                    aria-label={q.question}
                    maxLength={300}
                    enterKeyHint="send"
                    className="h-9 rounded-full text-sm"
                  />
                  <Button type="submit" size="sm" className="h-9 rounded-full px-3" disabled={!otherText.trim()} aria-label={c.send}>
                    <SendHorizontal className="h-4 w-4" aria-hidden />
                  </Button>
                </form>
              )}
            </div>
          );
        })}
      </div>
      {needsSendButton && sent === null && (
        <Button type="button" size="sm" className="mt-3 h-9 rounded-full" disabled={locked || !complete(answers)} onClick={() => deliver(answers)}>
          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {c.sendAll}
        </Button>
      )}
      {sent !== null && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
          {c.sent}: {sent}
        </p>
      )}
    </div>
  );
}
