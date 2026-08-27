import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Flag, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useTrainingV2Optional } from "@/components/training/v2/TrainingV2Provider";
import { canOpenDestination, findDestination } from "@/lib/assistant/navigationRegistry";
import type { AssistantPageContext } from "@/hooks/useAssistantContext";
import { reportAssistantIssue } from "@/lib/assistant/issueReports";

export interface AssistantAction {
  type: "navigate" | "guide" | "report_issue";
  label?: string;
  destination?: string;
  guide?: string;
  title?: string;
  summary?: string;
  category?: string;
  severity?: string;
}

export interface AssistantActionPayload {
  kind: "assistant_actions";
  actions?: AssistantAction[];
}

export function isAssistantActions(value: unknown): value is AssistantActionPayload {
  return Boolean(value) && typeof value === "object" && (value as AssistantActionPayload).kind === "assistant_actions";
}

/**
 * Renders the structured actions an answer offers. Every action is validated
 * against the navigation registry and the user's role before it is shown, so
 * the model can never route someone into a screen they may not open.
 */
export default function AssistantActions({
  payload,
  page,
  onNavigate,
}: {
  payload: AssistantActionPayload;
  page: AssistantPageContext;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const training = useTrainingV2Optional();
  const [reporting, setReporting] = useState(false);
  const org = page.organizationSlug ?? profile?.organization_slug ?? "";

  const actions = (payload.actions ?? []).filter((action) => {
    if (action.type === "navigate" || action.type === "guide") {
      if (!action.destination && action.type === "navigate") return false;
      if (action.destination) {
        const destination = findDestination(action.destination);
        if (!destination || !canOpenDestination(destination, profile?.role)) return false;
      }
      if (action.type === "guide" && !action.guide) return false;
    }
    return true;
  });

  if (actions.length === 0) return null;

  const go = (destinationId?: string) => {
    if (!destinationId) return;
    const destination = findDestination(destinationId);
    if (!destination || !org) return;
    onNavigate?.();
    navigate(destination.path(org));
  };

  const showMe = async (action: AssistantAction) => {
    go(action.destination);
    if (!action.guide) return;
    if (!training) {
      toast.info("Walkthroughs are not available on this screen.");
      return;
    }
    // Let the destination render before the spotlight looks for its target.
    window.setTimeout(() => void training.start(action.guide as string, { manual: true, restart: true }), 400);
  };

  const report = async (action: AssistantAction) => {
    setReporting(true);
    const result = await reportAssistantIssue({
      title: action.title ?? "Problem reported from the assistant",
      description: action.summary ?? "",
      aiSummary: action.summary ?? null,
      category: action.category ?? "other",
      severity: action.severity ?? "normal",
      page,
    });
    setReporting(false);
    if (result.ok) toast.success("Thanks — this has been sent to the Hotel Care team.");
    else toast.error(result.error ?? "Could not send the report just now.");
  };

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((action, index) => {
        if (action.type === "navigate") {
          const destination = findDestination(action.destination as string);
          return (
            <Button
              key={`${index}-nav`}
              size="sm"
              variant="secondary"
              className="gap-1.5"
              onClick={() => go(action.destination)}
            >
              {action.label ?? `Open ${destination?.label ?? "page"}`}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          );
        }
        if (action.type === "guide") {
          return (
            <Button key={`${index}-guide`} size="sm" variant="outline" className="gap-1.5" onClick={() => void showMe(action)}>
              <Sparkles className="h-3.5 w-3.5" />
              {action.label ?? "Show me"}
            </Button>
          );
        }
        return (
          <Button
            key={`${index}-report`}
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={reporting}
            onClick={() => void report(action)}
          >
            <Flag className="h-3.5 w-3.5" />
            {action.label ?? "Report issue"}
          </Button>
        );
      })}
    </div>
  );
}
