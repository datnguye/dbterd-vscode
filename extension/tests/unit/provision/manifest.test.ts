import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isProvisioned,
  writeManifest,
  type InstallManifest,
} from "@/provision/manifest";

const expected: InstallManifest = {
  extensionVersion: "1.2.3",
  basePythonVersion: "Python 3.11.0",
  serverWheelName: "server:42",
};

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dbterd-test-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeVenvPython(): string {
  const p = path.join(tmp, "python");
  fs.writeFileSync(p, "#!/usr/bin/env python3\n");
  return p;
}

describe("isProvisioned", () => {
  it("returns false when venv python doesn't exist", async () => {
    const sentinel = path.join(tmp, "manifest.json");
    await writeManifest(sentinel, expected);
    expect(await isProvisioned(sentinel, path.join(tmp, "missing"), expected)).toBe(false);
  });

  it("returns false when sentinel doesn't exist", async () => {
    expect(await isProvisioned(path.join(tmp, "missing"), makeVenvPython(), expected)).toBe(false);
  });

  it("returns true when manifest matches", async () => {
    const sentinel = path.join(tmp, "manifest.json");
    await writeManifest(sentinel, expected);
    expect(await isProvisioned(sentinel, makeVenvPython(), expected)).toBe(true);
  });

  it("returns false when extension version differs", async () => {
    const sentinel = path.join(tmp, "manifest.json");
    await writeManifest(sentinel, { ...expected, extensionVersion: "9.9.9" });
    expect(await isProvisioned(sentinel, makeVenvPython(), expected)).toBe(false);
  });

  it("returns false when sentinel is malformed JSON", async () => {
    const sentinel = path.join(tmp, "manifest.json");
    fs.writeFileSync(sentinel, "{not valid json");
    expect(await isProvisioned(sentinel, makeVenvPython(), expected)).toBe(false);
  });

  it("returns false when sentinel is missing required fields", async () => {
    const sentinel = path.join(tmp, "manifest.json");
    fs.writeFileSync(sentinel, JSON.stringify({ foo: "bar" }));
    expect(await isProvisioned(sentinel, makeVenvPython(), expected)).toBe(false);
  });
});
