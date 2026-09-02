import { describe, expect, it } from "vitest";
import { googleApiConsoleUrl, parseGoogleBusinessSetupError } from "./googleBusinessSetup";

describe("parseGoogleBusinessSetupError", () => {
  it("detects the Google API disabled error returned by the live HotelCare integration", () => {
    const state = parseGoogleBusinessSetupError(
      "Google Business Profile API is not enabled for this Google Cloud project: My Business Account Management API has not been used in project 801466430391 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/mybusinessaccountmanagement.googleapis.com/overview?project=801466430391 then retry.",
    );

    expect(state.blocked).toBe(true);
    expect(state.apiDisabled).toBe(true);
    expect(state.permissionDenied).toBe(false);
    expect(state.quotaPending).toBe(false);
    expect(state.projectId).toBe("801466430391");
  });

  it("detects Google approval or zero-quota state after the APIs are enabled", () => {
    const state = parseGoogleBusinessSetupError(
      "Google Business Profile API 429: Quota exceeded for quota metric 'Requests' and limit 'Requests per minute' of service 'mybusinessaccountmanagement.googleapis.com' for consumer 'project_number:801466430391'.",
    );
    expect(state.blocked).toBe(true);
    expect(state.quotaPending).toBe(true);
    expect(state.apiDisabled).toBe(false);
    expect(state.projectId).toBe("801466430391");
  });

  it("detects permission denials without inventing a project id", () => {
    const state = parseGoogleBusinessSetupError("Google Business Profile API access was denied by Google: 403 PERMISSION_DENIED");
    expect(state.blocked).toBe(true);
    expect(state.permissionDenied).toBe(true);
    expect(state.projectId).toBeNull();
  });

  it("returns an unblocked state when there is no connection error", () => {
    expect(parseGoogleBusinessSetupError(null)).toEqual({
      blocked: false,
      apiDisabled: false,
      permissionDenied: false,
      quotaPending: false,
      projectId: null,
      message: null,
    });
  });
});

describe("googleApiConsoleUrl", () => {
  it("targets the exact OAuth client project", () => {
    expect(googleApiConsoleUrl("mybusinessaccountmanagement.googleapis.com", "801466430391")).toBe(
      "https://console.developers.google.com/apis/api/mybusinessaccountmanagement.googleapis.com/overview?project=801466430391",
    );
  });
});
