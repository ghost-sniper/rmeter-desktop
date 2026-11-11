import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import NodeForm, { Drafts } from "./NodeForm";
import { EditorNode, createNode } from "./model";

function Harness({ initial }: { initial: EditorNode }) {
  const [node, setNode] = useState(initial),
    [drafts, setDrafts] = useState<Drafts>({});
  return (
    <>
      <NodeForm
        node={node}
        disabled={false}
        drafts={drafts}
        setDraft={(key, draft) =>
          setDrafts((current) => {
            const next = { ...current };
            if (draft) next[key] = draft;
            else delete next[key];
            return next;
          })
        }
        onChange={(data) => setNode({ ...node, data })}
      />
      <output data-testid="data">{JSON.stringify(node.data)}</output>
    </>
  );
}
it("retains invalid JSON draft and commits it after correction", () => {
  render(<Harness initial={createNode("jdbc_request")} />);
  const input = screen.getByLabelText("参数（JSON 数组）");
  fireEvent.change(input, { target: { value: "[bad" } });
  expect(input).toHaveValue("[bad");
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(
    JSON.parse(screen.getByTestId("data").textContent!).parameters,
  ).toEqual([]);
  fireEvent.change(input, { target: { value: '[42,"${id}"]' } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    JSON.parse(screen.getByTestId("data").textContent!).parameters,
  ).toEqual([42, "${id}"]);
});
it("distinguishes a null timeout from removing the field", () => {
  render(<Harness initial={createNode("http_request")} />);
  fireEvent.change(screen.getByLabelText("连接超时（ms）"), {
    target: { value: "null" },
  });
  expect(
    JSON.parse(screen.getByTestId("data").textContent!).settings
      .connect_timeout_ms,
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重置连接超时（ms）" }));
  expect(
    JSON.parse(screen.getByTestId("data").textContent!).settings,
  ).not.toHaveProperty("connect_timeout_ms");
});
it("edits duplicate headers independently", () => {
  const node = createNode("http_request");
  node.data.settings = {
    headers: [
      ["X-Test", "a"],
      ["X-Test", "b"],
    ],
  };
  render(<Harness initial={node} />);
  fireEvent.change(screen.getByLabelText("请求头值 2"), {
    target: { value: "c" },
  });
  expect(
    JSON.parse(screen.getByTestId("data").textContent!).settings.headers,
  ).toEqual([
    ["X-Test", "a"],
    ["X-Test", "c"],
  ]);
});

it("adds variables without overwriting an existing generated name", () => {
  const node = createNode("plan");
  node.data.variables = { variable2: "keep" };
  render(<Harness initial={node} />);
  fireEvent.click(screen.getAllByRole("button", { name: "＋ 添加" })[0]);
  expect(JSON.parse(screen.getByTestId("data").textContent!).variables).toEqual(
    { variable2: "keep", variable3: "" },
  );
});
