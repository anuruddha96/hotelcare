export type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<unknown>;
};

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
