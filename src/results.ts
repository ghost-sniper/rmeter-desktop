export interface Summary {
  samples: number;
  passed: number;
  failed: number;
  finished: boolean;
}
export interface AssertionResult {
  name: string;
  success: boolean;
  message: string | null;
}
export interface Sample {
  type: "sample_completed";
  group_name: string;
  user_index: number;
  iteration: number;
  label: string;
  started_at_ms: number;
  elapsed_ms: number;
  success: boolean;
  response_code: string | null;
  response_message: string | null;
  bytes_sent: number;
  bytes_received: number;
  response_body: number[] | null;
  assertions: AssertionResult[];
}
export type ReportEvent =
  Sample | { type: "started" | "finished"; at_ms: number };
export interface Preview {
  event: ReportEvent;
  body_truncated: boolean;
}
export interface RunMessage {
  run_id: string;
  status: "running" | "completed" | "cancelled" | "failed";
  events: Preview[];
  summary: Summary;
  error: string | null;
}
export interface Row {
  id: number;
  sample: Sample;
  truncated: boolean;
}
export interface Results {
  rows: Row[];
  summary: Summary;
  sequence: number;
}
export const emptyResults = (): Results => ({
  rows: [],
  summary: { samples: 0, passed: 0, failed: 0, finished: false },
  sequence: 0,
});
export function receiveResults(state: Results, message: RunMessage): Results {
  let sequence = state.sequence;
  let rows = [
    ...state.rows,
    ...message.events.flatMap((p) =>
      p.event.type === "sample_completed"
        ? [{ id: ++sequence, sample: p.event, truncated: p.body_truncated }]
        : [],
    ),
  ].slice(-1000);
  // Keep the newest previews, release old payloads without losing row metadata.
  let bytes = 0;
  rows = rows
    .reverse()
    .map((row) => {
      const size = row.sample.response_body?.length ?? 0;
      bytes += size;
      return bytes > 16 * 1024 * 1024 && size
        ? {
            ...row,
            sample: { ...row.sample, response_body: null },
            truncated: true,
          }
        : row;
    })
    .reverse();
  return { rows, sequence, summary: message.summary };
}
