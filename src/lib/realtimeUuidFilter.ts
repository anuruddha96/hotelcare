/** Prevent Supabase Realtime SQLSTATE 22P02 from 'null' UUID filters. */
export const isValidRealtimeUuid = (id: unknown): id is string =>
  typeof id === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
