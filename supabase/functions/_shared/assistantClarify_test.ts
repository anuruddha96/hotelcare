import {
  brandSafeError,
  buildClarifyingQuestions,
  clarifyingHistoryNote,
  isClarifyingQuestions,
  mentionsAiProvider,
  persistedAssistantText,
} from "./assistantClarify.ts";

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("ask_user becomes a bounded tap-to-answer card", () => {
  const card = buildClarifyingQuestions({
    questions: [
      { id: "room", label: "Room", question: "Which room is the leak in?", options: ["406", "405", "406", "Other", "407", "408", "409"] },
      { question: "How urgent is it?", options: [{ label: "High" }, { label: "Urgent" }, { label: "Something else" }] },
      { question: "Third?", options: ["A"] },
      { question: "Fourth is dropped", options: ["B"] },
      { question: "", options: ["ignored"] },
    ],
  }, "card-1");
  check(card && isClarifyingQuestions(card), "A card must be built");
  if (!card) return;
  check(card.id === "card-1" && card.questions.length === 3, "At most three questions");
  const room = card.questions[0];
  check(room.id === "room" && room.label === "Room", "Ids and labels are kept");
  check(room.options.map((o) => o.label).join("|") === "406|405|407|408", "Deduped, no model-made Other, at most four");
  check(room.options[0].recommended && !room.options[1].recommended, "Only the first answer is highlighted");
  check(room.allowOther === true, "The app always offers Other");
  check(card.questions[1].options.length === 2, "'Something else' is the app's own Other");
  check(card.questions[1].label === "Answer 2", "A missing label gets a neutral fallback");
  check(buildClarifyingQuestions({ questions: [{ question: "No options", options: [] }] }) === null, "No options, no card");
  check(buildClarifyingQuestions(null) === null, "Nothing supplied, no card");
});

Deno.test("the question is stored with the answer so history stays readable", () => {
  const card = buildClarifyingQuestions({ questions: [{ question: "Which room is the leak in?", options: ["406"] }] }, "c")!;
  check(persistedAssistantText("", [card]) === "Which room is the leak in?", "A buttons-only turn stores the question");
  check(persistedAssistantText("I can log that. Which room is the leak in?", [card]) === "I can log that. Which room is the leak in?", "No duplicate when Mira already wrote it");
  check(persistedAssistantText("Done.", []) === "Done.", "Plain answers are unchanged");
  const note = clarifyingHistoryNote([card]);
  check(note.includes("Buttons offered: 406 | Other (typed)"), "The next turn knows what was offered");
  check(clarifyingHistoryNote([{ kind: "chart" }]) === "" && clarifyingHistoryNote(null) === "", "Other attachments add nothing");
});

Deno.test("AI provider names never reach the person", () => {
  for (const message of ["OpenAI rate limit exceeded", "Gemini API quota exhausted", "gpt-4.1-mini returned 500", "generativelanguage.googleapis.com timeout"]) {
    check(!mentionsAiProvider(brandSafeError(message)), `${message} must be rebranded`);
  }
  check(brandSafeError("Your monthly message allowance has been reached") === "Your monthly message allowance has been reached", "HotelCare's own messages pass through");
  check(brandSafeError("").length > 0, "An empty error still explains");
});
