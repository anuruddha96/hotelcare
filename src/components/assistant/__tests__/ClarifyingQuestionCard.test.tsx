import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useTranslation", () => ({ useTranslation: () => ({ language: "en", t: (key: string) => key }) }));

import ClarifyingQuestionCard, {
  composeClarifyingAnswer,
  isClarifyingQuestions,
  type ClarifyingQuestions,
} from "../ClarifyingQuestionCard";

const roomQuestion: ClarifyingQuestions = {
  kind: "clarifying_questions",
  id: "c1",
  questions: [{
    id: "room",
    label: "Room",
    question: "Which room is the leak in?",
    options: [{ label: "406", recommended: true }, { label: "405" }, { label: "407" }],
    allowOther: true,
  }],
};

const twoQuestions: ClarifyingQuestions = {
  kind: "clarifying_questions",
  questions: [
    { id: "room", label: "Room", question: "Which room?", options: [{ label: "406", recommended: true }, { label: "405" }] },
    { id: "priority", label: "Priority", question: "How urgent is it?", options: [{ label: "High", recommended: true }, { label: "Urgent" }] },
  ],
};

describe("ClarifyingQuestionCard", () => {
  it("answers a single question with one tap", () => {
    const onAnswer = vi.fn();
    render(<ClarifyingQuestionCard spec={roomQuestion} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: /406/ }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("406");
    expect(screen.getByRole("status")).toHaveTextContent("Sent: 406");
    // Answered once: the buttons are locked so a double tap cannot send twice.
    expect(screen.getByRole("button", { name: /405/ })).toBeDisabled();
  });

  it("marks the most probable answer and always offers Other", () => {
    render(<ClarifyingQuestionCard spec={roomQuestion} onAnswer={vi.fn()} />);
    expect(screen.getByRole("button", { name: /406 \(most likely\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Other/ })).toBeInTheDocument();
  });

  it("lets the person type anything with Other", () => {
    const onAnswer = vi.fn();
    render(<ClarifyingQuestionCard spec={roomQuestion} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: /Other/ }));
    const input = screen.getByRole("textbox", { name: "Which room is the leak in?" });
    fireEvent.change(input, { target: { value: "  corridor   by the lift " } });
    fireEvent.submit(input.closest("form")!);
    expect(onAnswer).toHaveBeenCalledWith("corridor by the lift");
  });

  it("does not repeat a question Mira already wrote", () => {
    render(<ClarifyingQuestionCard spec={roomQuestion} messageText="I can log that. Which room is the leak in?" onAnswer={vi.fn()} />);
    expect(screen.queryByText("Which room is the leak in?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /406/ })).toBeInTheDocument();
  });

  it("waits for every question before replying once", () => {
    const onAnswer = vi.fn();
    render(<ClarifyingQuestionCard spec={twoQuestions} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: /406/ }));
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^High/ }));
    expect(onAnswer).toHaveBeenCalledWith("Room: 406 · Priority: High");
  });

  it("uses a Send button when several answers may apply", () => {
    const onAnswer = vi.fn();
    const spec: ClarifyingQuestions = {
      kind: "clarifying_questions",
      questions: [{ id: "items", label: "Items", question: "What should be brought?", multiSelect: true, options: [{ label: "Towels" }, { label: "Pillow" }] }],
    };
    render(<ClarifyingQuestionCard spec={spec} onAnswer={onAnswer} />);
    const send = screen.getByRole("button", { name: /Send answers/ });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Towels" }));
    fireEvent.click(screen.getByRole("button", { name: "Pillow" }));
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(send);
    expect(onAnswer).toHaveBeenCalledWith("Towels, Pillow");
  });

  it("stays read-only while Mira is still answering", () => {
    const onAnswer = vi.fn();
    render(<ClarifyingQuestionCard spec={roomQuestion} interactive={false} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: /406/ }));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("keeps the buttons when the reply could not be sent", () => {
    const onAnswer = vi.fn(() => false);
    render(<ClarifyingQuestionCard spec={roomQuestion} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: /406/ }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /405/ })).toBeEnabled();
  });
});

describe("clarifying answer helpers", () => {
  it("recognises only real question cards", () => {
    expect(isClarifyingQuestions(roomQuestion)).toBe(true);
    expect(isClarifyingQuestions({ kind: "clarifying_questions", questions: [] })).toBe(false);
    expect(isClarifyingQuestions({ kind: "chart" })).toBe(false);
    expect(isClarifyingQuestions(null)).toBe(false);
  });

  it("composes the reply text", () => {
    expect(composeClarifyingAnswer(roomQuestion, { room: ["406"] })).toBe("406");
    expect(composeClarifyingAnswer(twoQuestions, { room: ["406"], priority: ["Urgent"] })).toBe("Room: 406 · Priority: Urgent");
    expect(composeClarifyingAnswer(twoQuestions, {})).toBe("");
  });
});
