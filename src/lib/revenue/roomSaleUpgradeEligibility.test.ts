import { describe, expect, it } from "vitest";
import { canOfferComplimentaryUpgrade, showOwnLastSoldPrice } from "./roomSaleUpgradeEligibility";

const queen = { pms_room_id: "queen", name: "Queen", guest_levels: [1, 2] };
const quad = { pms_room_id: "quad", name: "Quadruple", guest_levels: [1, 2, 3, 4] };
describe("complimentary upgrade inventory", () => {
  it("allows transferring an existing larger room with real availability", () => {
    expect(canOfferComplimentaryUpgrade(queen, quad, 1, 1)).toBe(true);
    expect(canOfferComplimentaryUpgrade(queen, quad, 2, 2)).toBe(true);
  });
  it("never invents physical stock or allows a smaller substitute", () => {
    expect(canOfferComplimentaryUpgrade(queen, quad, 0, 1)).toBe(false);
    expect(canOfferComplimentaryUpgrade(queen, quad, 1, 2)).toBe(false);
    expect(canOfferComplimentaryUpgrade(quad, queen, 1, 1)).toBe(false);
    expect(canOfferComplimentaryUpgrade(queen, queen, 1, 1)).toBe(false);
  });
  it("requires verified occupancy capabilities and a sellable real room", () => {
    expect(canOfferComplimentaryUpgrade({ ...queen, guest_levels: [] }, quad, 1, 1)).toBe(false);
    expect(canOfferComplimentaryUpgrade(queen, { ...quad, guest_levels: [] }, 1, 1)).toBe(false);
    expect(canOfferComplimentaryUpgrade(queen, { ...quad, is_sellable: false }, 1, 1)).toBe(false);
  });
  it("does not show another type's price on an upgrade-induced sold-out row", () => {
    expect(showOwnLastSoldPrice(0, true)).toBe(false);
    expect(showOwnLastSoldPrice(0, false)).toBe(true);
    expect(showOwnLastSoldPrice(1, false)).toBe(false);
  });
});
