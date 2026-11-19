import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatStatus, type FileUIPart, type UIMessage } from "ai";
import { CheckCircle2, FileImage, FileText, Flag, Loader2, Mic, MicOff, Paperclip, ShieldQuestion, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { loadAssistantDraft, saveAssistantDraft } from "@/lib/assistant/activeThread";
import { useTranslation } from "@/hooks/useTranslation";
import { useAssistantContext } from "@/hooks/useAssistantContext";
import {
  assistantRowsToUiMessages,
  requestAssistantAccess,
  useAssistant,
} from "@/hooks/useAssistant";
import AssistantWelcome from "./AssistantWelcome";
import AssistantChart, { isAssistantChart } from "./AssistantChart";
import AssistantImage, { isAssistantImage } from "./AssistantImage";
import EmailDraftCard, { isEmailDraft } from "./EmailDraftCard";
import ReviewReplyCard, { isReviewReply } from "./ReviewReplyCard";
import { cn } from "@/lib/utils";
import { isAssistantDebugEnabled } from "@/lib/assistant/debugMode";
import { reportAssistantIssue, sendAssistantFeedback } from "@/lib/assistant/issueReports";
import AutomationChangeCard, { isAutomationProposal } from "./AutomationChangeCard";
import ActionConfirmCard, { isActionProposal } from "./ActionConfirmCard";
import ClarifyingQuestionCard, { isClarifyingQuestions } from "./ClarifyingQuestionCard";
import ActionRequestCard from "./plans/ActionRequestCard";
import { RatePlanView } from "./plans/RatePlanView";
import { isActionRequestAttachment, isRatePlan } from "./plans/types";
import { pricingProposalKey, pricingReviewApprovals } from "@/lib/assistant/pricingApproval";
import AssistantActions, { isAssistantActions } from "./AssistantActions";
import ActivityLine from "./ActivityLine";
import PremiumTopupCard, { type PremiumPackage } from "./PremiumTopupCard";
import { rolePlaceholderExamples } from "@/lib/assistant/starters";

const SCOPE_LABEL: Record<string, string> = {
  revenue: "Revenue management",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  reception: "Reception & front office",
};

type AssistantMetadata = {
  needsScope?: string;
  /** Charts and images of a stored answer, restored when a chat is reopened. */
  attachments?: unknown[];
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

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function speechRecognitionCtor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Speak-to-type. iOS Safari's SpeechRecognition is unreliable, so the audio is
 * recorded in the browser and transcribed server-side for the final text.
 * Where the browser offers SpeechRecognition (Chrome, Edge, Android), it runs
 * alongside the recording so the words appear in the box while the person is
 * still speaking; the server transcript then replaces that live preview.
 */
function useDictation(onText: (text: string) => void, language: string, onInterim?: (text: string | null) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const liveTextRef = useRef<string>("");
  const supported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.stop(); } catch { /* already stopped */ }
  }, []);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    stopRecognition();
  }, [stopRecognition]);

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
        else if (liveTextRef.current.trim()) onText(liveTextRef.current.trim());
        else toast.error("I didn’t catch that. Try again a little closer to the microphone.");
      } catch (error) {
        console.error("dictation failed", error);
        // The browser's own live transcript is better than losing the words.
        if (liveTextRef.current.trim()) onText(liveTextRef.current.trim());
        else toast.error("Could not turn that recording into text.");
      } finally {
        liveTextRef.current = "";
        onInterim?.(null);
        setState("idle");
      }
    },
    [language, onText, onInterim],
  );

  // Live preview while recording (best effort; the server transcript is final).
  const startRecognition = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    try {
      const recognition = new Ctor();
      recognition.lang = language || (typeof navigator !== "undefined" ? navigator.language : "en");
      recognition.continuous = true;
      recognition.interimResults = true;
      let committed = "";
      recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = String(result[0]?.transcript ?? "");
          if (result.isFinal) committed = `${committed} ${transcript}`.trim();
          else interim += transcript;
        }
        liveTextRef.current = `${committed} ${interim}`.trim();
        onInterim?.(liveTextRef.current);
      };
      recognition.onerror = () => { /* preview only; the recording still transcribes */ };
      recognition.onend = () => {
        // Chrome ends recognition after silence; keep listening while recording.
        if (recognitionRef.current === recognition && recorderRef.current?.state === "recording") {
          try { recognition.start(); } catch { /* ignore */ }
        }
      };
      recognition.start();
      recognitionRef.current = recognition;
    } catch (error) {
      console.warn("live transcript unavailable", error);
    }
  }, [language, onInterim]);

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
          // Too short to transcribe: keep whatever the live preview heard.
          const live = liveTextRef.current.trim();
          liveTextRef.current = "";
          if (live && !cancelledRef.current) onText(live);
          onInterim?.(null);
          setState("idle");
          return;
        }
        void transcribe(blob, type);
      };
      recorder.start();
      recorderRef.current = recorder;
      liveTextRef.current = "";
      setState("recording");
      startRecognition();
    } catch (error) {
      console.error("microphone unavailable", error);
      cleanup();
      setState("idle");
      toast.error("Microphone access is needed for voice input.");
    }
  }, [cleanup, supported, transcribe, startRecognition, onText, onInterim]);

  const stop = useCallback(() => {
    stopRecognition();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else setState("idle");
  }, [stopRecognition]);

  const toggle = useCallback(() => {
    if (state === "recording") stop();
    else if (state === "idle") void start();
  }, [start, state, stop]);

  return { state, supported, toggle };
}

/** A visual suggestion only: this never sends a message by itself. */
function useMiraTypewriter(examples: string[], enabled: boolean) {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (!enabled || !examples.length) { setPreview(""); return; }
    let current = 0;
    let typed = 0;
    let hold = 0;
    const tick = window.setInterval(() => {
      const example = examples[current];
      if (typed < example.length) {
        typed += 1;
        setPreview(example.slice(0, typed));
      } else if (++hold >= 32) {
        current = (current + 1) % examples.length;
        typed = 0;
        hold = 0;
        setPreview("");
      }
    }, 60);
    return () => window.clearInterval(tick);
  }, [enabled, examples]);
  return preview || "Ask Mira anything about your hotel…";
}

const MIRA_FILE_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,.pdf";
const MIRA_FILE_MAX_BYTES = 4 * 1024 * 1024;

/** Keep previews inside PromptInput's attachment context; private files are not public links. */
function MiraFilePreview() {
  const { files, remove } = usePromptInputAttachments();
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2 border-b px-3 pb-2 pt-2" aria-label="Files ready to attach">
      {files.map((file) => (
        <span key={file.id} className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-muted/50 px-2 py-1 text-xs">
          {file.mediaType === "application/pdf" ? <FileText className="h-4 w-4 shrink-0" /> : <FileImage className="h-4 w-4 shrink-0" />}
          <span className="max-w-40 truncate">{file.filename || "Attachment"}</span>
          <button type="button" aria-label={`Remove ${file.filename || "attachment"}`} onClick={() => remove(file.id)} className="rounded p-1 hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
        </span>
      ))}
    </div>
  );
}

/** File-only asks are valid; disable Submit only when neither text nor files exist. */
function MiraSubmit({ draft, status, busy = false, quotaReached = false, onStop }: {
  draft: string;
  status?: ChatStatus;
  busy?: boolean;
  quotaReached?: boolean;
  onStop?: () => void;
}) {
  const { files } = usePromptInputAttachments();
  const generating = status === "submitted" || status === "streaming";
  return (
    <PromptInputSubmit
      className="h-10 w-10 rounded-full"
      status={status}
      onStop={onStop}
      disabled={!generating && (busy || quotaReached || (!draft.trim() && files.length === 0))}
    />
  );
}

function MiraAddFileMenu() {
  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger className="h-9 gap-1.5 rounded-full border px-3 text-xs font-medium" aria-label="Attach a photo or PDF">
        <Paperclip className="h-4 w-4" /><span>Photo / PDF</span>
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent>
        <PromptInputActionAddAttachments label="Attach photos or a PDF" />
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
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
  initialFiles,
  externalPrompt,
  onExternalPromptConsumed,
  onThreadUpdated,
  onReplyViewed,
  onNavigate,
  workspace = false,
}: {
  threadId: string;
  initialMessages: AssistantUiMessage[];
  language: string;
  initialPrompt?: string | null;
  initialFiles?: FileUIPart[];
  externalPrompt?: { id: number; text: string } | null;
  onExternalPromptConsumed?: () => void;
  onThreadUpdated: () => void;
  onReplyViewed?: (persistedAssistantAt: string) => void;
  onNavigate?: () => void;
  workspace?: boolean;
}) {
  const { user, profile } = useAuth();
  const { page, capabilities } = useAssistantContext();
  const typewriterExamples = useMemo(() => rolePlaceholderExamples(profile?.role), [profile?.role]);
  const [draft, setDraft] = useState(() => loadAssistantDraft(threadId));
  const typedPlaceholder = useMiraTypewriter(typewriterExamples, !draft.trim());
  useEffect(() => { saveAssistantDraft(threadId, draft); }, [threadId, draft]);
  const [showResume, setShowResume] = useState(initialMessages.length > 0);
  const [modelTier, setModelTier] = useState<"auto" | "fast" | "balanced" | "deep">("auto");
  const [usage, setUsage] = useState<{ used: number; remaining: number | null; unlimited: boolean; resets_on?: string } | null>(null);
  const refreshUsage = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("assistant_monthly_status");
    if (!error && data) setUsage(data);
  }, []);
  useEffect(() => { void refreshUsage(); }, [refreshUsage]);
  const [failed, setFailed] = useState<string | null>(null);
  const failureDetailsRef = useRef<string | null>(null);
  const [analysisElapsedMs, setAnalysisElapsedMs] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelSavedRef = useRef(false);
  const initialPromptSentRef = useRef(false);
  const lastQuestionRef = useRef("");
  const debug = isAssistantDebugEnabled(profile?.role);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AssistantUiMessage>({
        api: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant-chat-router`,
        headers: async () => {
          const { data } = await (await import("@/integrations/supabase/client")).supabase.auth.getSession();
          return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
        },
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, thread_id: threadId, language, page, capabilities, model_tier: profile?.role === "admin" ? modelTier : "auto" },
        }),
      }),
    [threadId, language, page, capabilities, modelTier, profile?.role],
  );

  const { messages, sendMessage, regenerate, status, stop } = useChat<AssistantUiMessage>({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (error) => {
      void refreshUsage();
      failureDetailsRef.current = error instanceof Error ? error.message.slice(0, 700) : String(error).slice(0, 700);
      const quotaFailure = /monthly (?:allowance|message|quota)|message limit reached/i.test(failureDetailsRef.current);
      setFailed(quotaFailure
        ? "Your monthly message allowance has been reached. It resets on the 1st."
        : "The assistant could not process this request. No action has been confirmed.");
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
      // Only a persisted assistant message can be marked read; an aborted or
      // failed stream never counts as a completed unread answer.
      if (!isAbort && document.visibilityState === "visible") {
        const { data: savedReply } = await supabase.from("assistant_messages")
          .select("created_at").eq("thread_id", threadId)
          .eq("user_id", user?.id ?? "").eq("role", "assistant")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (savedReply?.created_at) onReplyViewed?.(savedReply.created_at);
      }
      void refreshUsage();
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
    void sendMessage({ text: initialPrompt, files: initialFiles });
  }, [initialPrompt, initialFiles, sendMessage]);
  const lastExternalPromptIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!externalPrompt || lastExternalPromptIdRef.current === externalPrompt.id) return;
    lastExternalPromptIdRef.current = externalPrompt.id;
    lastQuestionRef.current = externalPrompt.text;
    void sendMessage({ text: externalPrompt.text });
    onExternalPromptConsumed?.();
  }, [externalPrompt, sendMessage, onExternalPromptConsumed]);

  // The draft as it was when recording started; live words are appended to it
  // and the final transcript replaces them, so nothing typed before is lost.
  const dictationBaseRef = useRef<string | null>(null);
  const { state: dictation, supported, toggle } = useDictation(
    useCallback((text: string) => {
      setDraft((value) => {
        const base = dictationBaseRef.current ?? value;
        dictationBaseRef.current = null;
        return base ? `${base} ${text}` : text;
      });
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    }, []),
    language,
    useCallback((live: string | null) => {
      if (live === null) { dictationBaseRef.current = null; return; }
      setDraft((value) => {
        if (dictationBaseRef.current === null) dictationBaseRef.current = value;
        const base = dictationBaseRef.current;
        return base ? `${base} ${live}` : live;
      });
    }, []),
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

  const submit = async ({ text, files = [] }: { text: string; files?: FileUIPart[] }) => {
    const value = text.trim() || (files.length ? "Examine these attachments and identify the issue. Do not create or change a ticket unless I explicitly requested it." : "");
    if (!value || (usage && !usage.unlimited && usage.remaining === 0) || status === "submitted" || status === "streaming") return;
    setDraft("");
    setShowResume(false);
    setFailed(null);
    lastQuestionRef.current = value;
    await sendMessage({ text: value, files });
  };

  // A tapped answer to Mira's question. Unlike submit, a half-typed draft stays.
  const sendQuickAnswer = (text: string): boolean => {
    const value = text.trim();
    if (!value || (usage && !usage.unlimited && usage.remaining === 0) || status === "submitted" || status === "streaming") return false;
    setShowResume(false);
    setFailed(null);
    lastQuestionRef.current = value;
    void sendMessage({ text: value });
    return true;
  };

  const retryLastQuestion = async () => {
    if (!lastQuestionRef.current || status === "submitted" || status === "streaming") return;
    setFailed(null);
    await regenerate();
  };

  const reportFailure = async () => {
    const result = await reportAssistantIssue({
      title: "The assistant could not answer",
      description: lastQuestionRef.current || "No question captured",
      category: "assistant",
      severity: "normal",
      threadId,
      page,
      diagnostics: { error: failureDetailsRef.current },
    });
    if (!result.ok) toast.error(result.error ?? "Could not save the report.");
    else if (result.emailed) toast.success("Report saved and emailed to administrators.");
    else toast.warning("Report saved as " + result.id + ", but email delivery could not be confirmed.");
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
        <ConversationContent className={cn("gap-4 px-2 py-5 sm:px-3", workspace && "mx-auto w-full max-w-3xl gap-5 px-3 sm:px-6")}>
          {workspace && showResume && (
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
              <span>You're continuing this conversation. Mira remembers the discussion above.</span>
              <Button variant="ghost" size="sm" onClick={() => setShowResume(false)}>Got it</Button>
            </div>
          )}
          {messages.length === 0 && (
            <AssistantWelcome workspace={workspace} onAsk={(text) => void submit({ text })} onVoice={toggle} voiceSupported={supported} />
          )}

          {messages.map((message, index) => {
            const text = messageText(message);
            const needsScope = message.metadata?.needsScope;
            const premiumRequired = message.metadata?.premiumRequired === true;
            const premiumPackages = message.metadata?.premiumPackages;
            const previousQuestion = index > 0 ? messageText(messages[index - 1]) : "";
            const isLast = index === messages.length - 1;
            return (
              <Message key={message.id} from={message.role} className={workspace && message.role === "assistant" ? "max-w-full" : "max-w-[92%]"}>
                <MessageContent
                  className={
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "w-full bg-transparent px-0 py-0"
                  }
                >
                  {message.role === "assistant" ? (
                    <>
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-primary">
                          <Sparkles className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-foreground">Mira</span>
                        <span className="font-normal">HotelCare Operator</span>
                      </div>
                      <MessageResponse>{text}</MessageResponse>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="whitespace-pre-wrap">{text}</p>
                      {message.parts.filter((part) => part.type === "file").map((part, partIndex) => (
                        <span key={partIndex} className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-primary-foreground/10 px-2 py-1 text-xs">
                          {part.mediaType === "application/pdf" ? <FileText className="h-3.5 w-3.5" /> : <FileImage className="h-3.5 w-3.5" />}
                          <span className="max-w-52 truncate">{part.filename || "Attached evidence"}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {message.role === "assistant" &&
                    message.parts.map((part, partIndex) => {
                      if (!(part.type.startsWith("tool-") || part.type === "dynamic-tool")) return null;
                      const toolPart = part as any;
                      const toolName = part.type === "dynamic-tool" ? toolPart.toolName : part.type.slice(5);
                      const key = `${message.id}-${partIndex}`;

                      if (toolName === "execute_action" && toolPart.output?.ok === true) {
                        return (
                          <div key={key} className="mt-2 flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-xs">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                            <div><p className="font-semibold">{toolPart.output.status === "queued" ? "Queued by Mira by HotelCare" : toolPart.output.status === "recorded" ? "Recorded by Mira by HotelCare" : "Completed by Mira by HotelCare"}</p>
                              <p className="mt-1">{String(toolPart.output.summary)}</p>
                              {toolPart.output.actor && <p className="mt-1 text-muted-foreground">Requested by {String(toolPart.output.actor)}</p>}
                            </div>
                          </div>
                        );
                      }
                      if (toolName === "execute_action" && toolPart.output?.ok === false) {
                        return <p key={key} className="mt-2 text-xs text-destructive">Not completed: {String(toolPart.output.error || "Action not verified.")}</p>;
                      }
                      // Mira's clarifying question: tap an answer or type "Other".
                      // Only the latest question is answerable; once answered,
                      // the reply below it shows what was chosen.
                      if (toolName === "ask_user") {
                        if (!isLast || !isClarifyingQuestions(toolPart.output)) return null;
                        return (
                          <ClarifyingQuestionCard
                            key={`${key}-ask`}
                            spec={toolPart.output}
                            messageText={text}
                            interactive={!generating}
                            onAnswer={sendQuickAnswer}
                          />
                        );
                      }
                      if (toolName === "render_chart" && isAssistantChart(toolPart.output)) {
                        return <AssistantChart key={`${key}-chart`} spec={toolPart.output} />;
                      }
                      if (toolName === "generate_image" && isAssistantImage(toolPart.output)) {
                        return <AssistantImage key={`${key}-image`} spec={toolPart.output} />;
                      }
                      if (toolName === "draft_email" && isEmailDraft(toolPart.output)) {
                        return <EmailDraftCard key={`${key}-email`} spec={toolPart.output} />;
                      }
                      if (toolName === "draft_review_reply" && isReviewReply(toolPart.output)) {
                        return <ReviewReplyCard key={`${key}-review`} spec={toolPart.output} />;
                      }

                      // A plan Mira saved for approval: one visual card, kept after reload.
                      if ((toolName === "review_pricing" || toolName === "plan_work_schedule") && toolPart.state === "output-available") {
                        const requestId = toolPart.output?.data?.approval?.request_id ?? toolPart.output?.approval?.request_id;
                        if (typeof requestId === "string") return <ActionRequestCard key={`${key}-plan`} requestId={requestId} />;
                      }
                      if (toolName === "review_pricing" && toolPart.state === "output-available" && isRatePlan(toolPart.output?.data?.rate_plan)) {
                        const plan = toolPart.output.data.rate_plan;
                        const reviewed = pricingReviewApprovals(toolPart.output, profile?.role);
                        return (
                          <div key={`${key}-rateplan`} className="mt-3 space-y-3 rounded-2xl border bg-card p-4">
                            <div>
                              <p className="text-sm font-semibold">Rate plan · {plan.hotelName}</p>
                              <p className="text-xs text-muted-foreground">
                                {reviewed.length ? "Review each night; confirm the changes below." : "Recommendation only — top management approves price changes."}
                              </p>
                            </div>
                            <RatePlanView plan={plan} />
                            {reviewed.map((proposal) => <ActionConfirmCard key={pricingProposalKey(proposal.action, proposal.input)} proposal={proposal} />)}
                          </div>
                        );
                      }
                      if (toolName === "review_pricing" && toolPart.state === "output-available") {
                        const reviewed = pricingReviewApprovals(toolPart.output, profile?.role);
                        // If the model also created confirmation cards, display
                        // each rate/date proposal once, not two approval buttons.
                        const explicit = new Set(message.parts.flatMap((p) => {
                          if (!(p.type.startsWith("tool-") || p.type === "dynamic-tool")) return [];
                          const result = (p as any).output;
                          return isActionProposal(result)
                            ? [pricingProposalKey(result.action, result.input ?? {})] : [];
                        }));
                        const unmatched = reviewed.filter((proposal) =>
                          !explicit.has(pricingProposalKey(proposal.action, proposal.input)));
                        if (unmatched.length > 0) return (
                          <div key={key} className="mt-3 rounded-xl border border-primary/30 p-3" data-testid="pricing-review-approval-cards">
                            <p className="text-sm font-semibold">Review & approve suggested prices</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {unmatched.length} verified pricing proposal{unmatched.length === 1 ? "" : "s"}.
                              No rates have been changed. Each approval is checked again against
                              the live Previo prices and HotelCare safety rules before queuing.
                            </p>
                            {toolPart.output?.confidence === "partial" && (
                              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                                Some market data is incomplete or stale. Check the reasoning before approving.
                              </p>
                            )}
                            {unmatched.map((proposal) =>
                              <ActionConfirmCard
                                key={pricingProposalKey(proposal.action, proposal.input)}
                                proposal={proposal}
                              />)}
                          </div>
                        );
                      }
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
                  {message.role === "assistant" &&
                    !message.parts.some((part) => part.type.startsWith("tool-") || part.type === "dynamic-tool") &&
                    (message.metadata?.attachments ?? []).map((attachment, attachmentIndex) =>
                      isAssistantChart(attachment) ? (
                        <AssistantChart key={`${message.id}-saved-${attachmentIndex}`} spec={attachment} />
                      ) : isAssistantImage(attachment) ? (
                        <AssistantImage key={`${message.id}-saved-${attachmentIndex}`} spec={attachment} />
                      ) : isEmailDraft(attachment) ? (
                        <EmailDraftCard key={`${message.id}-saved-${attachmentIndex}`} spec={attachment} />
                      ) : isReviewReply(attachment) ? (
                        <ReviewReplyCard key={`${message.id}-saved-${attachmentIndex}`} spec={attachment} />
                      ) : isAssistantActions(attachment) ? (
                        <AssistantActions key={`${message.id}-saved-${attachmentIndex}`} payload={attachment} page={page} onNavigate={onNavigate} />
                      ) : isActionRequestAttachment(attachment) ? (
                        <ActionRequestCard key={`${message.id}-saved-${attachmentIndex}`} requestId={attachment.requestId} />
                      ) : isClarifyingQuestions(attachment) ? (
                        isLast ? (
                          <ClarifyingQuestionCard
                            key={`${message.id}-saved-${attachmentIndex}`}
                            spec={attachment}
                            messageText={text}
                            interactive={!generating}
                            onAnswer={sendQuickAnswer}
                          />
                        ) : null
                      ) : null,
                    )}
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
                  {message.role === "assistant" && isLast && !generating &&
                    /(?:attention|priorit|urgent|issues?|tasks?|what next|what should i do)/i.test(previousQuestion) && (
                    <div className="mt-4 flex flex-wrap gap-2" aria-label="Continue with Mira">
                      <Button size="sm" variant="outline" className="h-9 rounded-full text-xs"
                        onClick={() => void submit({ text: "From the latest verified results, what is the single most urgent action I can take now? If Mira is authorized, explain the exact action and what information or confirmation is needed." })}>
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Next best action
                      </Button>
                      <Button size="sm" variant="outline" className="h-9 rounded-full text-xs"
                        onClick={() => void submit({ text: "Which of these outstanding issues can Mira handle for me with my current permissions, and which need my approval? Do not make changes yet." })}>
                        What can Mira handle?
                      </Button>
                    </div>
                  )}
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
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mira by HotelCare</p>
                    <Shimmer className="text-sm font-medium">{analysisLabel}</Shimmer>
                  </div>
                </div>
              </MessageContent>
            </Message>
          )}

          {failed && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <p className="text-sm">{failed}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void retryLastQuestion()}>
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

      <div className={cn("shrink-0 bg-background px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]", workspace ? "mx-auto w-full max-w-3xl px-2 sm:px-6" : "border-t")}>
        <div className="mb-2 flex items-center justify-between gap-2 px-2 text-[11px] text-muted-foreground">
          <span className="truncate">Mira · {page.hotelId || profile?.assigned_hotel || "Your authorized hotels"} · Permission-aware</span>
          {usage && <span>{usage.unlimited ? "Unlimited messages" : `${usage.used}/20 messages this month`}</span>}
        </div>
        {profile?.role === "admin" && (
          <div className="mb-2 flex items-center gap-2 px-2">
            <span className="text-xs text-muted-foreground">AI model</span>
            <Select value={modelTier} onValueChange={(value) => setModelTier(value as typeof modelTier)}>
              <SelectTrigger className="h-8 w-[195px] rounded-lg text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto · cost optimized</SelectItem>
                <SelectItem value="fast">Fast · simple tasks</SelectItem>
                <SelectItem value="balanced">Balanced · operational tasks</SelectItem>
                <SelectItem value="deep">Deep · complex analysis</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {usage && !usage.unlimited && usage.remaining === 0 && (
          <p role="status" className="mb-2 rounded-lg bg-muted px-3 py-2 text-xs">
            Your 20 monthly messages are used. Your allowance resets on the 1st.
          </p>
        )}
        <PromptInput onSubmit={submit} accept={MIRA_FILE_ACCEPT} multiple maxFiles={3} maxFileSize={MIRA_FILE_MAX_BYTES} onError={(error) => toast.error(error.message)} className="rounded-2xl bg-background shadow-sm">
          <MiraFilePreview />
          <PromptInputTextarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={typedPlaceholder}
            rows={1}
            enterKeyHint="send"
            autoCapitalize="sentences"
            autoCorrect="on"
            className="min-h-12 max-h-36 resize-none text-base leading-relaxed"
          />
          <PromptInputFooter>
            <PromptInputTools>
              <MiraAddFileMenu />
              <PromptInputButton
                tooltip={
                  !supported ? "Microphone input requires browser permission and a secure connection"
                  : dictation === "recording" ? "Stop recording and transcribe"
                  : dictation === "transcribing" ? "Transcribing your recording…"
                  : "Record a message and convert speech to text"
                }
                variant={dictation === "recording" ? "default" : "outline"}
                onClick={toggle}
                disabled={dictation === "transcribing"}
                aria-label={dictation === "recording" ? "Stop and transcribe voice input" : "Start voice-to-text"}
                className="h-9 rounded-full border px-3 text-xs font-medium gap-2"
              >
                {dictation === "transcribing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : dictation === "recording" ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                <span>{dictation === "recording" ? "Stop & transcribe" : dictation === "transcribing" ? "Transcribing…" : "Voice to text"}</span>
              </PromptInputButton>
              {dictation === "recording" && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" /> {speechRecognitionCtor() ? "Listening — your words appear as you speak" : "Listening…"}
                </span>
              )}
              {dictation === "transcribing" && (
                <span className="text-xs text-muted-foreground">Writing your words…</span>
              )}
            </PromptInputTools>

            <MiraSubmit draft={draft} status={status as ChatStatus} onStop={() => void stop()} quotaReached={Boolean(usage && !usage.unlimited && usage.remaining === 0)} />
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
  onReplyViewed,
  onNavigate,
  workspace = false,
  suggestedPrompt,
  onSuggestedPromptConsumed,
}: {
  threadId: string | null;
  onNeedThread: () => Promise<string | null>;
  onThreadUpdated?: () => void;
  onReplyViewed?: (persistedAssistantAt: string) => void;
  onNavigate?: () => void;
  /** Full-page workspace layout: centred column and the live opening screen. */
  workspace?: boolean;
  suggestedPrompt?: { id: number; text: string } | null;
  onSuggestedPromptConsumed?: () => void;
}) {
  const { language } = useTranslation();
  const { profile } = useAuth();
  const [welcomeDraft, setWelcomeDraft] = useState("");
  const welcomeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const dictationBaseRef = useRef<string | null>(null);
  const { state: welcomeDictation, supported: welcomeVoiceSupported, toggle: toggleWelcomeVoice } = useDictation(
    useCallback((spoken: string) => {
      setWelcomeDraft((existing) => {
        const base = dictationBaseRef.current ?? existing;
        dictationBaseRef.current = null;
        return base ? `${base} ${spoken}` : spoken;
      });
      window.requestAnimationFrame(() => welcomeTextareaRef.current?.focus({ preventScroll: true }));
    }, []),
    language,
    useCallback((live: string | null) => {
      if (live === null) { dictationBaseRef.current = null; return; }
      setWelcomeDraft((existing) => {
        if (dictationBaseRef.current === null) dictationBaseRef.current = existing;
        const base = dictationBaseRef.current;
        return base ? `${base} ${live}` : live;
      });
    }, []),
  );
  const welcomeExamples = useMemo(() => rolePlaceholderExamples(profile?.role), [profile?.role]);
  const welcomePlaceholder = useMiraTypewriter(welcomeExamples, !welcomeDraft.trim());
  const { messages: rows, loadingMessages, loadThreads } = useAssistant(threadId);
  const latestVisibleReply = rows.filter((item) => item.role === "assistant").at(-1)?.created_at ?? null;
  useEffect(() => {
    if (loadingMessages || !latestVisibleReply || document.visibilityState !== "visible") return;
    onReplyViewed?.(latestVisibleReply);
    // Only mark on actual transcript changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, latestVisibleReply, loadingMessages]);
  useEffect(() => {
    const whenVisible = () => {
      if (document.visibilityState === "visible" && latestVisibleReply) onReplyViewed?.(latestVisibleReply);
    };
    document.addEventListener("visibilitychange", whenVisible);
    return () => document.removeEventListener("visibilitychange", whenVisible);
  }, [latestVisibleReply, onReplyViewed]);
  // The first question of a brand-new chat is kept together with the thread it
  // belongs to. Keeping them in one value means the URL update that follows
  // thread creation can no longer race the transcript into dropping it.
  const [pending, setPending] = useState<{ id: string; text: string; files?: FileUIPart[] } | null>(null);
  const [starting, setStarting] = useState(false);
  const activeThreadId = threadId ?? pending?.id ?? null;

  const createAndSend = async ({ text, files = [] }: { text: string; files?: FileUIPart[] }) => {
    const value = text.trim() || (files.length ? "Examine these attachments and identify the issue. Do not create or change a ticket unless I explicitly requested it." : "");
    if (!value || starting) return;
    setWelcomeDraft("");
    setStarting(true);
    try {
      const id = await onNeedThread();
      if (!id) {
        toast.error("Could not start a conversation");
        return;
      }
      setPending({ id, text: value, files });
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (!suggestedPrompt || activeThreadId || starting) return;
    void createAndSend({ text: suggestedPrompt.text });
    onSuggestedPromptConsumed?.();
  }, [suggestedPrompt, activeThreadId, starting]);

  if (!activeThreadId) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
          <AssistantWelcome workspace={workspace} disabled={starting} onAsk={(text) => void createAndSend({ text })} onVoice={toggleWelcomeVoice} voiceSupported={welcomeVoiceSupported} />
        </div>
        <div className="z-10 w-full shrink-0 border-t bg-background px-3 pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_22px_-18px_rgba(0,0,0,0.35)] sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <PromptInput onSubmit={async ({ text, files }) => createAndSend({ text: text || welcomeDraft, files })} accept={MIRA_FILE_ACCEPT} multiple maxFiles={3} maxFileSize={MIRA_FILE_MAX_BYTES} onError={(error) => toast.error(error.message)} className={cn("border bg-background shadow-sm", workspace ? "rounded-2xl" : "rounded-xl")}>
              <MiraFilePreview />
              <PromptInputTextarea
                ref={welcomeTextareaRef}
                value={welcomeDraft}
                onChange={(event) => setWelcomeDraft(event.target.value)}
                rows={1}
                enterKeyHint="send"
                autoCapitalize="sentences"
                autoCorrect="on"
                className="min-h-14 max-h-40 resize-none text-base leading-relaxed"
                placeholder={welcomePlaceholder}
              />
              <PromptInputFooter>
                <PromptInputTools>
                  <MiraAddFileMenu />
                  <PromptInputButton
                    tooltip={welcomeVoiceSupported ? "Speak instead of typing" : "Voice input requires microphone permission and a secure browser"}
                    variant={welcomeDictation === "recording" ? "default" : "outline"}
                    onClick={toggleWelcomeVoice}
                    disabled={!welcomeVoiceSupported || welcomeDictation === "transcribing" || starting}
                    aria-label={welcomeDictation === "recording" ? "Stop and transcribe voice input" : "Start voice-to-text"}
                    className="h-9 gap-2 rounded-full border px-3 text-xs font-medium"
                  >
                    {welcomeDictation === "transcribing" ? <Loader2 className="h-4 w-4 animate-spin" /> : welcomeDictation === "recording" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    <span>{welcomeDictation === "recording" ? "Stop & transcribe" : welcomeDictation === "transcribing" ? "Transcribing…" : "Voice to text"}</span>
                  </PromptInputButton>
                  {welcomeDictation === "recording" && <span className="flex items-center gap-1 text-xs text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-destructive" /> Listening…</span>}
                </PromptInputTools>
                <MiraSubmit draft={welcomeDraft} status={starting ? "submitted" : undefined} busy={starting} />
              </PromptInputFooter>
            </PromptInput>
          </div>
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
      initialFiles={pending?.id === activeThreadId ? pending.files : undefined}
      externalPrompt={pending?.id === activeThreadId ? null : suggestedPrompt}
      onExternalPromptConsumed={onSuggestedPromptConsumed}
      onNavigate={onNavigate}
      workspace={workspace}
      onReplyViewed={onReplyViewed}
      onThreadUpdated={() => {
        setPending(null);
        void loadThreads();
        onThreadUpdated?.();
      }}
    />
  );
}
