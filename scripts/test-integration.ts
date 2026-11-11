import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

// The password must come from the invoking process, never from arguments/files.
if (!process.env.RMETER_INTEGRATION_DB_PASSWORD) {
  console.error(
    "请通过进程环境变量 RMETER_INTEGRATION_DB_PASSWORD 提供 ipds_dev 密码。",
  );
  process.exit(1);
}
const root = resolve(import.meta.dir, "..");
const directory = resolve(root, ".cache/integration");
await mkdir(directory, { recursive: true });
const response = await fetch("http://127.0.0.1:9080/viewer/api/catalog", {
  signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw new Error(`Mock catalog HTTP ${response.status}`);
const catalog = await response.json();
await Bun.write(
  resolve(directory, "mock-catalog.json"),
  JSON.stringify(catalog, null, 2),
);
console.log(`Mock Studio catalog generation: ${catalog.generation}`);

const worker = Bun.spawn([process.execPath, "run", "prepare:worker"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
const workerExit = await worker.exited;
if (workerExit !== 0) process.exit(workerExit);

const report = resolve(directory, "all-components-report.json");
await rm(report, { force: true });
const tests = Bun.spawn(
  [
    "cargo",
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--locked",
    "--lib",
    "bridge::integration_tests::mock_jdbc_all_components",
    "--",
    "--ignored",
    "--exact",
    "--nocapture",
  ],
  {
    cwd: root,
    env: { ...process.env, RMETER_INTEGRATION_REPORT: report },
    stdout: "inherit",
    stderr: "inherit",
  },
);
const exitCode = await tests.exited;
if (await Bun.file(report).exists()) console.log(`采样明细：${report}`);
process.exit(exitCode);
