import { expect, it } from "vitest";
import { RunMessage, Sample, emptyResults, receiveResults } from "./results";
const sample: Sample = {
  type: "sample_completed",
  group_name: "g",
  user_index: 0,
  iteration: 0,
  label: "HTTP",
  started_at_ms: 0,
  elapsed_ms: 1,
  success: true,
  response_code: "200",
  response_message: null,
  bytes_sent: 0,
  bytes_received: 0,
  response_body: null,
  assertions: [],
};
it("limits retained rows while retaining engine totals", () => {
  const message: RunMessage = {
    run_id: "1",
    status: "completed",
    events: Array.from({ length: 1200 }, () => ({
      event: sample,
      body_truncated: false,
    })),
    summary: { samples: 1200, passed: 1200, failed: 0, finished: true },
    error: null,
  };
  const state = receiveResults(emptyResults(), message);
  expect(state.rows).toHaveLength(1000);
  expect(state.rows[0].id).toBe(201);
  expect(state.summary.samples).toBe(1200);
});
it("releases oldest response payloads at 16 MiB without losing metadata", () => {
  const body = Array(64 * 1024).fill(65);
  const message: RunMessage = {
    run_id: "1",
    status: "running",
    events: Array.from({ length: 300 }, () => ({
      event: { ...sample, response_body: body },
      body_truncated: false,
    })),
    summary: { samples: 300, passed: 300, failed: 0, finished: false },
    error: null,
  };
  const state = receiveResults(emptyResults(), message);
  expect(state.rows).toHaveLength(300);
  expect(state.rows[0].truncated).toBe(true);
  expect(state.rows[0].sample.response_body).toBeNull();
  expect(state.rows[299].sample.response_body).toHaveLength(65536);
  expect(
    state.rows.reduce(
      (sum, row) => sum + (row.sample.response_body?.length ?? 0),
      0,
    ),
  ).toBeLessThanOrEqual(16 * 1024 * 1024);
});

it("counts script logs against the shared preview cache and marks released logs", () => {
  const message: RunMessage = {
    run_id: "logs",
    status: "completed",
    error: null,
    summary: { samples: 300, passed: 300, failed: 0, finished: true },
    events: Array.from({ length: 300 }, () => ({
      body_truncated: false,
      event: {
        ...sample,
        script_logs: {
          entries: [
            {
              level: "info",
              source: "pre",
              message: "x".repeat(64 * 1024 - 7),
            },
          ],
          truncated: false,
        },
      },
    })),
  };
  const state = receiveResults(emptyResults(), message);
  expect(state.rows[0].sample.script_logs).toEqual({
    entries: [],
    truncated: true,
  });
  expect(state.rows[299].sample.script_logs?.entries).toHaveLength(1);
  expect(state.summary.samples).toBe(300);
});
