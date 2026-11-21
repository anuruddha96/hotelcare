import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatStatus, type FileUIPart, type UIMessage } from "ai";
import { Brain, Check, CheckCircle2, Copy, FileImage, FileText, Flag, Loader2, Mic, MicOff, Paperclip, Pencil, RefreshCw, ShieldQuestion, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { loadAssistantDraft, saveAssistantDraft } from "@/lib/assistant/activeThread";
import { useTranslation } from "@/hooks/useTranslation";
import { useMiraDictation, type MiraVoiceState } from "@/hooks/useMiraDictation";
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
import { sendAssistantFeedback } from "@/lib/assistant/issueReports";
import { fetchAssistantUsage, usageBlocked, usageNotice, type AssistantUsage } from "@/lib/assistant/usage";
import { answerLooksUnresolved } from "@/lib/assistant/answerSignals";
import ReportProblemDialog from "./ReportProblemDialog";
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
  /** Mira declined: outside HotelCare work or outside the person's role. */
  declined?: string;
  refused?: boolean;
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

/** Preview supported image attachments before sending and in Mira's chat transcript. */
function MiraFileTile({ file, inMessage = false, onRemove }: {
  file: FileUIPart;
  inMessage?: boolean;
  onRemove?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const filename = file.filename || "Attachment";
  const isImage = /^image\/(jpeg|png|webp)$/i.test(file.mediaType || "") &&
    /^(blob:|data:image\/|https:\/\/)/i.test(file.url || "");
  const showThumbnail = isImage && !imageFailed;

  return (
    <>
      <div className={cn(
        "group/file relative inline-flex max-w-full overflow-hidden rounded-xl border text-xs transition-colors",
        inMessage ? "border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground" : "border-border bg-muted/40 text-foreground",
      )}>
        {showThumbnail ? (
          <button type="button" onClick={() => setExpanded(true)} className="flex max-w-52 flex-col items-start text-left"
            title={`Preview ${filename}`} aria-label={`Preview ${filename}`}>
            <img src={file.url} alt={filename} loading="lazy" onError={() => setImageFailed(true)}
              className="h-28 w-44 max-w-full bg-muted/30 object-cover sm:h-32 sm:w-48" />
            <span className="block w-full truncate px-2 py-1.5 text-[11px]">{filename}</span>
          </button>
        ) : (
          <span className="flex min-h-10 max-w-56 items-center gap-2 px-3 py-2">
            {file.mediaType === "application/pdf" ? <FileText className="h-4 w-4 shrink-0" /> : <FileImage className="h-4 w-4 shrink-0" />}
            <span className="truncate">{filename}</span>
          </span>
        )}
        {onRemove && (
          <button type="button" aria-label={`Remove ${filename}`} onClick={onRemove}
            className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-background/95 text-foreground shadow-sm hover:bg-destructive/10 hover:text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {showThumbnail && (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-w-4xl border-0 bg-background p-2 shadow-xl sm:p-4">
            <DialogTitle className="pr-8 text-sm font-medium">{filename}</DialogTitle>
            <img src={file.url} alt={filename} className="max-h-[80dvh] w-full rounded-lg object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

type StoredMiraFile = { kind: "user_file"; path: string; filename: string; mediaType: string };
function isStoredMiraFile(value: unknown): value is StoredMiraFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Record<string, unknown>;
  return file.kind === "user_file" && typeof file.path === "string" &&
    typeof file.filename === "string" && typeof file.mediaType === "string";
}

/** Signed URLs are requested on view, so private evidence does not become public. */
function StoredMiraFileTile({ spec }: { spec: StoredMiraFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    supabase.storage.from("assistant-media").createSignedUrl(spec.path, 3600).then(({ data, error }) => {
      if (cancelled) return;
      if (!error && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [spec.path]);
  return url
    ? <MiraFileTile file={{ type: "file", filename: spec.filename, mediaType: spec.mediaType, url }} inMessage />
    : <span className="inline-flex items-center gap-2 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-2 text-xs">
        {spec.mediaType === "application/pdf" ? <FileText className="h-4 w-4" /> : <FileImage className="h-4 w-4" />}
        <span className="max-w-44 truncate">{spec.filename}</span>
      </span>;
}

/** The composer uses the same visual previews as messages sent to Mira. */
function MiraFilePreview() {
  const { files, remove } = usePromptInputAttachments();
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2 border-b px-3 pb-3 pt-2" aria-label="Files ready to attach">
      {files.map((file) => (
        <MiraFileTile key={file.id} file={file} onRemove={() => remove(file.id)} />
      ))}
    </div>
  );
}

/** File-only asks are valid; disable Submit only when neither text nor files exist. */
function MiraSubmit({ draft, status, busy = false, quotaReached = false, voicePending = false, onStop }: {
  draft: string;
  status?: ChatStatus;
  busy?: boolean;
  quotaReached?: boolean;
  voicePending?: boolean;
  onStop?: () => void;
}) {
  const { files } = usePromptInputAttachments();
  const generating = status === "submitted" || status === "streaming";
  return (
    <PromptInputSubmit
      className="h-10 w-10 rounded-full"
      status={status}
      onStop={onStop}
      disabled={!generating && (busy || quotaReached || voicePending || (!draft.trim() && files.length === 0))}
    />
  );
}


/** Transcribed speech remains a muted, editable preview until explicitly accepted. */
function MiraDictationPanel({
  state, preview, liveHint, onEdit, onStop, onCancel, onConfirm,
}: {
  state: MiraVoiceState;
  preview: string;
  liveHint: string;
  onEdit: (value: string) => void;
  onStop: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (state === "idle") return null;
  const recording = state === "recording";
  const transcribing = state === "transcribing";
  const reviewing = state === "review";
  const label = state === "starting" ? "Opening microphone…" :
    recording ? "Listening to you" :
    transcribing ? "Finishing transcription…" : "Review what Mira heard";

  return (
    <section aria-label="Mira voice input" className="mb-2 rounded-2xl border border-sky-200/75 bg-sky-50/50 p-3 shadow-sm dark:border-sky-900 dark:bg-sky-950/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          {transcribing || state === "starting" ?
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-600" /> :
            recording ? <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500" /> :
            <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-600" />}
          <span>{label}</span>
        </div>
        <Button type="button" size="sm" variant="ghost" className="h-9 shrink-0 rounded-full px-2.5 text-xs" onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" /> Cancel
        </Button>
      </div>
      <textarea
        aria-label={reviewing ? "Edit speech transcript before accepting" : "Live speech transcription preview"}
        aria-live={reviewing ? "off" : "polite"}
        value={preview}
        onChange={(event) => { if (reviewing) onEdit(event.target.value); }}
        readOnly={!reviewing}
        placeholder={recording ? liveHint : transcribing ? "Processing your recording…" : "Your spoken words appear here"}
        rows={Math.max(2, Math.min(5, preview.split("\n").length + Math.ceil(preview.length / 50)))}
        className="mt-2 min-h-[76px] w-full resize-y rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground/80 placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Preview only — not added to your message yet.</span>
        {recording ? (
          <Button type="button" size="sm" className="h-9 rounded-full px-4" onClick={onStop}>
            <MicOff className="mr-1.5 h-4 w-4" /> Stop talking
          </Button>
        ) : reviewing ? (
          <Button type="button" size="sm" className="h-9 rounded-full px-4" disabled={!preview.trim()} onClick={onConfirm}>
            <Check className="mr-1.5 h-4 w-4" /> Use text
          </Button>
        ) : transcribing ? (
          <span className="text-xs text-muted-foreground">You can cancel at any time.</span>
        ) : (
          <span className="text-xs text-muted-foreground">You can cancel while allowing the microphone.</span>
        )}
      </div>
    </section>
  );
}

function MiraAddFileMenu() {
  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger className="h-9 gap-1.5 rounded-full border px-2.5 text-xs font-medium sm:px-3" aria-label="Attach a photo or PDF">
        <Paperclip className="h-4 w-4" /><span className="hidden sm:inline">Photo / PDF</span>
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent>
        <PromptInputActionAddAttachments label="Attach photos or a PDF" />
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

/** Copies text and briefly shows a tick, like other chat apps. */
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => toast.error("Could not copy"));
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Actions under an answer: copy, regenerate, rate, report. */
function AnswerActions({
  threadId, messageId, text, canRegenerate, onRegenerate, onReport,
}: {
  threadId: string;
  messageId: string;
  text: string;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onReport: () => void;
}) {
  const { profile } = useAuth();
  const [sent, setSent] = useState<null | boolean>(null);
  const send = (helpful: boolean) => {
    setSent(helpful);
    void sendAssistantFeedback({
      threadId,
      messageId,
      helpful,
      organizationSlug: profile?.organization_slug ?? null,
      hotelId: profile?.assigned_hotel ?? null,
    });
    if (!helpful) toast("Thanks. Want the HotelCare team to look at it?", { action: { label: "Report", onClick: onReport } });
  };
  const iconButton = "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
  return (
    <div className="mt-1.5 flex items-center gap-0.5 opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100" aria-label="Answer actions">
      <CopyButton text={text} label="Copy answer" />
      {canRegenerate && (
        <button type="button" aria-label="Regenerate answer" title="Regenerate" className={iconButton} onClick={onRegenerate}>
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
      {sent === null ? (
        <>
          <button type="button" aria-label="Helpful" title="Helpful" className={iconButton} onClick={() => send(true)}>
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Not helpful" title="Not helpful" className={iconButton} onClick={() => send(false)}>
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <span className="px-1.5 text-xs text-muted-foreground">Thanks for the feedback.</span>
      )}
      <button type="button" aria-label="Report this answer to the HotelCare team" title="Report to the HotelCare team" className={iconButton} onClick={onReport}>
        <Flag className="h-3.5 w-3.5" />
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
  // Plan and usage come from the server; sending pauses only at a real limit.
  const [usage, setUsage] = useState<AssistantUsage | null>(null);
  const refreshUsage = useCallback(async () => {
    const next = await fetchAssistantUsage().catch(() => null);
    if (next) setUsage(next);
  }, []);
  useEffect(() => { void refreshUsage(); }, [refreshUsage]);
  const blocked = usageBlocked(usage);
  const notice = usageNotice(usage);
  // Report to the HotelCare team: from an answer, a failure or the composer.
  const [report, setReport] = useState<{ messageId: string | null; error: string | null; category?: string } | null>(null);
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
      const limitFailure = /monthly|daily safety limit|messages to Mira|allowance|message limit/i.test(failureDetailsRef.current);
      setFailed(limitFailure
        ? failureDetailsRef.current.replace(/^.*?"error"\s*:\s*"([^"]+)".*$/s, "$1")
        : "Mira could not answer this just now. Nothing was changed. Try again, or report it and the HotelCare team will look at it.");
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

  // Voice words remain separate from the typed draft until the user reviews
  // and accepts them. Cancel never changes what the user already typed.
  const {
    state: dictation, preview: voicePreview, liveHint: voiceHint, supported,
    toggle, stop: stopVoice, cancel: cancelVoice, confirm: confirmVoice,
    setPreview: editVoicePreview,
  } = useMiraDictation(
    useCallback((spoken: string) => {
      setDraft((value) => value.trim() ? value.trimEnd() + " " + spoken : spoken);
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

  const submit = async ({ text, files = [] }: { text: string; files?: FileUIPart[] }) => {
    const value = text.trim() || (files.length ? "Examine these attachments and identify the issue. Do not create or change a ticket unless I explicitly requested it." : "");
    if (!value || dictation !== "idle" || blocked || status === "submitted" || status === "streaming") return;
    setDraft("");
    setShowResume(false);
    setFailed(null);
    lastQuestionRef.current = value;
    await sendMessage({ text: value, files });
  };

  // A tapped answer to Mira's question. Unlike submit, a half-typed draft stays.
  const sendQuickAnswer = (text: string): boolean => {
    const value = text.trim();
    if (!value || dictation !== "idle" || blocked || status === "submitted" || status === "streaming") return false;
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

  const reportFailure = () => setReport({ messageId: null, error: failureDetailsRef.current, category: "assistant" });

  /** Edit the last question: it goes back into the composer, ready to resend. */
  const editLastQuestion = (text: string) => {
    if (status === "submitted" || status === "streaming") return;
    setDraft(text);
    window.requestAnimationFrame(() => {
      const box = textareaRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(text.length, text.length);
    });
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

  const lastUserIndex = useMemo(
    () => messages.reduce((last, m, i) => (m.role === "user" ? i : last), -1),
    [messages],
  );

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
            <AssistantWelcome workspace={workspace} onAsk={(text) => void submit({ text })} onVoice={toggle} voiceSupported={supported} voiceState={dictation} />
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
                      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-primary">
                          <Sparkles className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-foreground">Mira</span>
                      </div>
                      <MessageResponse>{text}</MessageResponse>
                    </>
                  ) : (
                    <div className="group/user space-y-2">
                      <p className="whitespace-pre-wrap">{text}</p>
                      <div className="flex flex-wrap gap-2">
                        {message.parts.filter((part) => part.type === "file").map((part, partIndex) => (
                          <MiraFileTile key={partIndex} file={part} inMessage />
                        ))}
                        {!message.parts.some((part) => part.type === "file") &&
                          (message.metadata?.attachments ?? []).filter(isStoredMiraFile).map((spec, partIndex) => (
                            <StoredMiraFileTile key={`${spec.path}-${partIndex}`} spec={spec} />
                          ))}
                      </div>
                    </div>
                  )}
                  {message.role === "assistant" &&
                    message.parts.map((part, partIndex) => {
                      if (!(part.type.startsWith("tool-") || part.type === "dynamic-tool")) return null;
                      const toolPart = part as any;
                      const toolName = part.type === "dynamic-tool" ? toolPart.toolName : part.type.slice(5);
                      const key = `${message.id}-${partIndex}`;

                      if ((toolName === "remember_about_user" || toolName === "forget_about_user") && toolPart.state === "output-available") {
                        const saved = toolPart.output?.memoryUpdate === "saved";
                        const deleted = toolPart.output?.memoryUpdate === "deleted";
                        if (!saved && !deleted) return null;
                        return (
                          <p key={`${key}-memory`} className="mt-2 inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
                            <Brain className="h-3 w-3" /> {saved ? "Memory updated" : "Removed from memory"}
                          </p>
                        );
                      }
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
                  {message.role === "assistant" && !generating && text.length > 0 && isLast &&
                    !message.metadata?.declined && !needsScope && answerLooksUnresolved(text) && (
                    <Button size="sm" variant="outline" className="mt-3 h-8 gap-1.5 rounded-full text-xs"
                      onClick={() => setReport({ messageId: message.id, error: null, category: "assistant" })}>
                      <Flag className="h-3.5 w-3.5" /> Report to the HotelCare team
                    </Button>
                  )}
                  {message.role === "assistant" && !generating && text.length > 0 && (
                    <AnswerActions
                      threadId={threadId}
                      messageId={message.id}
                      text={text}
                      canRegenerate={isLast}
                      onRegenerate={() => void retryLastQuestion()}
                      onReport={() => setReport({ messageId: message.id, error: null })}
                    />
                  )}
                </MessageContent>
                {message.role === "user" && text.length > 0 && (
                  <div className={cn(
                    "ml-auto flex items-center gap-0.5 transition-opacity",
                    index === lastUserIndex ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70 focus-within:opacity-100",
                  )}>
                    <CopyButton text={text} label="Copy message" />
                    {index === lastUserIndex && !generating && (
                      <button
                        type="button"
                        aria-label="Edit and resend"
                        title="Edit and resend"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        onClick={() => editLastQuestion(text)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
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

      <div className={cn("shrink-0 bg-background px-1 pb-3 pt-2", workspace ? "mx-auto w-full max-w-3xl px-2 sm:px-6" : "border-t")}>
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
        {notice && (
          <p role="status" className="mb-2 rounded-lg bg-muted px-3 py-2 text-xs">
            {notice}
          </p>
        )}
        <MiraDictationPanel state={dictation} preview={voicePreview} liveHint={voiceHint}
          onEdit={editVoicePreview} onStop={stopVoice} onCancel={cancelVoice} onConfirm={confirmVoice} />
        <PromptInput onSubmit={submit} accept={MIRA_FILE_ACCEPT} multiple maxFiles={3} maxFileSize={MIRA_FILE_MAX_BYTES} onError={(error) => toast.error(error.message)} className="bg-background [&>[data-slot=input-group]]:rounded-2xl">
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
                tooltip={!supported ? "Voice input requires microphone access" :
                  dictation === "recording" ? "Stop talking" :
                  dictation === "transcribing" || dictation === "starting" ? "Cancel voice capture" :
                  dictation === "review" ? "Use or cancel the preview above" : "Talk to Mira"}
                variant={dictation === "recording" ? "default" : "outline"}
                onClick={toggle}
                disabled={!supported || dictation === "review"}
                aria-label={dictation === "recording" ? "Stop talking" :
                  dictation !== "idle" ? "Cancel voice input" : "Start voice input"}
                className="h-9 rounded-full border px-3 text-xs font-medium gap-2"
              >
                {dictation === "recording" ? <MicOff className="h-4 w-4" /> :
                  dictation === "transcribing" || dictation === "starting" ? <X className="h-4 w-4" /> :
                  <Mic className="h-4 w-4" />}
                <span className={dictation === "idle" ? "hidden sm:inline" : undefined}>
                  {dictation === "recording" ? "Stop" :
                    dictation === "starting" || dictation === "transcribing" ? "Cancel" : "Voice"}
                </span>
              </PromptInputButton>
            </PromptInputTools>

            <MiraSubmit draft={draft} status={status as ChatStatus} onStop={() => void stop()} quotaReached={blocked} voicePending={dictation !== "idle"} />
          </PromptInputFooter>
        </PromptInput>
        <div className="mt-1.5 flex items-center justify-center gap-1.5 px-2 text-center text-[11px] text-muted-foreground">
          <span>Mira can make mistakes<span className="hidden sm:inline">; check important details</span>.</span>
          <button type="button" className="whitespace-nowrap underline-offset-2 hover:underline" onClick={() => setReport({ messageId: null, error: null })}>
            Report a problem
          </button>
        </div>
      </div>
      <ReportProblemDialog
        open={report !== null}
        onOpenChange={(open) => { if (!open) setReport(null); }}
        threadId={threadId}
        messageId={report?.messageId ?? null}
        defaultCategory={report?.category}
        technicalError={report?.error ?? null}
      />
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
  const {
    state: welcomeDictation, preview: welcomeVoicePreview, liveHint: welcomeVoiceHint,
    supported: welcomeVoiceSupported, toggle: toggleWelcomeVoice,
    stop: stopWelcomeVoice, cancel: cancelWelcomeVoice, confirm: confirmWelcomeVoice,
    setPreview: editWelcomeVoicePreview,
  } = useMiraDictation(
    useCallback((spoken: string) => {
      setWelcomeDraft((value) => value.trim() ? value.trimEnd() + " " + spoken : spoken);
      window.requestAnimationFrame(() => welcomeTextareaRef.current?.focus({ preventScroll: true }));
    }, []),
    language,
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
    if (!value || starting || welcomeDictation !== "idle") return;
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
          <AssistantWelcome workspace={workspace} disabled={starting} onAsk={(text) => void createAndSend({ text })} onVoice={toggleWelcomeVoice} voiceSupported={welcomeVoiceSupported} voiceState={welcomeDictation} />
        </div>
        <div className="z-10 w-full shrink-0 bg-background px-3 pb-3 pt-2 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <MiraDictationPanel state={welcomeDictation} preview={welcomeVoicePreview} liveHint={welcomeVoiceHint}
              onEdit={editWelcomeVoicePreview} onStop={stopWelcomeVoice} onCancel={cancelWelcomeVoice} onConfirm={confirmWelcomeVoice} />
            <PromptInput onSubmit={async ({ text, files }) => createAndSend({ text: text || welcomeDraft, files })} accept={MIRA_FILE_ACCEPT} multiple maxFiles={3} maxFileSize={MIRA_FILE_MAX_BYTES} onError={(error) => toast.error(error.message)} className={cn("bg-background [&>[data-slot=input-group]]:rounded-xl", workspace && "[&>[data-slot=input-group]]:rounded-2xl")}>
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
                    tooltip={welcomeVoiceSupported ? (welcomeDictation === "recording" ? "Stop talking" :
                      welcomeDictation === "review" ? "Use or cancel the preview above" : "Talk to Mira") :
                      "Voice input requires microphone permission and a secure browser"}
                    variant={welcomeDictation === "recording" ? "default" : "outline"}
                    onClick={toggleWelcomeVoice}
                    disabled={!welcomeVoiceSupported || welcomeDictation === "review" || starting}
                    aria-label={welcomeDictation === "recording" ? "Stop talking" : welcomeDictation !== "idle" ? "Cancel voice input" : "Start voice input"}
                    className="h-9 gap-2 rounded-full border px-2.5 text-xs font-medium sm:px-3"
                  >
                    {welcomeDictation === "recording" ? <MicOff className="h-4 w-4" /> :
                      welcomeDictation === "starting" || welcomeDictation === "transcribing" ? <X className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    <span className={welcomeDictation === "idle" ? "hidden sm:inline" : undefined}>
                      {welcomeDictation === "recording" ? "Stop" :
                        welcomeDictation === "starting" || welcomeDictation === "transcribing" ? "Cancel" : "Voice"}
                    </span>
                  </PromptInputButton>
                </PromptInputTools>
                <MiraSubmit draft={welcomeDraft} status={starting ? "submitted" : undefined} busy={starting} voicePending={welcomeDictation !== "idle"} />
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
