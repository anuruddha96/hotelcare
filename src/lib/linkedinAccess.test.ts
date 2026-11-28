import { describe, it, expect } from "vitest";
import { canAccessLinkedIn, canAccessLinkedInServer } from "../../supabase/functions/_shared/linkedinAccess";
describe("LinkedIn marketing pilot access", () => {
  const admin = { id:"admin-id", role:"admin", organization_slug:"rdhotels" };
  const pilot = { id:"pilot-id", role:"top_management", nickname:"Anu_000", organization_slug:"rdhotels" };
  it("allows tenant admins and the named pilot", () => {
    expect(canAccessLinkedIn(admin,"rdhotels")).toBe(true);
    expect(canAccessLinkedInServer(admin,"rdhotels","admin-id")).toBe(true);
    expect(canAccessLinkedIn(pilot,"rdhotels")).toBe(true);
    expect(canAccessLinkedInServer(pilot,"rdhotels","pilot-id","pilot-id")).toBe(true);
  });
  it("rejects other roles, narrowed admins and unauthenticated profiles", () => {
    for (const role of ["hr","marketing","top_management","reception","manager","housekeeping","maintenance"]) {
      expect(canAccessLinkedIn({role,organization_slug:"rdhotels"},"rdhotels")).toBe(false);
    }
    expect(canAccessLinkedIn({...admin,access_role:"hr"},"rdhotels")).toBe(false);
    expect(canAccessLinkedIn(null,"rdhotels")).toBe(false);
    expect(canAccessLinkedInServer(pilot,"rdhotels","pilot-id")).toBe(false);
    expect(canAccessLinkedInServer(pilot,"rdhotels","pilot-id","different")).toBe(false);
    expect(canAccessLinkedInServer(pilot,"rdhotels","spoofed","spoofed")).toBe(false);
  });
  it("denies cross-tenant access and pilot lookalikes", () => {
    expect(canAccessLinkedIn(admin,"slnt")).toBe(false);
    expect(canAccessLinkedIn({...pilot,organization_slug:"slnt"},"slnt")).toBe(false);
    expect(canAccessLinkedInServer({...pilot,id:"other-id"},"rdhotels","other-id","pilot-id")).toBe(false);
    expect(canAccessLinkedIn({...pilot,nickname:"anu_001"},"rdhotels")).toBe(false);
  });
});
