# HotelCare Security Requirements

This document contains mandatory security rules for HotelCare development and operations.

## OAuth / MCP integrations

HotelCare may expose user-scoped data to trusted AI/MCP clients. The following rules are mandatory.

### Dynamic OAuth client registration

**Dynamic OAuth app registration must remain DISABLED by default in production.**

Supabase warns that enabling dynamic registration exposes a public registration endpoint that allows arbitrary clients to register. A malicious party can register an application with a legitimate-looking name and attempt to persuade HotelCare users to authorize it.

Preferred production approach:

1. Pre-register trusted OAuth clients in Supabase Authentication > OAuth Apps whenever the integration supports it.
2. Register exact HTTPS redirect URIs only. Do not use wildcard redirect URIs for OAuth clients.
3. Keep dynamic client registration disabled after a trusted client has been registered.
4. If an MCP client absolutely requires Dynamic Client Registration (DCR), enabling it requires explicit approval from a HotelCare owner/admin and must be treated as a temporary security-sensitive operation.
5. If DCR is temporarily enabled:
   - Record the date, purpose, client name, client ID, and redirect URI.
   - Verify the redirect URI belongs to the intended trusted provider.
   - Complete registration and testing promptly.
   - Disable dynamic registration again as soon as the trusted client has been registered, when technically possible.
   - Review Supabase Authentication > OAuth Apps and remove unexpected or duplicate clients.
6. Never approve an OAuth consent request solely because the displayed application name appears legitimate. Verify the client and redirect destination.

### Authorization and tenant isolation

OAuth authentication must never expand a user's HotelCare permissions.

Every MCP/API operation must enforce the existing HotelCare authorization model, including:

- authenticated `auth.uid()`
- organization / tenant membership
- hotel/property access
- role and module permission
- Row Level Security (RLS) or an equivalent server-side authorization check

A user belonging to one HotelCare organization must never be able to access another organization's data through OAuth, MCP, RPC parameters, guessed hotel IDs, or direct API calls.

Do not rely on frontend visibility or hidden navigation as authorization.

### Service-role keys

Never expose or transmit the Supabase `service_role` key to ChatGPT, MCP clients, browsers, mobile clients, OAuth clients, or third-party integrations.

User-facing MCP requests must run with the authenticated user's token and must preserve HotelCare authorization boundaries.

### MCP permissions

New HotelCare MCP tools should be read-only by default.

Write or destructive tools (rate publishing, automation changes, PMS updates, assignment changes, deletions, etc.) require:

- an explicit server-side role/action permission check
- tenant/property validation
- audit logging
- clear user confirmation before execution where appropriate
- narrowly validated inputs

Do not add write permissions merely because the corresponding user can see the module in the frontend.

### OAuth consent screen

The HotelCare authorization screen must clearly show:

- the requesting client/app name
- the user/account authorizing access
- requested scopes
- the redirect destination when available
- that HotelCare property/organization permissions remain enforced
- a clear Deny/Cancel option

### Monitoring and incident response

Periodically review registered OAuth clients and active integrations. Remove clients that are unknown, obsolete, duplicated, or no longer required.

If an unknown OAuth app is found:

1. disable/revoke the client
2. review affected authorizations and tokens
3. revoke affected sessions/consents as necessary
4. review MCP/API audit records
5. investigate whether any HotelCare data was accessed

## Production principle

For authentication, authorization, billing, revenue publishing, PMS writes, and other high-impact functionality, prefer **least privilege, explicit allow-listing, and reversible changes** over convenience.

When security and convenience conflict, production safety takes priority.
