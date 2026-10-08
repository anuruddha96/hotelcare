#!/usr/bin/env node
/**
 * Channex staging READ-ONLY connectivity check.
 *
 * Safe defaults: the endpoint is hard-coded to staging; only GET requests are
 * performed; no guest records, property names, or API keys are ever printed.
 *
 * Usage:
 *   CHANNEX_STAGING_API_KEY=... node scripts/distribution/channex-staging-check.mjs
 *
 * Use your secret manager or a trusted server environment. Never commit a key.
 */
const BASE = 'https://staging.channex.io';
const API_PATH = '/api/v1/properties?pagination[page]=1&pagination[limit]=1';
const key = process.env.CHANNEX_STAGING_API_KEY?.trim();

if (!key) {
  console.error('MISSING_KEY: Set CHANNEX_STAGING_API_KEY in a private server environment.');
  process.exitCode = 2;
} else {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${BASE}${API_PATH}`, {
      method: 'GET',
      headers: { 'user-api-key': key, Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      // Do not print provider raw error bodies: they may include sensitive data.
      console.error(`CHANNEX_STAGING_ERROR: HTTP ${response.status}`);
      process.exitCode = 1;
    } else {
      const result = await response.json();
      if (!result || typeof result !== 'object' || !Array.isArray(result.data)) {
        console.error('CHANNEX_STAGING_ERROR: Unexpected properties response shape.');
        process.exitCode = 1;
      } else {
        console.log('CHANNEX_STAGING_OK: Read-only properties endpoint responded.');
        console.log(`Visible property count: ${Number.isInteger(result.meta?.total) ? result.meta.total : 'not supplied'}`);
        console.log('No OTA rates, availability or bookings were changed.');
      }
    }
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'request timed out' : 'network or request failure';
    console.error(`CHANNEX_STAGING_ERROR: ${reason}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}
