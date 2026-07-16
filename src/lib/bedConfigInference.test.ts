import { describe, it, expect } from "vitest";
import { inferBedConfigFromNote } from "./bedConfigInference";

describe("inferBedConfigFromNote", () => {
  it("returns null for empty/nullish notes", () => {
    expect(inferBedConfigFromNote("")).toBeNull();
    expect(inferBedConfigFromNote(null)).toBeNull();
    expect(inferBedConfigFromNote(undefined)).toBeNull();
    expect(inferBedConfigFromNote("   ")).toBeNull();
  });

  it("returns null for unrelated notes", () => {
    expect(inferBedConfigFromNote("late check-in requested")).toBeNull();
    expect(inferBedConfigFromNote("please leave extra towels")).toBeNull();
  });

  it("detects separated twin bed requests", () => {
    expect(inferBedConfigFromNote("Separate beds")?.value).toBe("Twin Beds Separated");
    expect(inferBedConfigFromNote("please prepare beds separated")?.value).toBe(
      "Twin Beds Separated",
    );
    expect(inferBedConfigFromNote("Letti separati")?.value).toBe("Twin Beds Separated");
  });

  it("detects twin beds", () => {
    expect(inferBedConfigFromNote("Twin beds please")?.value).toBe("Twin Beds");
    expect(inferBedConfigFromNote("single beds")?.value).toBe("Twin Beds");
    expect(inferBedConfigFromNote("2 singles")?.value).toBe("Twin Beds");
  });

  it("detects single bed", () => {
    expect(inferBedConfigFromNote("single bed only")?.value).toBe("Single Bed");
  });

  it("detects double bed variants", () => {
    expect(inferBedConfigFromNote("double bed")?.value).toBe("Double Bed");
    expect(inferBedConfigFromNote("king")?.value).toBe("Double Bed");
    expect(inferBedConfigFromNote("Matrimoniale richiesto")?.value).toBe("Double Bed");
  });

  it("detects baby bed / crib", () => {
    expect(inferBedConfigFromNote("baby bed needed")?.value).toBe("Baby Bed");
    expect(inferBedConfigFromNote("please add a crib")?.value).toBe("Baby Bed");
  });

  it("detects extra cot before baby cot", () => {
    expect(inferBedConfigFromNote("extra cot for third guest")?.value).toBe(
      "Extra Cot Added",
    );
    expect(inferBedConfigFromNote("rollaway please")?.value).toBe("Extra Cot Added");
  });

  it("prefers separated over plain twin", () => {
    expect(
      inferBedConfigFromNote("twin beds separated for couple")?.value,
    ).toBe("Twin Beds Separated");
  });

  describe("ignores Booking.com policy / capacity boilerplate", () => {
    it("does not match 'haven't added any extra beds'", () => {
      expect(
        inferBedConfigFromNote(
          "You haven't added any extra beds. The maximum number of cots is 1.",
        ),
      ).toBeNull();
    });

    it("does not match 'Children and Extra Bed Policy'", () => {
      expect(
        inferBedConfigFromNote(
          "Children and Extra Bed Policy: children of any age are allowed.",
        ),
      ).toBeNull();
    });

    it("does not match 'maximum number of guests is 2'", () => {
      expect(inferBedConfigFromNote("The maximum number of guests is 2.")).toBeNull();
    });

    it("does not match the ambiguous partner room name 'Deluxe Double or Twin Room'", () => {
      expect(inferBedConfigFromNote("Deluxe Double or Twin Room")).toBeNull();
    });

    it("does not match 'no extra bed'", () => {
      expect(inferBedConfigFromNote("Guest requested no extra bed")).toBeNull();
    });

    it("does not match 'without crib'", () => {
      expect(inferBedConfigFromNote("Room without crib")).toBeNull();
    });
  });
});

