import { Shimmer } from "@/components/ai-elements/shimmer";
import { activityLabel } from "@/lib/assistant/activityLabels";

/**
 * What the user sees while the copilot works. Tool names, arguments and raw
 * results never reach the interface — only this one plain sentence.
 */
export default function ActivityLine({ toolName, done }: { toolName: string; done: boolean }) {
  const label = activityLabel(toolName);
  if (done) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">{label.replace(/…$/, "")}</p>
    );
  }
  return <Shimmer className="mt-1 text-xs">{label}</Shimmer>;
}
