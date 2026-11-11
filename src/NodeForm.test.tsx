import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import NodeForm, { Drafts } from "./NodeForm";
import { EditorNode, componentKinds, createNode, labels } from "./model";

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
it.each(["plan" as const, ...componentKinds])(
  "allows naming and toggling the %s component",
  (kind) => {
    render(<Harness initial={createNode(kind)} />);
    const name = screen.getByLabelText(/^名称/);
    expect(name).toHaveValue(labels[kind]);
    fireEvent.change(name, { target: { value: `自定义 ${labels[kind]}` } });
    expect(JSON.parse(screen.getByTestId("data").textContent!).name).toBe(
      `自定义 ${labels[kind]}`,
    );
    const enabled = screen.getByRole("checkbox", { name: "启用组件" });
    expect(enabled).toBeChecked();
    fireEvent.click(enabled);
    expect(JSON.parse(screen.getByTestId("data").textContent!).enabled).toBe(
      false,
    );
    fireEvent.click(enabled);
    expect(JSON.parse(screen.getByTestId("data").textContent!).enabled).toBe(
      true,
    );
  },
);

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

it.each(["JSONPath 断言", "XPath 断言", "正则表达式断言"])(
  "retains %s configuration while toggling execution",
  (label) => {
    render(<Harness initial={createNode("http_request")} />);
    fireEvent.click(screen.getByRole("button", { name: `＋ 添加${label}` }));
    const initial = JSON.parse(screen.getByTestId("data").textContent!)
      .assertions[0];
    fireEvent.click(screen.getByRole("checkbox", { name: "启用断言 1" }));
    expect(
      JSON.parse(screen.getByTestId("data").textContent!).assertions[0],
    ).toEqual({ ...initial, enabled: false });
    expect(screen.getByRole("region", { name: "断言 1" })).toHaveClass(
      "is-inactive",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "启用断言 1" }));
    expect(
      JSON.parse(screen.getByTestId("data").textContent!).assertions[0],
    ).toEqual({ ...initial, enabled: true });
  },
);

it("configures JDBC array and positional column variables without losing skipped columns", () => {
  const node = createNode("jdbc_request");
  const view = render(<Harness initial={node} />);
  fireEvent.change(screen.getByLabelText("整表结果变量"), {
    target: { value: "rows" },
  });
  fireEvent.change(screen.getByLabelText("按列变量名"), {
    target: { value: "id,,name," },
  });
  expect(screen.getByLabelText("按列变量名")).toHaveValue("id,,name,");
  expect(JSON.parse(screen.getByTestId("data").textContent!)).toMatchObject({
    result_variable: "rows",
    variable_names: ["id", "", "name", ""],
  });
  fireEvent.click(screen.getByRole("button", { name: "重置按列变量名" }));
  const saved = JSON.parse(screen.getByTestId("data").textContent!);
  expect(saved).not.toHaveProperty("variable_names");
  expect(saved.result_variable).toBe("rows");
  view.rerender(<Harness initial={node} disabled />);
  expect(screen.getByLabelText("整表结果变量")).toBeDisabled();
  expect(screen.getByLabelText("按列变量名")).toBeDisabled();
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

it("distinguishes inherited, replaced and explicitly cleared sampler lists", () => {
  render(<Harness initial={createNode("http_request")} />);
  for (const [label, key] of [
    ["请求头", "headers"],
    ["查询参数", "query"],
  ]) {
    const section = within(
      screen.getByRole("heading", { name: label }).closest("section")!,
    );
    expect(section.getByText(/未设置：继承/)).toBeInTheDocument();
    fireEvent.click(section.getByRole("button", { name: "＋ 添加" }));
    fireEvent.change(section.getByLabelText(`${label}名称 1`), {
      target: { value: "own" },
    });
    fireEvent.change(section.getByLabelText(`${label}值 1`), {
      target: { value: "value" },
    });
    expect(section.getByText(/已设置：整组使用/)).toBeInTheDocument();
    expect(
      JSON.parse(screen.getByTestId("data").textContent!).settings[key],
    ).toEqual([["own", "value"]]);
    fireEvent.click(section.getByRole("button", { name: "清空并停止继承" }));
    expect(section.getByText(/已清空：不继承/)).toBeInTheDocument();
    expect(
      JSON.parse(screen.getByTestId("data").textContent!).settings[key],
    ).toEqual([]);
    fireEvent.click(section.getByRole("button", { name: "恢复缺省" }));
    expect(section.getByText(/未设置：继承/)).toBeInTheDocument();
    expect(
      JSON.parse(screen.getByTestId("data").textContent!).settings,
    ).not.toHaveProperty(key);
  }
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

it("edits extractor match numbers, defaults and namespace drafts without losing values", () => {
  const extractor = createNode("xpath2_extractor");
  render(<Harness initial={extractor} />);
  fireEvent.change(screen.getByLabelText("匹配序号"), {
    target: { value: "-1" },
  });
  expect(JSON.parse(screen.getByTestId("data").textContent!).match_number).toBe(
    -1,
  );
  fireEvent.change(screen.getByLabelText("默认值"), {
    target: { value: "fallback" },
  });
  fireEvent.change(screen.getByLabelText("默认值"), { target: { value: "" } });
  expect(
    JSON.parse(screen.getByTestId("data").textContent!).default_value,
  ).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "重置默认值" }));
  expect(
    JSON.parse(screen.getByTestId("data").textContent!),
  ).not.toHaveProperty("default_value");
  fireEvent.change(screen.getByLabelText("命名空间（JSON）"), {
    target: { value: '{"ns":' },
  });
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("命名空间（JSON）"), {
    target: { value: '{"ns":"urn:test"}' },
  });
  expect(
    JSON.parse(screen.getByTestId("data").textContent!).namespaces,
  ).toEqual({ ns: "urn:test" });
});

it("edits gaussian fractional deviation and variable delays while retaining invalid numeric drafts", () => {
  render(<Harness initial={createNode("gaussian_random_timer")} />);
  const deviation = screen.getByLabelText(/偏差（ms）/),
    offset = screen.getByLabelText(/固定延迟偏移/);
  fireEvent.change(deviation, { target: { value: "12.5" } });
  fireEvent.change(offset, { target: { value: "${pause}" } });
  expect(JSON.parse(screen.getByTestId("data").textContent!)).toMatchObject({
    deviation_ms: 12.5,
    offset_ms: "${pause}",
  });
  fireEvent.change(offset, { target: { value: "-1" } });
  expect(offset).toHaveValue("-1");
  expect(screen.getByText(/请输入非负安全整数/)).toBeInTheDocument();
  expect(JSON.parse(screen.getByTestId("data").textContent!).offset_ms).toBe(
    "${pause}",
  );
  fireEvent.change(offset, { target: { value: "0" } });
  expect(JSON.parse(screen.getByTestId("data").textContent!).offset_ms).toBe(0);
});
