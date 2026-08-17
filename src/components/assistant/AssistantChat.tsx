import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2, Mic, MicOff, Send, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { requestAssistantAccess, useAssistant } from "@/hooks/useAssistant";
import { cn } from "@/lib/utils";

const SCOPE_LABEL: Record<string, string> = {
  revenue: "Revenue management",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  reception: "Reception & front office",
};

/** Speak-to-type using the browser's speech recognition (no extra cost). */
function useDictation(onText: (t: string) => void) {
  const recRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const supported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const toggle = () => {
    if (!supported) {
      toast.error("Voice input is not supported in this browser");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e: any) => {
      const text = Array.from(e.results)
        .map((r: any) => r[0].transcript)
        .join(" ");
      onText(text.trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  return { listening, supported, toggle };
}

export default function AssistantChat({
  threadId,
  onNeedThread,
}: {
  threadId: string | null;
  onNeedThread: () => Promise<string | null>;
}) {
  const { user, profile } = useAuth();
  const { messages, sending, send } = useAssistant(threadId);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { listening, toggle } = useDictation((t) => setInput((v) => (v ? `${v} ${t}` : t)));

  useEffect(() => {
    inputRef.current?.focus();
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  const submit = async () => {
    const q = input.trim();
    if (!q || sending) return;
    let id = threadId;
    if (!id) id = await onNeedThread();
    if (!id) return;
    setInput("");
    await send(q, id);
    inputRef.current?.focus();
  };

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

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 p-1">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground space-y-2 p-3">
            <p className="font-medium text-foreground">How can I help?</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>“How do I assign a room to a housekeeper?”</li>
              <li>“What is the ADR for this month?”</li>
              <li>“Which maintenance tickets are overdue?”</li>
            </ul>
            <p>I answer inside your role and your own property only.</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "rounded-2xl px-3 py-2 max-w-[85%] text-sm",
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              {m.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                m.content
              )}
              {m.needsScope && i === messages.length - 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 gap-1.5"
                  onClick={() =>
                    askForAccess(m.needsScope!, messages[i - 1]?.content ?? "")
                  }
                >
                  <ShieldQuestion className="h-3.5 w-3.5" />
                  Request {SCOPE_LABEL[m.needsScope] ?? m.needsScope} access
                </Button>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3 py-2 bg-muted text-sm flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="pt-2 border-t mt-2 pb-[env(safe-area-inset-bottom)] bg-background">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => {
              // iOS keyboard: keep the composer and the last reply in view.
              setTimeout(() => bottomRef.current?.scrollIntoView({ block: "end" }), 250);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            enterKeyHint="send"
            autoCapitalize="sentences"
            autoCorrect="on"
            placeholder="Ask anything…"
            /* text-base keeps iOS from zooming the page on focus */
            className="min-h-[44px] max-h-32 resize-none text-base leading-snug"
          />
          <Button
            type="button"
            size="icon"
            variant={listening ? "default" : "outline"}
            onClick={toggle}
            aria-label="Dictate"
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button type="button" size="icon" onClick={submit} disabled={sending || !input.trim()} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
