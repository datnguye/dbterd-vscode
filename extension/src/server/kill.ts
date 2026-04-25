// Graceful child-process termination: SIGTERM → wait → SIGKILL fallback.
// We await the actual exit so a subsequent spawn doesn't race a pinned port
// the dying child still holds.

import { ChildProcess } from "child_process";

export async function killProcess(proc: ChildProcess, graceMs: number): Promise<void> {
  if (proc.exitCode !== null) return;

  const exited = new Promise<void>((resolve) => {
    if (proc.exitCode !== null) {
      resolve();
      return;
    }
    proc.once("exit", () => resolve());
  });
  proc.kill();
  const timeout = sleep(graceMs).then(() => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  });
  await Promise.race([exited, timeout]);
  // If SIGKILL was needed, wait a bit more for the final exit.
  if (proc.exitCode === null) await exited;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
