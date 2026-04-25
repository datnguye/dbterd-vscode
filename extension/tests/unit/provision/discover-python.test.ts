import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  discoverBasePython,
  pythonBinary,
  venvBin,
} from "@/provision/discover-python";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dbterd-py-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("venvBin / pythonBinary", () => {
  it("returns the expected names for the host platform", () => {
    if (process.platform === "win32") {
      expect(venvBin()).toBe("Scripts");
      expect(pythonBinary()).toBe("python.exe");
    } else {
      expect(venvBin()).toBe("bin");
      expect(pythonBinary()).toBe("python");
    }
  });
});

describe("discoverBasePython", () => {
  it("uses the override when usable", () => {
    // python3 / python is virtually always on PATH in the dev env.
    const override = "python3";
    expect(discoverBasePython("", override)).toBe(override);
  });

  it("ignores empty override and falls through to PATH", () => {
    const found = discoverBasePython("", "");
    // We can't assert which one; just that we got *some* python.
    expect(found).toBeTruthy();
  });

  it("rejects an unusable override (falls through to PATH)", () => {
    const garbage = path.join(tmp, "definitely-not-python");
    const found = discoverBasePython("", garbage);
    // Should *not* echo back the garbage path.
    expect(found).not.toBe(garbage);
  });

  it("prefers project .venv when it exists", () => {
    if (process.platform === "win32") return; // skip — symlink semantics differ.
    // Stage a fake .venv whose python is a symlink to the host's real python.
    // We can't fabricate a `--version`-responsive binary portably, so reuse
    // whatever's on PATH.
    const venvDir = path.join(tmp, ".venv", venvBin());
    fs.mkdirSync(venvDir, { recursive: true });
    const fake = path.join(venvDir, pythonBinary());
    const realPath = "/usr/bin/python3";
    if (!fs.existsSync(realPath)) return; // can't run on hosts without /usr/bin/python3
    fs.symlinkSync(realPath, fake);
    const found = discoverBasePython(tmp, "");
    expect(found).toBe(fake);
  });
});
