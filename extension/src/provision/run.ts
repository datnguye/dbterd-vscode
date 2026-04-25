import { spawn } from "child_process";

import type { Logger } from "../logging";

export function runStreaming(
  command: string,
  args: string[],
  output: Logger,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout?.on("data", (d: Buffer) => output.append(d.toString()));
    proc.stderr?.on("data", (d: Buffer) => output.append(d.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
