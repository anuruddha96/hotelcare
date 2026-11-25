import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261013195500_fix_maintenance_conflict_postgrest_retry.sql'),
  'utf8',
);

describe('maintenance approval rollback storm regression', () => {
  it('maps stale optimistic-concurrency errors to a non-retryable HTTP 409', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.review_maintenance_completion(');
    expect(migration).toMatch(/USING\s+ERRCODE\s*=\s*'PT409'/i);
  });

  it('never reintroduces SQLSTATE 40001 in the executable migration', () => {
    // Supabase/PostgREST 14 can repeatedly retry custom 40001 exceptions.
    const executableSql = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executableSql).not.toMatch(/(?:ERRCODE\s*=|SQLSTATE\s+)\s*'40001'/i);
  });

  it('preserves ticket ownership, authorization, and concurrency validation', () => {
    expect(migration).toContain('public.can_review_maintenance_for_hotel');
    expect(migration).toContain('v_ticket.updated_at IS DISTINCT FROM p_expected_updated_at');
    expect(migration).toContain("v_ticket.pending_supervisor_approval IS DISTINCT FROM TRUE");
    expect(migration).toContain('INSERT INTO public.comments');
  });
});
