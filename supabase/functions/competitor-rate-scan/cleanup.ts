export type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<unknown>;
};

/**
 * A scan worker is bounded to 90 seconds, so a row that is still `running`
 * after this grace period cannot represent live work. Keep the cutoff pure so
 * it is easy to test and use the database clock supplied by the caller.
 */
export function staleScanCutoffIso(now: Date, graceMinutes = 15): string {
  const minutes = Number.isFinite(graceMinutes) && graceMinutes > 0
    ? graceMinutes
    : 15;
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

/**
 * Cleanup and pause RPCs are best-effort. A lease-release failure must never
 * replace the scanner error that triggered cleanup.
 */
export async function ignoreRpcFailure(
  client: RpcClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    await client.rpc(fn, args);
  } catch {
    // The caller keeps the original scanner result/error.
  }
}
