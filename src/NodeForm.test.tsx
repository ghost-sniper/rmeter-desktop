import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import NodeForm, { Drafts } from "./NodeForm";
import { EditorNode, createNode } from "./model";

function Harness({
  initial,
  disabled = false,
}: {
  initial: EditorNode;
  disabled?: boolean;
}) {
  const [node, setNode] = useState(initial),
    [drafts, setDrafts] = useState<Drafts>({});
  return (
    <>
      <NodeForm
        node={node}
        disabled={disabled}
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

it("edits three assertion types and keeps invalid drafts attached when reordering", () => {
  render(<Harness initial={createNode("http_request")} />);
  fireEvent.click(screen.getByRole("button", { name: "＋ 添加JSONPath 断言" }));
  fireEvent.change(screen.getByLabelText("匹配方式"), {
    target: { value: "equals" },
  });
  fireEvent.change(screen.getByLabelText("期望值（JSON） *"), {
    target: { value: '{"code":200}' },
  });
  fireEvent.click(screen.getByRole("button", { name: "＋ 添加XPath 断言" }));
  const xml = within(screen.getByRole("region", { name: "断言 2" }));
  fireEvent.change(xml.getByLabelText("XPath *"), {
    target: { value: "/o:order" },
  });
  fireEvent.change(xml.getByLabelText("命名空间（JSON 映射）"), {
    target: { value: '{"o":"urn:orders"}' },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "＋ 添加正则表达式断言" }),
  );
  fireEvent.change(screen.getByLabelText("正文正则表达式 *"), {
    target: { value: "ERROR" },
  });
  fireEvent.change(screen.getByLabelText("反向匹配（不应匹配）"), {
    target: { value: "true" },
  });
  fireEvent.change(screen.getByLabelText("期望值（JSON） *"), {
    target: { value: "[invalid" },
  });
  fireEvent.click(screen.getByRole("button", { name: "下移断言 1" }));
  expect(
    within(screen.getByRole("region", { name: "断言 2" })).getByLabelText(
      "期望值（JSON） *",
    ),
  ).toHaveValue("[invalid");
  const saved = JSON.parse(screen.getByTestId("data").textContent!).assertions;
  expect(saved[0]).toMatchObject({
    type: "xml",
    xpath: "/o:order",
    namespaces: { o: "urn:orders" },
  });
  expect(saved[1].matcher.expected).toEqual({ code: 200 });
  expect(saved[2]).toMatchObject({
    type: "regex",
    pattern: "ERROR",
    invert: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "删除断言 1" }));
  expect(
    within(screen.getByRole("region", { name: "断言 1" })).getByRole("alert"),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("期望值（JSON） *"), {
    target: { value: "null" },
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    JSON.parse(screen.getByTestId("data").textContent!).assertions[0].matcher
      .expected,
  ).toBeNull();
});

it("clears an incompatible matcher draft and locks assertion controls during execution", () => {
  const node = createNode("jdbc_request");
  node.data.assertions = [
    {
      type: "json",
      name: "rows",
      path: "$.rows",
      matcher: { type: "equals", expected: [] },
    },
  ];
  const view = render(<Harness initial={node} />);
  fireEvent.change(screen.getByLabelText("期望值（JSON） *"), {
    target: { value: "[" },
  });
  fireEvent.change(screen.getByLabelText("匹配方式"), {
    target: { value: "exists" },
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    JSON.parse(screen.getByTestId("data").textContent!).assertions[0].matcher,
  ).toEqual({ type: "exists" });
  view.rerender(<Harness initial={node} disabled />);
  expect(screen.getByLabelText("断言名称 *")).toBeDisabled();
  expect(screen.getByRole("button", { name: "删除断言 1" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "＋ 添加XPath 断言" }),
  ).toBeDisabled();
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
