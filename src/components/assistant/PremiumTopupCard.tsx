import { useState } from "react";
import { CreditCard, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export type PremiumPackage = {
  id: string;
  credits: number;
  amount_eur: number;
};

export default function PremiumTopupCard({ packages }: { packages?: PremiumPackage[] }) {
  const [loading, setLoading] = useState<string | null>(null);
  const options = packages?.length
    ? packages
    : [
        { id: "premium_5", credits: 5, amount_eur: 5 },
        { id: "premium_10", credits: 10, amount_eur: 10 },
      ];

  const checkout = async (packageId: string) => {
    setLoading(packageId);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const returnUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
      const { data, error } = await supabase.functions.invoke("assistant-premium-billing", {
        body: { action: "checkout", package_id: packageId, return_url: returnUrl },
      });
      if (error) throw error;
      const url = String((data as any)?.url ?? "");
      if (!url) throw new Error("Checkout URL was not returned");
      window.location.assign(url);
    } catch (error) {
      console.error("Assistant credit checkout failed", error);
      toast.error("Could not open the secure payment page.");
      setLoading(null);
    }
  };

  return (
    <div className="mt-3 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Add deep-analysis credits</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Secure Stripe checkout. Enter your company / invoice name, billing address and tax ID there. Credits stay available until used.
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant="outline"
            className="h-auto justify-between gap-3 px-3 py-2.5"
            disabled={Boolean(loading)}
            onClick={() => void checkout(option.id)}
          >
            <span className="flex items-center gap-2">
              {loading === option.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              <span className="text-left">
                <span className="block text-sm font-medium">{option.credits} more questions</span>
                <span className="block text-[11px] font-normal text-muted-foreground">one-time top-up</span>
              </span>
            </span>
            <span className="font-semibold">€{option.amount_eur}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
