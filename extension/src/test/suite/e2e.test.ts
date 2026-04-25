import { spawnSync } from "child_process";
import * as http from "http";
import * as path from "path";
import * as assert from "assert";

import * as vscode from "vscode";

import type { DbterdExtensionApi } from "../../extension";

const EXTENSION_ID = "datnguye.dbterd-vscode";
const FIXTURE_PATH = path.resolve(__dirname, "../../../src/test/fixtures/jaffle-shop");

// The extension spawns `python -m dbterd_server`. If neither Python nor the
// server module is available in the current environment we skip with a
// clear message — the test is about the extension host contract, not env setup.
function resolvePythonWithServer(): string | undefined {
  const candidates = [process.env.DBTERD_TEST_PYTHON, "python3", "python"].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-c", "import dbterd_server"], {
      encoding: "utf-8",
    });
    if (result.status === 0) return candidate;
  }
  return undefined;
}

interface HttpResponse {
  status: number;
  body: string;
}

function httpGet(url: string, timeoutMs = 5_000): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8"),
        }),
      );
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout fetching ${url}`)));
  });
}

// The server prints DBTERD_READY before uvicorn binds its socket — a small
// gap exists between "extension has a URL" and "server accepts connections".
// Production masks this because the React app's first /erd fetch lands after
// React's own render tick. Retry briefly so the test reflects real-world
// behaviour instead of a race condition.
async function httpGetWithRetry(url: string, totalTimeoutMs = 10_000): Promise<HttpResponse> {
  const deadline = Date.now() + totalTimeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await httpGet(url, 2_000);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`failed to GET ${url}: ${String(lastErr)}`);
}

async function waitForErdTab(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .some((t) => t.label === "dbt ERD");
    if (found) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

suite("dbterd extension end-to-end", () => {
  let python: string | undefined;
  let api: DbterdExtensionApi | undefined;

  suiteSetup(async function () {
    python = resolvePythonWithServer();
    if (!python) {
      console.warn(
        "[e2e] skipping: no Python interpreter with dbterd_server importable. " +
          "Run `task install:server` and set DBTERD_TEST_PYTHON to its venv python.",
      );
      this.skip();
      return;
    }

    const config = vscode.workspace.getConfiguration("dbterd");
    await config.update(
      "dbtProjectPath",
      FIXTURE_PATH,
      vscode.ConfigurationTarget.Workspace,
    );
    await config.update("pythonPath", python, vscode.ConfigurationTarget.Workspace);
    await config.update("serverPort", 0, vscode.ConfigurationTarget.Workspace);

    const ext = vscode.extensions.getExtension<DbterdExtensionApi>(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    api = await ext.activate();
  });

  test("registers its contributed commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("dbterd.openErd"), "dbterd.openErd not registered");
    assert.ok(commands.includes("dbterd.refresh"), "dbterd.refresh not registered");
  });

  test("dbterd.openErd spawns the server and opens a webview", async () => {
    await vscode.commands.executeCommand("dbterd.openErd");

    assert.ok(await waitForErdTab(20_000), "ERD webview tab was not opened within 20s");
    assert.ok(api, "extension API not captured in suiteSetup");
    assert.ok(api.hasPanel(), "extension reports no active panel");

    const serverUrl = api.getServerUrl();
    assert.ok(serverUrl, "extension reports no server URL");
    assert.match(serverUrl, /^http:\/\/127\.0\.0\.1:\d+$/, `unexpected server URL: ${serverUrl}`);
  });

  test("the spawned server responds on /healthz and /erd", async () => {
    assert.ok(api, "extension API missing");
    const serverUrl = api.getServerUrl();
    assert.ok(serverUrl, "server URL missing — did dbterd.openErd test run first?");

    const health = await httpGetWithRetry(`${serverUrl}/healthz`);
    assert.strictEqual(health.status, 200);
    const healthBody = JSON.parse(health.body) as Record<string, unknown>;
    assert.strictEqual(healthBody.status, "ok");
    assert.strictEqual(typeof healthBody.version, "string");
    assert.strictEqual(typeof healthBody.project_path_configured, "boolean");

    const erd = await httpGet(`${serverUrl}/erd`);
    assert.strictEqual(erd.status, 200, `GET /erd returned ${erd.status}: ${erd.body}`);
    const payload = JSON.parse(erd.body) as Record<string, unknown>;
    assert.ok(Array.isArray(payload.nodes), "payload.nodes must be an array");
    assert.ok(Array.isArray(payload.edges), "payload.edges must be an array");
    const metadata = payload.metadata as Record<string, unknown>;
    assert.ok(metadata, "payload.metadata must be present");
    assert.strictEqual(
      typeof metadata.generated_at,
      "string",
      "metadata.generated_at must be a string",
    );
    assert.strictEqual(
      typeof metadata.dbt_project_name,
      "string",
      "metadata.dbt_project_name must be a string",
    );
  });

  test("dbterd.refresh does not throw when a panel is open", async () => {
    await vscode.commands.executeCommand("dbterd.refresh");
  });
});
