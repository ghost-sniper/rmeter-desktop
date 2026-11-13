import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

// Intentionally sequential: parallel builds or benchmarks distort comparisons.
const root = resolve(import.meta.dir, "..");
const stage = Bun.argv[2];
const output = resolve(
  Bun.argv[3] || join(root, ".cache", "profile-benchmark"),
);
if (!["build", "run"].includes(stage))
  throw Error(
    "Usage: bun scripts/benchmark-build-profiles.ts <build|run> [output-directory]",
  );
const variants = [
  { name: "fat-1", lto: "fat", units: 1 },
  { name: "thin-16", lto: "thin", units: 16 },
  { name: "thin-8", lto: "thin", units: 8 },
];
const manifest = Bun.TOML.parse(
  await Bun.file(join(root, "src-tauri/Cargo.toml")).text(),
) as any;
const rev = manifest.dependencies.rmeter.rev;
const host = Bun.spawnSync(["rustc", "--print", "host-tuple"], { cwd: root });
if (host.exitCode) throw Error(host.stderr.toString());
const target = host.stdout.toString().trim();
const suffix = target.includes("windows") ? ".exe" : "";
const worker = join(
  root,
  ".cache",
  "worker",
  rev,
  target,
  "bin",
  `rmeter-js-worker${suffix}`,
);
if (!existsSync(worker))
  throw Error("Run bun run prepare:worker before benchmarking");
const workerHash = createHash("sha256")
  .update(readFileSync(worker))
  .digest("hex");
mkdirSync(output, { recursive: true });

async function command(
  args: string[],
  env: Record<string, string | undefined>,
  log: string,
) {
  const start = performance.now();
  const file = Bun.file(join(output, log));
  const child = Bun.spawn(args, {
    cwd: root,
    env: { ...Bun.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const writer = file.writer();
  async function drain(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
    }
  }
  const [exitCode] = await Promise.all([
    child.exited,
    drain(child.stdout),
    drain(child.stderr),
  ]);
  await writer.end();
  const seconds = (performance.now() - start) / 1000;
  if (exitCode !== 0)
    throw Error(`${args.join(" ")} failed (${exitCode}); see ${file.name}`);
  return seconds;
}

const buildsPath = join(output, "builds.json");
if (stage === "build") {
  if (
    existsSync(buildsPath) ||
    variants.some((v) => existsSync(join(output, v.name, "target")))
  ) {
    throw Error(
      "Use a new output directory for cold-build measurements; existing results are preserved",
    );
  }
  const results: any = {
    timestamp: new Date().toISOString(),
    target,
    worker_rev: rev,
    worker_sha256: workerHash,
    rustc: Bun.spawnSync(["rustc", "-Vv"]).stdout.toString().trim(),
    commit: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root })
      .stdout.toString()
      .trim(),
    methodology:
      "One empty-target build and two complete Tauri rebuilds per profile; cached source downloads, offline, fixed O3 worker, no bundles. Harness build excluded from app timings.",
    variants: [],
  };
  for (const variant of variants) {
    const targetDir = join(output, variant.name, "target");
    const env = {
      CARGO_TARGET_DIR: targetDir,
      CARGO_NET_OFFLINE: "true",
      CARGO_INCREMENTAL: "0",
      CARGO_PROFILE_RELEASE_OPT_LEVEL: "3",
      CARGO_PROFILE_RELEASE_LTO: variant.lto,
      CARGO_PROFILE_RELEASE_CODEGEN_UNITS: String(variant.units),
    };
    const result: any = { ...variant, opt_level: 3, rebuild_seconds: [] };
    console.log(`[${variant.name}] cold desktop build starting`);
    result.cold_seconds = await command(
      [
        "bun",
        "run",
        "tauri",
        "build",
        "--no-bundle",
        "--",
        "--locked",
        "--timings",
      ],
      env,
      `${variant.name}-cold.log`,
    );
    result.exe_bytes = statSync(
      join(targetDir, "release", `rmeter-desktop${suffix}`),
    ).size;
    copyFileSync(
      worker,
      join(targetDir, "release", `rmeter-js-worker${suffix}`),
    );
    console.log(
      `[${variant.name}] cold: ${result.cold_seconds.toFixed(2)}s, exe: ${result.exe_bytes} bytes`,
    );
    for (let repeat = 0; repeat < 2; repeat++) {
      const seconds = await command(
        [
          "bun",
          "run",
          "tauri",
          "build",
          "--no-bundle",
          "--",
          "--locked",
          "--timings",
        ],
        env,
        `${variant.name}-rebuild-${repeat + 1}.log`,
      );
      result.rebuild_seconds.push(seconds);
      console.log(
        `[${variant.name}] rebuild ${repeat + 1}: ${seconds.toFixed(2)}s`,
      );
    }
    console.log(`[${variant.name}] building runtime benchmark harness`);
    result.harness_build_seconds = await command(
      [
        "cargo",
        "build",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "--release",
        "--locked",
        "--offline",
        "--example",
        "build-profile-bench",
      ],
      env,
      `${variant.name}-harness.log`,
    );
    results.variants.push(result);
    await Bun.write(buildsPath, JSON.stringify(results, null, 2));
    console.log(`[${variant.name}] complete`);
  }
} else {
  const builds = await Bun.file(buildsPath).json();
  if (builds.worker_sha256 !== workerHash || builds.variants.length !== 3)
    throw Error("Incomplete builds or worker changed");
  const repetitions = Number(Bun.env.BENCH_REPETITIONS || 12);
  const scale = Number(Bun.env.BENCH_SCALE || 1);
  if (!Number.isInteger(repetitions) || repetitions < 3 || repetitions > 30)
    throw Error("Repetitions must be 3..30");
  // Independent fixed Bun HTTP fixture: its compiler settings never vary by Rust profile.
  const body = JSON.stringify({
    id: 42,
    text: "benchmark-payload",
    payload: "x".repeat(1024),
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(body, { headers: { "Content-Type": "application/json" } }),
  });
  const url = `http://127.0.0.1:${server.port}/benchmark`;
  const results: any = {
    timestamp: new Date().toISOString(),
    worker_sha256: workerHash,
    repetitions,
    scale,
    samples: [],
  };
  // Six permutations balance both first/last position and predecessor effects.
  const orders = [
    [0, 1, 2],
    [2, 1, 0],
    [1, 2, 0],
    [0, 2, 1],
    [2, 0, 1],
    [1, 0, 2],
  ];
  try {
    for (let round = -1; round < repetitions; round++) {
      const order = round < 0 ? [0, 1, 2] : orders[round % orders.length];
      for (const index of order) {
        const variant = variants[index];
        const executable = join(
          output,
          variant.name,
          "target",
          "release",
          "examples",
          `build-profile-bench${suffix}`,
        );
        const child = Bun.spawn([executable, url, worker, String(scale)], {
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...Bun.env, RUST_LOG: "error" },
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        if (exitCode !== 0)
          throw Error(`${variant.name}: ${stderr}\n${stdout}`);
        const sample = { variant: variant.name, round, ...JSON.parse(stdout) };
        if (round >= 0) results.samples.push(sample);
        console.log(
          `[runtime ${round < 0 ? "warmup" : round + 1}] ${variant.name}: ${sample.cases.map((c: any) => `${c.name}=${c.seconds.toFixed(3)}s`).join(", ")}`,
        );
        await Bun.write(
          join(output, "runtime.json"),
          JSON.stringify(results, null, 2),
        );
        await Bun.sleep(1000);
      }
    }
  } finally {
    await server.stop(true);
  }
}
