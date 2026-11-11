import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const manifest = Bun.TOML.parse(
  await Bun.file(join(root, "src-tauri", "Cargo.toml")).text(),
) as { dependencies: { rmeter: { git: string; rev: string } } };
const { git: repo, rev } = manifest.dependencies.rmeter;
if (!repo || !/^[0-9a-f]{40}$/.test(rev))
  throw Error(
    "rmeter 依赖必须指定 Git 仓库和完整的固定提交，以确保 worker 与核心版本一致。",
  );
async function run(args: string[], capture = false): Promise<string> {
  const process = Bun.spawn(args, {
    cwd: root,
    stdin: "ignore",
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
    env: {
      ...Bun.env,
      CARGO_NET_GIT_FETCH_WITH_CLI: "true",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  const output = capture ? await new Response(process.stdout).text() : "";
  if ((await process.exited) !== 0)
    throw Error(
      `命令失败：${args.join(" ")}。请检查 Rust 工具链与本机 Git 的私有仓库读取权限。`,
    );
  return output.trim();
}
const target =
  Bun.env.TAURI_ENV_TARGET_TRIPLE ||
  (await run(["rustc", "--print", "host-tuple"], true));
const extension = target.includes("windows") ? ".exe" : "";
const cache = join(root, ".cache", "worker", rev, target);
const binary = join(cache, "bin", `rmeter-js-worker${extension}`);
if (!existsSync(binary) || Bun.argv.includes("--force")) {
  await run([
    "cargo",
    "install",
    "--git",
    repo,
    "--rev",
    rev,
    "--locked",
    "--target",
    target,
    "--root",
    cache,
    "--target-dir",
    join(cache, "target"),
    "--bin",
    "rmeter-js-worker",
    "--force",
    "rmeter-component",
  ]);
}
const destination = join(root, "src-tauri", "binaries");
mkdirSync(destination, { recursive: true });
copyFileSync(
  binary,
  join(destination, `rmeter-js-worker-${target}${extension}`),
);
console.log(`rmeter ${rev} worker 已准备：${target}`);
