export type GoogleBusinessSetupState = {
  blocked: boolean;
  apiDisabled: boolean;
  permissionDenied: boolean;
  quotaPending: boolean;
  projectId: string | null;
  message: string | null;
};

const API_DISABLED = /not enabled|has not been used|it is disabled|service_disabled/i;
const PERMISSION_DENIED = /permission_denied|access was denied|\b403\b/i;
const QUOTA_PENDING = /awaiting google approval|quota exceeded|requests per minute|quota metric|no usable request quota|\b429\b/i;

export function parseGoogleBusinessSetupError(message?: string | null): GoogleBusinessSetupState {
  const value = String(message || "").trim();
  if (!value) {
    return {
      blocked: false,
      apiDisabled: false,
      permissionDenied: false,
      quotaPending: false,
      projectId: null,
      message: null,
    };
  }

  const projectId =
    value.match(/project(?:=|\s+)(\d{6,})/i)?.[1] ||
    value.match(/project_number:(\d{6,})/i)?.[1] ||
    value.match(/[?&]project=(\d{6,})/i)?.[1] ||
    null;
  const apiDisabled = API_DISABLED.test(value);
  const permissionDenied = PERMISSION_DENIED.test(value);
  const quotaPending = QUOTA_PENDING.test(value);

  return {
    blocked: apiDisabled || permissionDenied || quotaPending,
    apiDisabled,
    permissionDenied,
    quotaPending,
    projectId,
    message: value,
  };
}

export const GOOGLE_BUSINESS_REQUIRED_APIS = [
  {
    key: "account-management",
    label: "Account Management API",
    service: "mybusinessaccountmanagement.googleapis.com",
    purpose: "Discover the Google Business accounts available to the connected user.",
  },
  {
    key: "business-information",
    label: "Business Information API",
    service: "mybusinessbusinessinformation.googleapis.com",
    purpose: "Discover the business locations inside those accounts.",
  },
  {
    key: "google-my-business",
    label: "Google My Business API",
    service: "mybusiness.googleapis.com",
    purpose: "Read Google reviews and publish review replies.",
  },
] as const;

export function googleApiConsoleUrl(service: string, projectId: string) {
  return `https://console.developers.google.com/apis/api/${service}/overview?project=${encodeURIComponent(projectId)}`;
}
