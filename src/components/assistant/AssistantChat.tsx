import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatStatus, type UIMessage } from "ai";
import { Flag, Mic, MicOff, ShieldQuestion, ThumbsDown, ThumbsUp } from "lucide-react";
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
import hotelCareMark from "@/assets/hotelcare-logo-mark.png";

const SCOPE_LABEL: Record<string, string> = {
  revenue: "Revenue management",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  reception: "Reception & front office",
};

type AssistantMetadata = { needsScope?: string };
type AssistantUiMessage = UIMessage<AssistantMetadata>;

function messageText(message: AssistantUiMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** Speak-to-type using the browser's speech recognition. */
function useDictation(onText: (text: string) => void) {
  const recognitionRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const supported =
    typeof window !== "undefined" &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
    },
    [],
  );

  const toggle = useCallback(() => {
    if (!supported) {
      toast.error("Voice input is not supported in this browser");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event: any) => {
      const text = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join(" ")
        .trim();
      if (text) onText(text);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening, onText, supported]);

  return { listening, supported, toggle };
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelSavedRef = useRef(false);
  const initialPromptSentRef = useRef(false);
  const lastQuestionRef = useRef("");
  const debug = isAssistantDebugEnabled(profile?.role);
  const starters = useMemo(() => starterPrompts(profile?.role, page.module), [profile?.role, page.module]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AssistantUiMessage>({
        api: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant-chat`,
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

  const { listening, supported, toggle } = useDictation(
    useCallback((text: string) => setDraft((value) => (value ? `${value} ${text}` : text)), []),
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
                  {message.role === "assistant" && !generating && text.length > 0 && (
                    <AnswerFeedback threadId={threadId} messageId={message.id} />
                  )}
                </MessageContent>
              </Message>
            );
          })}

          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent className="bg-transparent px-0 py-0">
                <Shimmer>Thinking…</Shimmer>
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
                  tooltip={listening ? "Stop dictation" : "Dictate"}
                  variant={listening ? "default" : "ghost"}
                  onClick={toggle}
                  aria-label={listening ? "Stop dictation" : "Dictate"}
                >
                  {listening ? <MicOff /> : <Mic />}
                </PromptInputButton>
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
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const activeThreadId = threadId ?? pendingThreadId;
  const starters = useMemo(() => starterPrompts(profile?.role, page.module), [profile?.role, page.module]);

  const createAndSend = async ({ text }: { text: string }) => {
    const value = text.trim();
    if (!value) return;
    const id = await onNeedThread();
    if (!id) {
      toast.error("Could not start a conversation");
      return;
    }
    setPendingThreadId(id);
    setPendingPrompt(value);
  };

  useEffect(() => {
    if (threadId) setPendingThreadId(null);
  }, [threadId]);

  if (!activeThreadId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
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
                  className="rounded-xl border bg-card px-3.5 py-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
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
          <PromptInput onSubmit={createAndSend}>
            <PromptInputTextarea className="min-h-12 text-base" placeholder="Ask anything…" autoFocus />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit className="h-10 w-10 rounded-full" />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    );
  }

  if (loadingMessages && threadId) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading conversation…</div>;
  }

  return (
    <ChatSession
      key={activeThreadId}
      threadId={activeThreadId}
      initialMessages={assistantRowsToUiMessages(rows) as AssistantUiMessage[]}
      language={language}
      initialPrompt={pendingThreadId === activeThreadId ? pendingPrompt : null}
      onNavigate={onNavigate}
      onThreadUpdated={() => {
        setPendingPrompt(null);
        void loadThreads();
        onThreadUpdated?.();
      }}
    />
  );
}
