import { useEffect, useState } from "react";
import { Download, ImageOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type AssistantImageSpec = { kind: "image"; path: string; prompt?: string; size?: string };

export function isAssistantImage(value: unknown): value is AssistantImageSpec {
  return Boolean(value) && typeof value === "object" && (value as any).kind === "image" && typeof (value as any).path === "string";
}

/** A generated image. Stored privately; shown through a short-lived link. */
export default function AssistantImage({ spec }: { spec: AssistantImageSpec }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    supabase.storage
      .from("assistant-media")
      .createSignedUrl(spec.path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) setFailed(true);
        else setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [spec.path]);

  const portrait = spec.size === "1024x1536";
  return (
    <figure className="mt-3 w-full max-w-md overflow-hidden rounded-xl border bg-card">
      <div className={portrait ? "aspect-[2/3] w-full bg-muted" : spec.size === "1536x1024" ? "aspect-[3/2] w-full bg-muted" : "aspect-square w-full bg-muted"}>
        {failed ? (
          <div className="grid h-full place-items-center gap-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ImageOff className="h-4 w-4" /> This image is no longer available.
            </span>
          </div>
        ) : url ? (
          <img src={url} alt={spec.prompt || "Generated image"} className="h-full w-full object-cover" onError={() => setFailed(true)} />
        ) : (
          <div className="grid h-full place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">AI-generated image{spec.prompt ? ` · ${spec.prompt}` : ""}</span>
        {url && (
          <a
            href={url}
            download="hotelcare-image.png"
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        )}
      </figcaption>
    </figure>
  );
}
