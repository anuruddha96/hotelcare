import { supabase } from '@/integrations/supabase/client';

/** Add an entry in the same PR as a completed, tested feature and its guide.
 * The published app must also receive approval from the organization's admin. */
export const trainingReleases: ReadonlyArray<{ id: string; curriculum: string }> = [];

export async function claimTrainingPrompt(userId: string, key: string): Promise<boolean> {
  const { data, error } = await supabase.from('training_prompt_receipts')
    .upsert({ user_id: userId, prompt_key: key }, { onConflict: 'user_id,prompt_key', ignoreDuplicates: true })
    .select('prompt_key').maybeSingle();
  return !error && data?.prompt_key === key;
}

export function hasSeenTraining(
  guide: { slug: string; replaces?: string[] },
  statuses: Record<string, { status: string }>,
): boolean {
  return [guide.slug, ...(guide.replaces || [])].some((slug) => statuses[slug]?.status === 'done');
}
