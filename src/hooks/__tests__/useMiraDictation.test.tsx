import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMiraDictation } from "../useMiraDictation";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

class RecordingMock {
  static isTypeSupported() { return true; }
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    // Long enough to pass the minimum audio size in the transcription endpoint.
    this.ondataavailable?.({ data: new Blob(["spoken audio ".repeat(200)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

let recognition: RecognitionMock;
class RecognitionMock {
  lang = "en";
  continuous = false;
  interimResults = false;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  start() { recognition = this; }
  stop() {}
  abort() {}
  emit(words: string) {
    this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: words }, isFinal: false }] });
  }
}

describe("Mira voice input", () => {
  let stopTrack: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke.mockReset().mockResolvedValue({
      data: { text: "Prepare next month's rates" },
      error: null,
    });
    stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
    });
    vi.stubGlobal("MediaRecorder", RecordingMock);
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: RecognitionMock });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows interim speech without inserting it until reviewed and confirmed", async () => {
    const onConfirm = vi.fn();
    const { result, unmount } = renderHook(() => useMiraDictation(onConfirm, "en"));

    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe("recording");

    act(() => { recognition.emit("Help me prepare next month"); });
    expect(result.current.preview).toBe("Help me prepare next month");
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.state).toBe("review"));
    expect(result.current.preview).toBe("Prepare next month's rates");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();

    act(() => { result.current.setPreview("Check December occupancy"); });
    act(() => { result.current.confirm(); });
    expect(onConfirm).toHaveBeenCalledWith("Check December occupancy");
    expect(result.current.state).toBe("idle");
    expect(result.current.preview).toBe("");
    unmount();
  });

  it("can cancel immediately while recording without ever adding words", async () => {
    const onConfirm = vi.fn();
    const { result, unmount } = renderHook(() => useMiraDictation(onConfirm, "en"));
    await act(async () => { await result.current.start(); });
    act(() => { recognition.emit("Discard this speech"); });
    act(() => { result.current.cancel(); });
    expect(result.current.state).toBe("idle");
    expect(result.current.preview).toBe("");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    unmount();
  });

  it("allows cancellation even after Stop while transcription is in flight", async () => {
    let resolveTranscript!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveTranscript = resolve; }));
    const onConfirm = vi.fn();
    const { result, unmount } = renderHook(() => useMiraDictation(onConfirm, "en"));
    await act(async () => { await result.current.start(); });
    act(() => { result.current.stop(); });
    expect(result.current.state).toBe("transcribing");
    act(() => { result.current.cancel(); });
    await act(async () => {
      resolveTranscript({ data: { text: "Should be discarded" }, error: null });
      await Promise.resolve();
    });
    expect(result.current.state).toBe("idle");
    expect(result.current.preview).toBe("");
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();
  });

  it("starts a delayed live preview on browsers without SpeechRecognition", async () => {
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    const { result, unmount } = renderHook(() => useMiraDictation(onConfirm, "en"));
    await act(async () => { await result.current.start(); });
    expect(result.current.preview).toBe("");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.preview).toBe("Prepare next month's rates");
    expect(result.current.state).toBe("recording");
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => { result.current.cancel(); });
    unmount();
  });
});
