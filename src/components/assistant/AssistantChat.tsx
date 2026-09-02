import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatStatus, type UIMessage } from "ai";
import { Flag, Loader2, Mic, MicOff, ShieldQuestion, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { useAssistantContext } from "@/hooks/useAssistantContext";
import {
  assistantRowsToUiMessages,
  requestAssistantAccess,
  useAssistant,
} from "@/hooks/useAssistant";
import { greeting, starterPrompts } from "@/lib/assistant/starters";
import { isAssistantDebugEnabled } from "@/lib/assistant/debugMode";
import { reportAssistantIssue, sendAssistantFeedback } from "@/lib/assistant/issueReports";
import AutomationChangeCard, { isAutomationProposal } from "./AutomationChangeCard";
import ActionConfirmCard, { isActionProposal } from "./ActionConfirmCard";
import AssistantActions, { isAssistantActions } from "./AssistantActions";
import ActivityLine from "./ActivityLine";
import PremiumTopupCard, { type PremiumPackage } from "./PremiumTopupCard";
import hotelCareMark from "@/assets/hotelcare-logo-mark.png";

const SCOPE_LABEL: Record<string, string> = {
  revenue: "Revenue management",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  reception: "Reception & front office",
};

type AssistantMetadata = {
  needsScope?: string;
  premiumRequired?: boolean;
  premiumPackages?: PremiumPackage[];
  premiumUsage?: {
    included_daily?: number;
    included_used?: number;
    included_remaining?: number;
    paid_balance?: number;
  };
};
type AssistantUiMessage = UIMessage<AssistantMetadata>;

function messageText(message: AssistantUiMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

type DictationState = "idle" | "recording" | "transcribing";

/**
 * Speak-to-type. iOS Safari's SpeechRecognition is unreliable, so the audio is
 * recorded in the browser and transcribed server-side; the browser engine is
 * only used when recording is unavailable.
 */
function useDictation(onText: (text: string) => void, language: string) {
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const supported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const transcribe = useCallback(
    async (blob: Blob, mimeType: string) => {
      setState("transcribing");
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const extension = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
        const form = new FormData();
        form.append("file", new File([blob], `speech.${extension}`, { type: mimeType }));
        if (language) form.append("language", language);
        const { data, error } = await supabase.functions.invoke("assistant-transcribe", { body: form });
        if (error) throw error;
        const text = String((data as any)?.text ?? "").trim();
        if (text) onText(text);
        else toast.error("I didn’t catch that. Try again a little closer to the microphone.");
      } catch (error) {
        console.error("dictation failed", error);
        toast.error("Could not turn that recording into text.");
      } finally {
        setState("idle");
      }
    },
    [language, onText],
  );

  const start = useCallback(async () => {
    if (!supported) {
      toast.error("Voice input is not available in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      cancelledRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        cleanup();
        if (cancelledRef.current || blob.size < 1200) {
          setState("idle");
          return;
        }
        void transcribe(blob, type);
      };
      recorder.start();
      recorderRef.current = recorder;
      setState("recording");
    } catch (error) {
      console.error("microphone unavailable", error);
      cleanup();
      setState("idle");
      toast.error("Microphone access is needed for voice input.");
    }
  }, [cleanup, supported, transcribe]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else setState("idle");
  }, []);

  const toggle = useCallback(() => {
    if (state === "recording") stop();
    else if (state === "idle") void start();
  }, [start, state, stop]);

  return { state, supported, toggle };
}

function AnswerFeedback({ threadId, messageId }: { threadId: string; messageId: string }) {
  const { profile } = useAuth();
  const [sent, setSent] = useState<null | boolean>(null);
  if (sent !== null) {
    return <p className="mt-2 text-xs text-muted-foreground">Thanks for the feedback.</p>;
  }
  const send = (helpful: boolean) => {
    setSent(helpful);
    void sendAssistantFeedback({
      threadId,
      messageId,
      helpful,
      organizationSlug: profile?.organization_slug ?? null,
      hotelId: profile?.assigned_hotel ?? null,
    });
  };
  return (
    <div className="mt-2 flex items-center gap-1 opacity-60 transition-opacity hover:opacity-100">
      <button aria-label="Helpful" className="rounded p-1 hover:bg-accent" onClick={() => send(true)}>
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Not helpful" className="rounded p-1 hover:bg-accent" onClick={() => send(false)}>
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ChatSession({
  threadId,
  initialMessages,
  language,
  initialPrompt,
  onThreadUpdated,
  onNavigate,
}: {
  threadId: string;
  initialMessages: AssistantUiMessage[];
  language: string;
  initialPrompt?: string | null;
  onThreadUpdated: () => void;
  onNavigate?: () => void;
}) {
  const { user, profile } = useAuth();
  const { page, capabilities } = useAssistantContext();
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [analysisElapsedMs, setAnalysisElapsedMs] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelSavedRef = useRef(false);
  const initialPromptSentRef = useRef(false);
  const lastQuestionRef = useRef("");
  const debug = isAssistantDebugEnabled(profile?.role);
  const starters = useMemo(() => starterPrompts(profile?.role, page.module), [profile?.role, page.module]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AssistantUiMessage>({
        api: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant-chat-router`,
        headers: async () => {
          const { data } = await (await import("@/integrations/supabase/client")).supabase.auth.getSession();
          return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
        },
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, thread_id: threadId, language, page, capabilities },
        }),
      }),
    [threadId, language, page, capabilities],
  );

  const { messages, sendMessage, status, stop } = useChat<AssistantUiMessage>({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: () => {
      // Technical detail stays in the server logs; the user gets a plain line.
      setFailed("I couldn’t finish that just now.");
    },
    onFinish: async ({ message, isAbort }) => {
      if (isAbort && user && !cancelSavedRef.current) {
        cancelSavedRef.current = true;
        const parts = message.parts.map((part) => ({ ...part }));
        const lastText = [...parts].reverse().find((part) => part.type === "text");
        if (lastText?.type === "text") lastText.text = `${lastText.text}\n\n_Stopped._`;
        else parts.push({ type: "text", text: "_Stopped._" });
        const { supabase } = await import("@/integrations/supabase/client");
        const text = parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
        const { error } = await supabase.functions.invoke("assistant-save-abort", {
          body: { thread_id: threadId, content: text },
        });
        if (error) console.error("Failed to persist stopped assistant reply", error);
      }
      onThreadUpdated();
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    },
  });

  useEffect(() => {
    if (status === "submitted" || status === "streaming") {
      cancelSavedRef.current = false;
      setFailed(null);
    }
  }, [status]);

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, [threadId]);

  useEffect(() => {
    if (!initialPrompt || initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;
    lastQuestionRef.current = initialPrompt;
    void sendMessage({ text: initialPrompt });
  }, [initialPrompt, sendMessage]);

  const { state: dictation, supported, toggle } = useDictation(
    useCallback((text: string) => {
      setDraft((value) => (value ? `${value} ${text}` : text));
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    }, []),
    language,
  );

  const askForAccess = async (scope: string, question: string) => {
    if (!user) return;
    const { error } = await requestAssistantAccess({
      userId: user.id,
      orgSlug: profile?.organization_slug ?? null,
      hotelId: profile?.assigned_hotel ?? null,
      scope,
      question,
    });
    if (error) toast.error("Could not send the request");
    else toast.success("Access request sent to your manager");
  };

  const submit = async ({ text }: { text: string }) => {
    const value = text.trim();
    if (!value || status === "submitted" || status === "streaming") return;
    setDraft("");
    setFailed(null);
    lastQuestionRef.current = value;
    await sendMessage({ text: value });
  };

  const reportFailure = async () => {
    const result = await reportAssistantIssue({
      title: "The assistant could not answer",
      description: lastQuestionRef.current || "No question captured",
      category: "assistant",
      severity: "normal",
      threadId,
      page,
    });
    if (result.ok) toast.success("Thanks — this has been sent to the Hotel Care team.");
    else toast.error(result.error ?? "Could not send the report just now.");
  };

  const generating = status === "submitted" || status === "streaming";
  const waitingForAnswerText = useMemo(() => {
    let lastUserIndex = -1;
    messages.forEach((message, index) => {
      if (message.role === "user") lastUserIndex = index;
    });
    if (lastUserIndex < 0) return generating;
    const reply = messages.slice(lastUserIndex + 1).find((message) => message.role === "assistant");
    return !reply || messageText(reply).trim().length === 0;
  }, [generating, messages]);

  useEffect(() => {
    if (!generating) {
      setAnalysisElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setAnalysisElapsedMs(0);
    const timer = window.setInterval(() => {
      setAnalysisElapsedMs(Date.now() - startedAt);
    }, 500);
    return () => window.clearInterval(timer);
  }, [generating]);

  const analysisLabel = useMemo(() => {
    const q = lastQuestionRef.current.toLowerCase();
    const revenueQuestion = page.module === "revenue" || /\b(sales?|sold|bookings?|pickup|revenue|adr|revpar|occupancy|rates?|pricing|demand)\b/.test(q);
    if (revenueQuestion) {
      if (analysisElapsedMs < 2200) return "Reading live HotelCare revenue data…";
      if (analysisElapsedMs < 5200) return "Comparing booking pace, value and stay mix…";
      if (analysisElapsedMs < 8500) return "Checking occupancy, rates and market position…";
      return "Building the safest revenue action plan…";
    }
    if (analysisElapsedMs < 2400) return "Understanding the request…";
    if (analysisElapsedMs < 6000) return "Checking the relevant HotelCare data…";
    return "Preparing the recommended action…";
  }, [analysisElapsedMs, page.module]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Conversation className="min-h-0">
        <ConversationContent className="gap-4 px-2 py-4 sm:px-3">
          {messages.length === 0 && (
            <div className="mx-auto w-full max-w-md space-y-5 px-2 py-6">
              <div className="flex items-center gap-3">
                <img src={hotelCareMark} alt="" className="h-11 w-11 rounded-xl" />
                <div>
                  <p className="text-lg font-semibold leading-tight">{greeting(profile?.full_name)}</p>
                  <p className="text-sm text-muted-foreground">
                    {profile?.assigned_hotel ? `${profile.assigned_hotel} · ` : ""}
                    How can I help?
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                {starters.map((starter) => (
                  <button
                    key={starter.prompt}
                    type="button"
                    className="rounded-xl border bg-card px-3.5 py-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={() => void submit({ text: starter.prompt })}
                  >
                    <span className="block text-sm font-medium">{starter.label}</span>
                    <span className="block text-xs text-muted-foreground">{starter.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => {
            const text = messageText(message);
            const needsScope = message.metadata?.needsScope;
            const premiumRequired = message.metadata?.premiumRequired === true;
            const premiumPackages = message.metadata?.premiumPackages;
            const previousQuestion = index > 0 ? messageText(messages[index - 1]) : "";
            const isLast = index === messages.length - 1;
            return (
              <Message key={message.id} from={message.role} className="max-w-[92%]">
                <MessageContent
                  className={
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "w-full bg-transparent px-0 py-0"
                  }
                >
                  {message.role === "assistant" ? <MessageResponse>{text}</MessageResponse> : <p>{text}</p>}
                  {message.role === "assistant" &&
                    message.parts.map((part, partIndex) => {
                      if (!(part.type.startsWith("tool-") || part.type === "dynamic-tool")) return null;
                      const toolPart = part as any;
                      const toolName = part.type === "dynamic-tool" ? toolPart.toolName : part.type.slice(5);
                      const key = `${message.id}-${partIndex}`;

                      if (isAutomationProposal(toolPart.output)) {
                        return <AutomationChangeCard key={`${key}-proposal`} proposal={toolPart.output} />;
                      }
                      if (isActionProposal(toolPart.output)) {
                        return <ActionConfirmCard key={`${key}-action`} proposal={toolPart.output} />;
                      }
                      if (isAssistantActions(toolPart.output)) {
                        return (
                          <AssistantActions
                            key={`${key}-actions`}
                            payload={toolPart.output}
                            page={page}
                            onNavigate={onNavigate}
                          />
                        );
                      }
                      if (debug) {
                        return (
                          <Tool key={`${key}-debug`} defaultOpen={false}>
                            <ToolHeader
                              type={toolPart.type}
                              state={toolPart.state}
                              toolName={part.type === "dynamic-tool" ? toolName : undefined}
                              title={`debug · ${toolName.replaceAll("_", " ")}`}
                            />
                            <ToolContent>
                              <ToolInput input={toolPart.input} />
                              <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
                            </ToolContent>
                          </Tool>
                        );
                      }
                      // Normal users only ever see a plain activity line, and
                      // only while the answer is still being written.
                      if (!generating || !isLast) return null;
                      return (
                        <ActivityLine
                          key={`${key}-activity`}
                          toolName={toolName}
                          done={toolPart.state === "output-available" || toolPart.state === "output-error"}
                        />
                      );
                    })}
                  {needsScope && isLast && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 gap-1.5"
                      onClick={() => askForAccess(needsScope, previousQuestion)}
                    >
                      <ShieldQuestion className="h-3.5 w-3.5" />
                      Request {SCOPE_LABEL[needsScope] ?? needsScope} access
                    </Button>
                  )}
                  {premiumRequired && isLast && <PremiumTopupCard packages={premiumPackages} />}
                  {message.role === "assistant" && !generating && text.length > 0 && (
                    <AnswerFeedback threadId={threadId} messageId={message.id} />
                  )}
                </MessageContent>
              </Message>
            );
          })}

          {generating && waitingForAnswerText && (
            <Message from="assistant" className="max-w-[92%]">
              <MessageContent className="w-full bg-transparent px-0 py-0">
                <div
                  className="inline-flex max-w-full items-center gap-2.5 rounded-xl border bg-card/70 px-3 py-2.5 shadow-sm"
                  role="status"
                  aria-live="polite"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Sparkles className="h-4 w-4 animate-pulse" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Deep analysis</p>
                    <Shimmer className="text-sm font-medium">{analysisLabel}</Shimmer>
                  </div>
                </div>
              </MessageContent>
            </Message>
          )}

          {failed && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <p className="text-sm">{failed} Please try again in a moment.</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void submit({ text: lastQuestionRef.current })}>
                  Try again
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void reportFailure()}>
                  <Flag className="h-3.5 w-3.5" /> Report a problem
                </Button>
              </div>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 border-t bg-background px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <PromptInput onSubmit={submit} className="rounded-xl bg-background shadow-sm">
          <PromptInputTextarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask anything…"
            rows={1}
            enterKeyHint="send"
            autoCapitalize="sentences"
            autoCorrect="on"
            className="min-h-12 max-h-32 text-base leading-snug"
          />
          <PromptInputFooter>
            <PromptInputTools>
              {supported && (
                <PromptInputButton
                  tooltip={
                    dictation === "recording"
                      ? "Stop and transcribe"
                      : dictation === "transcribing"
                        ? "Writing your words…"
                        : "Speak your question"
                  }
                  variant={dictation === "recording" ? "default" : "ghost"}
                  onClick={toggle}
                  disabled={dictation === "transcribing"}
                  aria-label={dictation === "recording" ? "Stop dictation" : "Dictate"}
                >
                  {dictation === "transcribing" ? (
                    <Loader2 className="animate-spin" />
                  ) : dictation === "recording" ? (
                    <MicOff />
                  ) : (
                    <Mic />
                  )}
                </PromptInputButton>
              )}
              {dictation === "recording" && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" /> Listening…
                </span>
              )}
              {dictation === "transcribing" && (
                <span className="text-xs text-muted-foreground">Writing your words…</span>
              )}
            </PromptInputTools>

            <PromptInputSubmit
              className="h-10 w-10 rounded-full"
              status={status as ChatStatus}
              onStop={() => void stop()}
              disabled={!generating && !draft.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

export default function AssistantChat({
  threadId,
  onNeedThread,
  onThreadUpdated,
  onNavigate,
}: {
  threadId: string | null;
  onNeedThread: () => Promise<string | null>;
  onThreadUpdated?: () => void;
  onNavigate?: () => void;
}) {
  const { language } = useTranslation();
  const { profile } = useAuth();
  const { page } = useAssistantContext();
  const { messages: rows, loadingMessages, loadThreads } = useAssistant(threadId);
  // The first question of a brand-new chat is kept together with the thread it
  // belongs to. Keeping them in one value means the URL update that follows
  // thread creation can no longer race the transcript into dropping it.
  const [pending, setPending] = useState<{ id: string; text: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const activeThreadId = threadId ?? pending?.id ?? null;
  const starters = useMemo(() => starterPrompts(profile?.role, page.module), [profile?.role, page.module]);

  const createAndSend = async ({ text }: { text: string }) => {
    const value = text.trim();
    if (!value || starting) return;
    setStarting(true);
    try {
      const id = await onNeedThread();
      if (!id) {
        toast.error("Could not start a conversation");
        return;
      }
      setPending({ id, text: value });
    } finally {
      setStarting(false);
    }
  };

  if (!activeThreadId) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-md space-y-5 px-3 py-6">
            <div className="flex items-center gap-3">
              <img src={hotelCareMark} alt="" className="h-11 w-11 rounded-xl" />
              <div>
                <p className="text-lg font-semibold leading-tight">{greeting(profile?.full_name)}</p>
                <p className="text-sm text-muted-foreground">
                  {profile?.assigned_hotel ? `${profile.assigned_hotel} · ` : ""}
                  How can I help?
                </p>
              </div>
            </div>
            <div className="grid gap-2">
              {starters.map((starter) => (
                <button
                  key={starter.prompt}
                  type="button"
                  disabled={starting}
                  className="rounded-xl border bg-card px-3.5 py-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
                  onClick={() => void createAndSend({ text: starter.prompt })}
                >
                  <span className="block text-sm font-medium">{starter.label}</span>
                  <span className="block text-xs text-muted-foreground">{starter.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t bg-background px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <PromptInput onSubmit={createAndSend} className="rounded-xl bg-background shadow-sm">
            <PromptInputTextarea
              rows={1}
              enterKeyHint="send"
              autoCapitalize="sentences"
              autoCorrect="on"
              className="min-h-12 max-h-32 text-base leading-snug"
              placeholder="Ask anything…"
              autoFocus
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit
                className="h-10 w-10 rounded-full"
                status={starting ? "submitted" : undefined}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    );
  }

  // A freshly created thread has nothing stored yet, so the loading gate would
  // only hide the question the user just asked.
  if (loadingMessages && threadId && pending?.id !== threadId) {
    return (
      <div className="grid h-full place-items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
        Loading conversation…
      </div>
    );
  }

  return (
    <ChatSession
      key={activeThreadId}
      threadId={activeThreadId}
      initialMessages={assistantRowsToUiMessages(rows) as AssistantUiMessage[]}
      language={language}
      initialPrompt={pending?.id === activeThreadId ? pending.text : null}
      onNavigate={onNavigate}
      onThreadUpdated={() => {
        setPending(null);
        void loadThreads();
        onThreadUpdated?.();
      }}
    />
  );
}
