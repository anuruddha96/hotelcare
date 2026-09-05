const TECHNICAL_MARKER_PATTERN = /\[([A-Z][A-Z0-9_]*(?::[^\]]+)?)\]/g;

type TaggedSegment = {
  tag: string;
  text: string;
};

function cleanDisplayText(value: string): string {
  return value
    .replace(TECHNICAL_MARKER_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTaggedSegments(value: string): TaggedSegment[] {
  const matches = Array.from(value.matchAll(TECHNICAL_MARKER_PATTERN));
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? value.length) : value.length;
    return {
      tag: match[1],
      text: cleanDisplayText(value.slice(start, end)),
    };
  });
}

export function isNoServiceApproval(notes?: string | null): boolean {
  return !!notes?.includes('[NO_SERVICE]');
}

/**
 * Assignment notes double as an internal event trail. The supervisor approval
 * card should show the final operational meaning, not that raw trail.
 *
 * For a No Service completion, the final No Service explanation wins. Hotel
 * Memories' no-board outcome stores an empty [NO_SERVICE] marker followed by a
 * [NO_BOARD_NO_CLEANING] explanation, so that explanation is the fallback.
 * Technical markers are never returned to the UI.
 */
export function getSupervisorApprovalNote(notes?: string | null): string {
  const value = (notes || '').trim();
  if (!value) return '';

  const segments = getTaggedSegments(value);

  if (isNoServiceApproval(value)) {
    const noServiceReasons = segments
      .filter((segment) => segment.tag === 'NO_SERVICE' && segment.text)
      .map((segment) => segment.text);
    if (noServiceReasons.length > 0) {
      return noServiceReasons[noServiceReasons.length - 1];
    }

    const noBoardReasons = segments
      .filter((segment) => segment.tag === 'NO_BOARD_NO_CLEANING' && segment.text)
      .map((segment) => segment.text);
    if (noBoardReasons.length > 0) {
      return noBoardReasons[noBoardReasons.length - 1];
    }

    return 'No service required';
  }

  return cleanDisplayText(value);
}
