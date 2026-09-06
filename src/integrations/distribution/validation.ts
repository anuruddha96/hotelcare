import type { AriUpdate } from "./types";

export interface DistributionValidationResult {
  valid: boolean;
  errors: string[];
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidIsoDate = (value: string): boolean => {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const validateAriUpdate = (
  update: AriUpdate,
): DistributionValidationResult => {
  const errors: string[] = [];

  if (!update.hotelId) errors.push("hotelId is required");
  if (!update.roomTypeId) errors.push("roomTypeId is required");

  if (!isValidIsoDate(update.startDate)) {
    errors.push("startDate must be a valid YYYY-MM-DD date");
  }

  if (update.endDate) {
    if (!isValidIsoDate(update.endDate)) {
      errors.push("endDate must be a valid YYYY-MM-DD date");
    } else if (
      isValidIsoDate(update.startDate) &&
      update.endDate < update.startDate
    ) {
      errors.push("endDate cannot be before startDate");
    }
  }

  const hasRestrictionChange = Boolean(
    update.restrictions && Object.keys(update.restrictions).length,
  );
  const hasMutation =
    update.price !== undefined ||
    update.inventory !== undefined ||
    hasRestrictionChange;

  if (!hasMutation) {
    errors.push("ARI update must change price, inventory or restrictions");
  }

  if (update.price !== undefined) {
    if (!Number.isFinite(update.price) || update.price < 0) {
      errors.push("price must be a non-negative number");
    }
    if (!update.currency || !/^[A-Z]{3}$/.test(update.currency)) {
      errors.push("currency must be a 3-letter uppercase ISO currency when price is set");
    }
  }

  if (
    update.inventory !== undefined &&
    (!Number.isInteger(update.inventory) || update.inventory < 0)
  ) {
    errors.push("inventory must be a non-negative integer");
  }

  if (update.restrictions?.minStay !== undefined) {
    if (
      !Number.isInteger(update.restrictions.minStay) ||
      update.restrictions.minStay < 1
    ) {
      errors.push("minStay must be a positive integer");
    }
  }

  if (update.restrictions?.maxStay !== undefined) {
    if (
      !Number.isInteger(update.restrictions.maxStay) ||
      update.restrictions.maxStay < 1
    ) {
      errors.push("maxStay must be a positive integer");
    }
  }

  if (
    update.restrictions?.minStay !== undefined &&
    update.restrictions?.maxStay !== undefined &&
    update.restrictions.maxStay < update.restrictions.minStay
  ) {
    errors.push("maxStay cannot be lower than minStay");
  }

  return { valid: errors.length === 0, errors };
};

export const assertValidAriUpdate = (update: AriUpdate): void => {
  const result = validateAriUpdate(update);
  if (!result.valid) {
    throw new Error(`Invalid ARI update: ${result.errors.join("; ")}`);
  }
};
