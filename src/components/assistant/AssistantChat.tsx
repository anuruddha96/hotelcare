import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatStatus, type UIMessage } from "ai";
import { Mic, MicOff, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
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
import {
  assistantRowsToUiMessages,
  requestAssistantAccess,
  useAssistant,
} from "@/hooks/useAssistant";
import AutomationChangeCard, { isAutomationProposal } from "./AutomationChangeCard";

const STARTER_PROMPTS = [
  "How is the next 14 days pacing across my properties?",
  "Which dates are at risk of not filling, and what would you change?",
  "Review my automation rules and suggest one improvement.",
];

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

function ChatSession({
  threadId,
  initialMessages,
  language,
  initialPrompt,
  onThreadUpdated,
}: {
  threadId: string;
  initialMessages: AssistantUiMessage[];
  language: string;
  initialPrompt?: string | null;
  onThreadUpdated: () => void;
}) {
  const { user, profile } = useAuth();
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelSavedRef = useRef(false);
  const initialPromptSentRef = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AssistantUiMessage>({
        api: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant-chat`,
        headers: async () => {
          const { data } = await (await import("@/integrations/supabase/client")).supabase.auth.getSession();
          return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
        },
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, thread_id: threadId, language },
        }),
      }),
    [threadId, language],
  );

  const { messages, sendMessage, status, stop } = useChat<AssistantUiMessage>({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (error) => toast.error(error.message || "The assistant could not reply"),
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
    if (status === "submitted" || status === "streaming") cancelSavedRef.current = false;
  }, [status]);

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, [threadId]);

  useEffect(() => {
    if (!initialPrompt || initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;
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
    await sendMessage({ text: value });
  };

  const generating = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Conversation className="min-h-0">
        <ConversationContent className="gap-4 px-2 py-4 sm:px-3">
          {messages.length === 0 && (
            <ConversationEmptyState className="min-h-[48vh] px-5" title="How can I help?">
              <div className="mx-auto max-w-sm space-y-4 text-center">
                <img src="/icon-192.png" alt="Hotel Care" className="mx-auto h-12 w-12 rounded-lg" />
                <div>
                  <p className="font-medium text-foreground">How can I help?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ask about your work, your property, or Hotel Care. Answers respect your role.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="rounded-lg border bg-card px-3 py-2 text-left text-sm text-card-foreground
                                 transition-colors hover:bg-accent hover:text-accent-foreground"
                      onClick={() => void submit({ text: prompt })}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </ConversationEmptyState>
          )}

          {messages.map((message, index) => {
            const text = messageText(message);
            const needsScope = message.metadata?.needsScope;
            const previousQuestion = index > 0 ? messageText(messages[index - 1]) : "";
            return (
              <Message key={message.id} from={message.role} className="max-w-[88%]">
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
                      // A rule change proposal renders as an approve/dismiss card.
                      if (isAutomationProposal(toolPart.output)) {
                        return (
                          <AutomationChangeCard
                            key={`${message.id}-proposal-${partIndex}`}
                            proposal={toolPart.output}
                          />
                        );
                      }
                      return (
                        <Tool key={`${message.id}-tool-${partIndex}`} defaultOpen={false}>
                          <ToolHeader
                            type={toolPart.type}
                            state={toolPart.state}
                            toolName={part.type === "dynamic-tool" ? toolName : undefined}
                            title={toolName.replaceAll("_", " ")}
                          />
                          <ToolContent>
                            <ToolInput input={toolPart.input} />
                            <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
                          </ToolContent>
                        </Tool>
                      );
                    })}
                  {needsScope && index === messages.length - 1 && (
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
                </MessageContent>
              </Message>
            );
          })}

          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent className="bg-transparent px-0 py-0">
                <Shimmer>Hotel Care is thinking…</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 border-t bg-background px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <PromptInput onSubmit={submit} className="rounded-lg bg-background shadow-sm">
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
              className="h-9 w-9 rounded-full"
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
}: {
  threadId: string | null;
  onNeedThread: () => Promise<string | null>;
  onThreadUpdated?: () => void;
}) {
  const { language } = useTranslation();
  const { messages: rows, loadingMessages, loadThreads } = useAssistant(threadId);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const activeThreadId = threadId ?? pendingThreadId;

  const createAndSend = async ({ text }: { text: string }) => {
    const id = await onNeedThread();
    if (!id) {
      toast.error("Could not start a conversation");
      return;
    }
    setPendingThreadId(id);
    setPendingPrompt(text.trim());
  };

  useEffect(() => {
    if (threadId) setPendingThreadId(null);
  }, [threadId]);

  if (!activeThreadId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Conversation>
          <ConversationContent>
            <ConversationEmptyState className="min-h-[48vh]" title="How can I help?" description="Start a new chat below." />
          </ConversationContent>
        </Conversation>
        <div className="shrink-0 border-t bg-background px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <PromptInput onSubmit={createAndSend}>
            <PromptInputTextarea className="min-h-12 text-base" placeholder="Ask anything…" autoFocus />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit className="h-9 w-9 rounded-full" />
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
      onThreadUpdated={() => {
        setPendingPrompt(null);
        void loadThreads();
        onThreadUpdated?.();
      }}
    />
  );
}