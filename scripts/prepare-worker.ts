import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = "https://github.com/ghost-sniper/rmeter.git";
const tag = "v0.1.0";
const root = resolve(import.meta.dir, "..");
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
const cache = join(root, ".cache", "worker", tag, target);
const binary = join(cache, "bin", `rmeter-js-worker${extension}`);
if (!existsSync(binary) || Bun.argv.includes("--force")) {
  await run([
    "cargo",
    "install",
    "--git",
    repo,
    "--tag",
    tag,
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
console.log(`rmeter ${tag} worker 已准备：${target}`);
