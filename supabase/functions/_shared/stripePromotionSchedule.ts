import Stripe from "npm:stripe@18";
import {
  listPriceFor,
  moduleScopedPromotionsEnabled,
  normaliseModule,
  promotionActiveFor,
  promotionFor,
  type BillingSettings,
  type ModuleKey,
} from "./billing.ts";

export type BillingSelection = { hotel_id: string; module: ModuleKey };

/** The order mirrors the Checkout line-item metadata and the webhook upsert. */
export function parseBillingSelections(meta: Record<string, string> | null | undefined): BillingSelection[] {
  const raw = meta?.selections ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((pair) => {
      const [hotel_id, rawModule] = pair.split(":");
      return { hotel_id, module: normaliseModule(String(rawModule ?? "")) };
    })
    .filter(
      (selection) =>
        Boolean(selection.hotel_id) &&
        ["revenue_bi", "revenue_automation", "operations", "maintenance"].includes(selection.module),
    );
}

function productId(price: Stripe.Price): string | null {
  if (typeof price.product === "string") return price.product;
  if (price.product && "id" in price.product) return String(price.product.id);
  return null;
}

function taxRateIds(item: Stripe.SubscriptionItem): string[] {
  return (item.tax_rates ?? [])
    .map((rate) => (typeof rate === "string" ? rate : rate?.id))
    .filter((value): value is string => Boolean(value));
}

/** First instant after the customer-facing inclusive promotion end date. */
function boundarySeconds(endsAt: string) {
  const millis = new Date(`${endsAt.slice(0, 10)}T23:59:59.999Z`).getTime() + 1;
  return Math.floor(millis / 1000);
}

type Target = {
  itemIndex: number;
  hotelId: string;
  module: ModuleKey;
  standardCents: number;
  boundary: number;
  currentPriceId: string;
  productId?: string;
  standardPriceId?: string;
};

/**
 * Makes a Stripe subscription follow HotelCare's module promotion end dates.
 *
 * Safety rules:
 * - does nothing unless this organization explicitly uses module-scoped promos;
 * - never takes over a Stripe schedule not created by HotelCare;
 * - validates every target recurring item before changing a schedule;
 * - updates an existing HotelCare-owned schedule in place instead of releasing it;
 * - uses proration_behavior=none so configuring the future standard price does
 *   not create a surprise invoice today.
 */
export async function ensureModulePromotionSchedule(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  settings: BillingSettings,
): Promise<{ status: string; scheduleId?: string }> {
  if (!moduleScopedPromotionsEnabled(settings)) return { status: "legacy_organization" };
  if (!["active", "trialing", "past_due"].includes(subscription.status)) return { status: "inactive_subscription" };

  const selections = parseBillingSelections((subscription.metadata ?? {}) as Record<string, string>);
  const items = subscription.items?.data ?? [];
  if (!selections.length || !items.length) return { status: "no_selections" };

  const nowSec = Math.floor(Date.now() / 1000);
  const targets: Target[] = [];

  for (let i = 0; i < selections.length; i++) {
    const selection = selections[i];
    const item = items[i];
    if (!item || selection.module === "maintenance") continue;

    const promo = promotionFor(settings, selection.module);
    if (!promo.enabled || !promo.endsAt || !promotionActiveFor(settings, selection.module)) continue;

    const standardCents = listPriceFor(settings, selection.module);
    const currentCents = Number(item.price?.unit_amount ?? 0);
    const boundary = boundarySeconds(promo.endsAt);
    if (standardCents <= 0 || currentCents >= standardCents || boundary <= nowSec + 60) continue;

    const product = productId(item.price);
    if (!product || !item.price.recurring) {
      console.warn("billing promotion schedule skipped: recurring product unavailable", {
        organization: settings.organization_slug,
        subscription: subscription.id,
        module: selection.module,
      });
      return { status: "price_not_schedulable" };
    }

    targets.push({
      itemIndex: i,
      hotelId: selection.hotel_id,
      module: selection.module,
      standardCents,
      boundary,
      currentPriceId: item.price.id,
      productId: product,
    });
  }

  if (!targets.length) return { status: "no_scheduled_promotions" };

  const token = targets
    .map((target) => `${target.hotelId}:${target.module}:${target.boundary}:${target.standardCents}:${target.currentPriceId}`)
    .join("|")
    .slice(0, 480);

  // Inspect any existing schedule before creating anything. HotelCare never
  // modifies or releases a schedule it does not own.
  let existingSchedule: Stripe.SubscriptionSchedule | null = null;
  if (subscription.schedule) {
    existingSchedule =
      typeof subscription.schedule === "string"
        ? await stripe.subscriptionSchedules.retrieve(subscription.schedule)
        : subscription.schedule;

    const existingMeta = (existingSchedule.metadata ?? {}) as Record<string, string>;
    if (existingMeta.hotelcare_module_promo_schedule !== "1") {
      console.warn("billing promotion schedule skipped: subscription already has an external schedule", {
        organization: settings.organization_slug,
        subscription: subscription.id,
        schedule: existingSchedule.id,
      });
      return { status: "external_schedule", scheduleId: existingSchedule.id };
    }
    if (existingMeta.hotelcare_promo_config === token) {
      return { status: "already_scheduled", scheduleId: existingSchedule.id };
    }
  }

  // Build all standard recurring Prices first. If validation/creation fails,
  // the current subscription and any existing HotelCare schedule are untouched.
  for (const target of targets) {
    const item = items[target.itemIndex];
    const recurring = item.price.recurring!;
    const taxBehavior = item.price.tax_behavior === "inclusive" ? "inclusive" : "exclusive";
    const standardPrice = await stripe.prices.create({
      currency: item.price.currency,
      unit_amount: target.standardCents,
      product: target.productId!,
      tax_behavior: taxBehavior,
      recurring: {
        interval: recurring.interval,
        interval_count: recurring.interval_count || 1,
      },
      metadata: {
        hotelcare_managed: "1",
        organization_slug: settings.organization_slug,
        hotel_id: target.hotelId,
        module: target.module,
        purpose: "post_promotion_standard_price",
      },
    });
    target.standardPriceId = standardPrice.id;
  }

  let schedule: Stripe.SubscriptionSchedule | null = existingSchedule;
  let createdHere = false;
  try {
    // Stripe requires a separate create call when the subscription does not yet
    // have a schedule. A schedule created from_subscription inherits the current
    // billing/trial state. Existing HotelCare schedules are updated in place.
    if (!schedule) {
      schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id });
      createdHere = true;
    }

    const currentStart = Number(schedule.current_phase?.start_date ?? schedule.phases?.[0]?.start_date ?? nowSec);
    const boundaries = Array.from(new Set(targets.map((target) => target.boundary)))
      .filter((boundary) => boundary > currentStart)
      .sort((a, b) => a - b);
    if (!boundaries.length) {
      if (createdHere) await stripe.subscriptionSchedules.release(schedule.id);
      return { status: "no_future_boundary", scheduleId: existingSchedule?.id };
    }

    const phaseStarts = [currentStart, ...boundaries];
    const originalTrialEnd = Number(subscription.trial_end ?? 0);

    const phases = phaseStarts.map((start, phaseIndex) => {
      const end = boundaries[phaseIndex];
      const phaseItems = items.map((item, itemIndex) => {
        const target = targets.find((candidate) => candidate.itemIndex === itemIndex);
        const useStandard = Boolean(target && start >= target.boundary && target.standardPriceId);
        return {
          price: useStandard ? target!.standardPriceId! : item.price.id,
          quantity: item.quantity ?? 1,
          tax_rates: taxRateIds(item),
        };
      });

      const phase: Record<string, unknown> = {
        start_date: start,
        items: phaseItems,
        proration_behavior: "none",
      };
      if (end) phase.end_date = end;

      // Preserve a Checkout trial even when a promotion boundary splits it.
      if (originalTrialEnd > start) {
        phase.trial_end = end ? Math.min(originalTrialEnd, end) : originalTrialEnd;
      }
      return phase;
    });

    const updated = await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      proration_behavior: "none",
      metadata: {
        hotelcare_module_promo_schedule: "1",
        hotelcare_promo_config: token,
        organization_slug: settings.organization_slug,
      },
      phases: phases as any,
    });

    return { status: "scheduled", scheduleId: updated.id };
  } catch (error) {
    // If this call created a brand-new schedule and configuring it fails, release
    // only that new schedule. Never release an older working HotelCare schedule.
    if (schedule && createdHere) {
      try {
        await stripe.subscriptionSchedules.release(schedule.id);
      } catch (releaseError) {
        console.error("could not release failed HotelCare promotion schedule", releaseError);
      }
    }
    throw error;
  }
}
