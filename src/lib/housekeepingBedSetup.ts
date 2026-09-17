/**
 * Human-readable bed instructions for every hotel's housekeeper cards.
 * Keep the historic database values intact; presentation codes must never be
 * inferred from a hotel's room category or overwrite a manager selection.
 */
export function displayHousekeepingBedSetup(value: string | null | undefined): string | null {
  const original = value?.trim();
  if (!original) return null;

  switch (original.toLowerCase()) {
    case 'twin beds together':
    case 'beds together':
    case 'twin beds': // Existing quick-control compatibility alias.
      return 'BT · Beds together';
    case 'single bed':
    case 'single beds':
    case 'twin beds separated':
    case 'beds separated':
    case 'separate beds':
    case 'separated beds':
      return 'SB · Single beds';
    case 'baby bed':
      return 'Baby bed';
    case 'baby bed out':
    case 'out baby bed':
    case 'remove baby bed':
      return 'Remove baby bed';
    case 'sofa bed':
      return 'Sofa bed';
    case 'extra bed':
      return 'Extra bed';
    default:
      return original;
  }
}
