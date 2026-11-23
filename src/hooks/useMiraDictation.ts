import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type MiraVoiceState = "idle" | "starting" | "recording" | "transcribing" | "review";

type BrowserRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function recognitionConstructor(): (new () => BrowserRecognition) | null {
  if (typeof window === "undefined") return null;
  const browser = window as typeof window & {
    SpeechRecognition?: new () => BrowserRecognition;
    webkitSpeechRecognition?: new () => BrowserRecognition;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

async function transcribeAudio(blob: Blob, mimeType: string, language: string): Promise<string> {
  const extension = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new File([blob], "mira-voice." + extension, { type: mimeType }));
  if (language) form.append("language", language.slice(0, 5));
  const { data, error } = await supabase.functions.invoke("assistant-transcribe", { body: form });
  if (error) throw error;
  return String((data as { text?: string } | null)?.text ?? "").trim();
}

/**
 * Microphone content is NEVER inserted into the editable message until Use text
 * is pressed. Browser SpeechRecognition supplies interim words when available.
 * On Safari/iOS or when the recognizer stalls, short, complete MediaRecorder
 * samples provide a delayed live preview via the existing transcription endpoint.
 * The full uninterrupted recording is always used for the final transcript.
 */
export function useMiraDictation(onConfirm: (text: string) => void, language: string) {
  const [state, setState] = useState<MiraVoiceState>("idle");
  const [preview, setPreview] = useState("");
  const [liveHint, setLiveHint] = useState("Listening for words…");
  const stateRef = useRef<MiraVoiceState>("idle");
  const previewRef = useRef("");
  const sessionRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const mainRecorderRef = useRef<MediaRecorder | null>(null);
  const mainChunksRef = useRef<Blob[]>([]);
  const snippetRecorderRef = useRef<MediaRecorder | null>(null);
  const snippetTimerRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const nativeWordsRef = useRef(false);
  const snippetTextRef = useRef("");
  const snippetQueueRef = useRef<Promise<void>>(Promise.resolve());

  const supported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";

  const setPhase = useCallback((next: MiraVoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const updatePreview = useCallback((text: string) => {
    previewRef.current = text;
    setPreview(text);
  }, []);

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.abort(); } catch { /* Already closed */ }
  }, []);

  const stopSnippet = useCallback(() => {
    if (snippetTimerRef.current !== null) window.clearTimeout(snippetTimerRef.current);
    snippetTimerRef.current = null;
    if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    const recorder = snippetRecorderRef.current;
    snippetRecorderRef.current = null;
    if (recorder?.state === "recording") {
      // Never use the final partial sample; the main recording handles it.
      recorder.onstop = null;
      try { recorder.stop(); } catch { /* Already stopped */ }
    }
  }, []);

  const releaseMicrophone = useCallback(() => {
    stopRecognition();
    stopSnippet();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mainRecorderRef.current = null;
    mainChunksRef.current = [];
  }, [stopRecognition, stopSnippet]);

  const cancel = useCallback(() => {
    sessionRef.current += 1; // Late permission and transcription results are ignored.
    const recorder = mainRecorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state === "recording") {
        try { recorder.stop(); } catch { /* Already stopped */ }
      }
    }
    releaseMicrophone();
    snippetTextRef.current = "";
    updatePreview("");
    setPhase("idle");
  }, [releaseMicrophone, setPhase, updatePreview]);

  // Ensure the mic is released when navigating away, even during an upload.
  useEffect(() => () => {
    sessionRef.current += 1;
    const recorder = mainRecorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state === "recording") {
        try { recorder.stop(); } catch { /* Already stopped */ }
      }
    }
    releaseMicrophone();
  }, [releaseMicrophone]);

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    if (!supported) {
      toast.error("Voice input needs a browser with microphone recording support.");
      return;
    }

    const session = ++sessionRef.current;
    nativeWordsRef.current = false;
    snippetTextRef.current = "";
    snippetQueueRef.current = Promise.resolve();
    updatePreview("");
    setLiveHint("Listening for words…");
    setPhase("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Cancel may have been pressed while the permission prompt was visible.
      if (sessionRef.current !== session || (stateRef.current as MiraVoiceState) !== "starting") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = [
        "audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported?.(type));
      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      mainRecorderRef.current = recorder;
      mainChunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size) mainChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(mainChunksRef.current, { type });
        setPhase("transcribing");
        releaseMicrophone();
        if (sessionRef.current !== session) return;
        if (blob.size < 1200) {
          if (previewRef.current.trim()) setPhase("review");
          else {
            setPhase("idle");
            toast.error("No speech detected. Try speaking closer to the microphone.");
          }
          return;
        }
        void transcribeAudio(blob, type, language).then((text) => {
          if (sessionRef.current !== session) return;
          updatePreview(text || previewRef.current);
          if (previewRef.current.trim()) setPhase("review");
          else {
            setPhase("idle");
            toast.error("No speech detected. Try again.");
          }
        }).catch((error) => {
          if (sessionRef.current !== session) return;
          console.error("Mira voice transcription failed", error);
          if (previewRef.current.trim()) {
            setPhase("review");
            toast.warning("Final transcription unavailable. Please review the preview.");
          } else {
            setPhase("idle");
            toast.error("Could not transcribe this recording. Please try again.");
          }
        });
      };

      recorder.start();
      setPhase("recording");

      // Incremental, complete audio samples are needed where Web Speech has
      // no interim results (notably iPhone Safari). Each sample is independent
      // of the uninterrupted main recording used for accurate final text.
      const startSnippet = () => {
        if (sessionRef.current !== session || stateRef.current !== "recording" || nativeWordsRef.current) return;
        if (snippetRecorderRef.current?.state === "recording") return;
        try {
          const sample = new MediaRecorder(stream, options);
          const parts: Blob[] = [];
          snippetRecorderRef.current = sample;
          sample.ondataavailable = (event: BlobEvent) => {
            if (event.data.size) parts.push(event.data);
          };
          sample.onstop = () => {
            if (snippetTimerRef.current !== null) window.clearTimeout(snippetTimerRef.current);
            snippetTimerRef.current = null;
            if (snippetRecorderRef.current === sample) snippetRecorderRef.current = null;
            if (sessionRef.current !== session || stateRef.current !== "recording" || nativeWordsRef.current) return;
            const type = sample.mimeType || mimeType || "audio/webm";
            const blob = new Blob(parts, { type });
            if (blob.size >= 1200) {
              snippetQueueRef.current = snippetQueueRef.current.catch(() => {}).then(async () => {
                if (sessionRef.current !== session || nativeWordsRef.current || stateRef.current !== "recording") return;
                try {
                  const words = await transcribeAudio(blob, type, language);
                  if (sessionRef.current !== session || nativeWordsRef.current || stateRef.current !== "recording") return;
                  if (words) {
                    snippetTextRef.current = [snippetTextRef.current, words].filter(Boolean).join(" ");
                    updatePreview(snippetTextRef.current);
                    setLiveHint("Live transcript · preview only");
                  }
                } catch (error) {
                  // Network or provider errors must not disable Stop or the
                  // final full-recording transcription.
                  console.warn("Mira live preview temporarily unavailable", error);
                  setLiveHint("Recording… full transcript follows when stopped");
                }
              });
            }
            startSnippet();
          };
          sample.start();
          setLiveHint("Listening… live words will appear shortly");
          snippetTimerRef.current = window.setTimeout(() => {
            if (sample.state === "recording") {
              try { sample.stop(); } catch { /* Already stopped */ }
            }
          }, 6000);
        } catch (error) {
          console.warn("Incremental microphone preview unavailable", error);
          setLiveHint("Recording… full transcript follows when stopped");
        }
      };

      const Ctor = recognitionConstructor();
      if (Ctor) {
        try {
          const recognition = new Ctor();
          recognitionRef.current = recognition;
          recognition.lang = language || navigator.language || "en";
          recognition.continuous = true;
          recognition.interimResults = true;
          let committed = "";
          let recognitionFailed = false;
          recognition.onresult = (event: any) => {
            let interim = "";
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
              const result = event.results[i];
              const words = String(result[0]?.transcript ?? "");
              if (result.isFinal) committed = [committed, words].filter(Boolean).join(" ").trim();
              else interim += words;
            }
            const words = [committed, interim].filter(Boolean).join(" ").trim();
            if (!words || sessionRef.current !== session || stateRef.current !== "recording") return;
            nativeWordsRef.current = true;
            stopSnippet();
            updatePreview(words);
            setLiveHint("Live transcript · preview only");
          };
          recognition.onerror = () => {
            recognitionFailed = true;
            if (sessionRef.current === session && stateRef.current === "recording" && !nativeWordsRef.current) {
              startSnippet();
            }
          };
          recognition.onend = () => {
            if (sessionRef.current !== session || stateRef.current !== "recording") return;
            // If the browser denied native recognition, do not retry forever.
            if (recognitionFailed) {
              if (!nativeWordsRef.current) startSnippet();
              return;
            }
            try { recognition.start(); } catch {
              if (!nativeWordsRef.current) startSnippet();
            }
          };
          recognition.start();
          // Some browsers expose SpeechRecognition but never produce results.
          // Start the server-based live preview only if the native one stalls.
          fallbackTimerRef.current = window.setTimeout(() => {
            if (!nativeWordsRef.current) startSnippet();
          }, 2500);
        } catch {
          stopRecognition();
          startSnippet();
        }
      } else {
        startSnippet();
      }
    } catch (error) {
      if (sessionRef.current !== session) return;
      console.error("Mira microphone unavailable", error);
      releaseMicrophone();
      setPhase("idle");
      toast.error("Allow microphone access in your browser to talk to Mira.");
    }
  }, [language, releaseMicrophone, setPhase, stopRecognition, stopSnippet, supported, updatePreview]);

  const stop = useCallback(() => {
    if (stateRef.current === "starting") {
      cancel();
      return;
    }
    if (stateRef.current !== "recording") return;
    // Stop immediately; any in-flight preview requests may finish but cannot
    // change the final result once the recording enters this phase.
    setPhase("transcribing");
    stopRecognition();
    stopSnippet();
    const recorder = mainRecorderRef.current;
    if (recorder?.state === "recording") {
      try { recorder.stop(); } catch {
        releaseMicrophone();
        setPhase(previewRef.current.trim() ? "review" : "idle");
      }
    } else {
      releaseMicrophone();
      setPhase(previewRef.current.trim() ? "review" : "idle");
    }
  }, [cancel, releaseMicrophone, setPhase, stopRecognition, stopSnippet]);

  const confirm = useCallback(() => {
    if (stateRef.current !== "review") return;
    const words = previewRef.current.trim();
    if (!words) return;
    onConfirm(words);
    updatePreview("");
    setPhase("idle");
  }, [onConfirm, setPhase, updatePreview]);

  const toggle = useCallback(() => {
    if (stateRef.current === "idle") void start();
    else if (stateRef.current === "recording") stop();
    else if (stateRef.current === "starting" || stateRef.current === "transcribing") cancel();
  }, [cancel, start, stop]);

  return { state, preview, liveHint, supported, start, stop, cancel, confirm, toggle, setPreview: updatePreview };
}
