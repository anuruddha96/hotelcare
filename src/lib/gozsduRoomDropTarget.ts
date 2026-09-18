import type { GozsduRoomBucket } from './gozsduRoomBucketOverride';

/** Map only the Gozsdu overview's explicit operational section headings. */
export function gozsduBucketFromHeading(heading: string | null | undefined): GozsduRoomBucket | null {
  switch (heading?.trim()) {
    case 'Checkout Rooms': return 'checkout';
    case 'Second-day service rooms': return 'service';
    case 'Other rooms': return 'other';
    default: return null;
  }
}

/** A drag into the heading area, blank space, or onto an existing chip should
 * all resolve to the same enclosing cleaning section. Non-room sections fail closed. */
export function gozsduDropBucket(target: EventTarget | null): GozsduRoomBucket | null {
  if (!(target instanceof Element)) return null;
  const section = target.closest('section');
  if (!section) return null;
  const heading = section.querySelector(':scope > div:first-child span.text-sm.font-semibold');
  return gozsduBucketFromHeading(heading?.textContent);
}
