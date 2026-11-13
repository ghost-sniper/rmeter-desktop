import { join, resolve } from "node:path";

const directory = resolve(Bun.argv[2] || ".cache/profile-benchmark");
const builds = await Bun.file(join(directory, "builds.json")).json();
const runtime = await Bun.file(join(directory, "runtime.json")).json();
if (runtime.samples.length !== runtime.repetitions * 3)
  throw Error("Incomplete runtime measurements");
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  return (
    sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low)
  );
}
const median = (values: number[]) => percentile(values, 0.5);
let seed = 123456789;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}
// Paired-by-round bootstrap of the median elapsed-time ratio, not independent
// resampling of profiles. This preserves shared thermal/background drift.
function bootstrap(ratios: number[]) {
  const medians = Array.from({ length: 10000 }, () =>
    median(
      Array.from(
        { length: ratios.length },
        () => ratios[Math.floor(random() * ratios.length)],
      ),
    ),
  );
  return [percentile(medians, 0.025), percentile(medians, 0.975)];
}
const names = runtime.samples[0].cases.map((c: any) => c.name);
const summary: any = {
  builds,
  repetitions: runtime.repetitions,
  scale: runtime.scale,
  runtime: [],
};
for (const name of names) {
  const group: any = { name, variants: [] };
  const baseline = runtime.samples
    .filter((s: any) => s.variant === "fat-1")
    .sort((a: any, b: any) => a.round - b.round)
    .map((s: any) => s.cases.find((c: any) => c.name === name));
  for (const variant of builds.variants) {
    const cases = runtime.samples
      .filter((s: any) => s.variant === variant.name)
      .sort((a: any, b: any) => a.round - b.round)
      .map((s: any) => s.cases.find((c: any) => c.name === name));
    const seconds = cases.map((c: any) => c.seconds);
    const ratios = seconds.map(
      (s: number, i: number) => s / baseline[i].seconds,
    );
    const interval = bootstrap(ratios);
    group.variants.push({
      variant: variant.name,
      median_seconds: median(seconds),
      p25_seconds: percentile(seconds, 0.25),
      p75_seconds: percentile(seconds, 0.75),
      median_operations_per_second: median(
        cases.map((c: any) => c.operations_per_second),
      ),
      elapsed_change_pct: (median(ratios) - 1) * 100,
      elapsed_change_95pct_interval: interval.map((v) => (v - 1) * 100),
      ...(cases[0].p95_ms !== undefined
        ? { median_p95_ms: median(cases.map((c: any) => c.p95_ms)) }
        : {}),
    });
  }
  summary.runtime.push(group);
}
await Bun.write(
  join(directory, "summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
