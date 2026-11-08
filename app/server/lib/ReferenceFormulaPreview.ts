import { ApiError } from "app/common/ApiError";
import { UserAction } from "app/common/DocActions";
import { ReferenceFormulaImpact } from "app/common/ReferenceSynchronization";
import { DocStorage } from "app/server/lib/DocStorage";
import { ISandbox } from "app/server/lib/ISandbox";
import { assertReferenceSize, assertReferenceTablesSize, REFERENCE_MAX_BYTES } from "app/server/lib/ReferenceLimits";

/** Uses a dedicated sandbox with no request/host exports. Never call the live document's Python engine. */
export async function previewReferenceFormulas(storage: DocStorage, actions: UserAction[],
  create: () => ISandbox, limits = { timeoutMs: 30_000, memoryBytes: 512 * 1024 * 1024, pollMs: 250 }):
Promise<ReferenceFormulaImpact> {
  assertReferenceSize(actions);
  const names = (await storage.getAllTableNames()).filter(n => !n.startsWith("_gristsys_"));
  await assertReferenceTablesSize(storage, names, 500_000);
  const sandbox = create();
  let stopped = false;
  let checkingMemory = false;
  let rejectLimit: (error: Error) => void;
  const exceeded = new Promise<never>((_, reject) => { rejectLimit = reject; });
  const stop = (message: string) => {
    stopped = true;
    rejectLimit(new ApiError(message, 413));
  };
  const deadline = setTimeout(() => stop("REFERENCE_PREVIEW_TIMEOUT"), limits.timeoutMs);
  const memory = setInterval(() => {
    if (checkingMemory || stopped) { return; }
    checkingMemory = true;
    void sandbox.reportMemoryUsage().then((bytes) => {
      // Unknown measurements fail closed: this backend cannot safely offer previews.
      if (!Number.isFinite(bytes) || bytes > limits.memoryBytes) { stop("REFERENCE_PREVIEW_MEMORY_LIMIT"); }
    }, () => stop("REFERENCE_PREVIEW_MEMORY_UNAVAILABLE")).finally(() => { checkingMemory = false; });
  }, limits.pollMs);
  const run = async () => {
    let bytes = 0;
    const load = async (name: string) => {
      if (stopped) { throw new ApiError("REFERENCE_PREVIEW_CANCELLED", 413); }
      const data = names.includes(name) ? await storage.fetchTable(name) : null;
      bytes += data?.length || 0;
      if (bytes > REFERENCE_MAX_BYTES) { throw new ApiError("REFERENCE_SIZE_LIMIT", 413); }
      return data;
    };
    const tables: string[] = await sandbox.pyCall("load_meta_tables",
      await load("_grist_Tables"), await load("_grist_Tables_column"));
    for (const name of tables) { await sandbox.pyCall("load_table", name, await load(name)); }
    return sandbox.pyCall("preview_reference_actions", actions);
  };
  try { return await Promise.race([run(), exceeded]); } finally {
    stopped = true;
    clearTimeout(deadline);
    clearInterval(memory);
    // NSandbox.shutdown kills a stuck computation after its short grace period.
    await sandbox.shutdown();
  }
}
