import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  setTitle: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
  close: undefined as
    ((event: { preventDefault: () => void }) => void) | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mock.invoke,
  isTauri: () => true,
  Channel: class {
    onmessage = () => {};
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mock.open,
  save: mock.save,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTitle: mock.setTitle,
    destroy: mock.destroy,
    onCloseRequested: async (
      handler: (event: { preventDefault: () => void }) => void,
    ) => {
      mock.close = handler;
      return () => {};
    },
  }),
}));
import App from "./App";
import { RunMessage } from "./results";
beforeEach(() => {
  vi.clearAllMocks();
  mock.invoke.mockResolvedValue(undefined);
});
it.each([
  [
    "配置元件",
    ["JDBC 连接配置", "HTTP 默认配置"],
    "HTTP 默认配置",
    "http_defaults",
  ],
  [
    "采样器",
    ["HTTP 采样器", "JDBC 采样器", "JavaScript 采样器"],
    "JDBC 采样器",
    "jdbc_request",
  ],
  [
    "逻辑控制器",
    ["Loop 循环", "While 循环", "IF 条件选择"],
    "While 循环",
    "while",
  ],
] as const)(
  "groups context menu components under %s and adds to the clicked node",
  async (category, members, selected, kind) => {
    mock.save.mockResolvedValue("C:/context-menu.json");
    render(<App />);
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /线程组/ }), {
      clientX: 900,
      clientY: 700,
    });
    const menu = screen.getByRole("menu", { name: "节点操作" });
    for (const label of ["配置元件", "采样器", "逻辑控制器"]) {
      expect(
        within(menu).getByRole("menuitem", { name: label }),
      ).toBeInTheDocument();
    }
    expect(
      within(menu).queryByRole("menuitem", { name: new RegExp(selected) }),
    ).not.toBeInTheDocument();
    fireEvent.mouseEnter(
      within(menu).getByRole("menuitem", { name: category }),
    );
    const submenu = screen.getByRole("menu", { name: category });
    expect(submenu).toHaveClass("open-left");
    expect(within(submenu).getAllByRole("menuitem")).toHaveLength(
      members.length,
    );
    for (const label of members)
      expect(
        within(submenu).getByRole("menuitem", { name: new RegExp(label) }),
      ).toBeInTheDocument();
    fireEvent.click(
      within(submenu).getByRole("menuitem", { name: new RegExp(selected) }),
    );
    expect(
      screen.queryByRole("menu", { name: "节点操作" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^名称/)).toHaveValue(selected);
    fireEvent.click(screen.getByTitle("保存 (Ctrl+S)"));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith(
        "write_script",
        expect.anything(),
      ),
    );
    const source = JSON.parse(
      mock.invoke.mock.calls.find(([command]) => command === "write_script")![1]
        .source,
    );
    expect(source.groups[0].children[0].type).toBe(kind);
  },
);

it("filters context categories for plan and leaf nodes and resets the open submenu", () => {
  render(<App />);
  fireEvent.contextMenu(screen.getByRole("treeitem", { name: /测试计划/ }));
  expect(screen.getByRole("menuitem", { name: /线程组/ })).toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "采样器" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "逻辑控制器" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "配置元件" }));
  const submenu = screen.getByRole("menu", { name: "配置元件" });
  expect(within(submenu).getAllByRole("menuitem")).toHaveLength(1);
  fireEvent.click(
    within(submenu).getByRole("menuitem", { name: /JDBC 连接配置/ }),
  );
  fireEvent.contextMenu(
    screen.getByRole("treeitem", { name: /JDBC 连接配置/ }),
  );
  expect(
    screen.queryByRole("menuitem", { name: "配置元件" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  fireEvent.contextMenu(screen.getByRole("treeitem", { name: /线程组/ }));
  expect(screen.getByRole("menuitem", { name: "配置元件" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("persists own disabled states and shows inherited skipping without changing children", async () => {
  mock.save.mockResolvedValue("C:/disabled.json");
  const view = render(<App />);
  fireEvent.click(screen.getByRole("treeitem", { name: /线程组/ }));
  fireEvent.change(screen.getByLabelText(/添加到/), {
    target: { value: "loop" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "启用组件" }));
  fireEvent.change(screen.getByLabelText(/添加到/), {
    target: { value: "http_request" },
  });
  expect(screen.getByRole("checkbox", { name: "启用组件" })).toBeChecked();
  expect(
    screen.getByRole("treeitem", { name: /HTTP 采样器/ }),
  ).toHaveTextContent("随父节点禁用");
  fireEvent.contextMenu(screen.getByRole("treeitem", { name: /线程组/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "禁用组件" }));
  fireEvent.click(screen.getByTitle("保存 (Ctrl+S)"));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("write_script", expect.anything()),
  );
  const source = mock.invoke.mock.calls.find(
    ([command]) => command === "write_script",
  )![1].source;
  const saved = JSON.parse(source).groups[0];
  expect(saved.enabled).toBe(false);
  expect(saved.children[0].enabled).toBe(false);
  expect(saved.children[0].children[0]).not.toHaveProperty("enabled");
  view.unmount();
  mock.open.mockResolvedValue("C:/disabled.json");
  mock.invoke.mockImplementation(async (command) =>
    command === "read_script" ? source : undefined,
  );
  render(<App />);
  fireEvent.click(screen.getByTitle("打开 (Ctrl+O)"));
  fireEvent.contextMenu(
    await screen.findByRole("treeitem", { name: /线程组.*已禁用/ }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "启用组件" }));
  expect(screen.getByRole("treeitem", { name: /Loop 循环/ })).toHaveClass(
    "is-inactive",
  );
  fireEvent.click(screen.getByRole("treeitem", { name: /Loop 循环/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "启用组件" }));
  expect(screen.getByRole("treeitem", { name: /HTTP 采样器/ })).not.toHaveClass(
    "is-inactive",
  );
});

it("adds HTTP defaults as a group child and saves them as a native configuration component", async () => {
  mock.save.mockResolvedValue("C:/http-defaults.json");
  render(<App />);
  fireEvent.click(screen.getByRole("treeitem", { name: /线程组/ }));
  fireEvent.change(screen.getByLabelText(/添加到/), {
    target: { value: "http_defaults" },
  });
  fireEvent.change(screen.getByLabelText(/^名称/), {
    target: { value: "公共 HTTP 配置" },
  });
  expect(
    screen.getByRole("treeitem", { name: /公共 HTTP 配置/ }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("服务器名称或 IP"), {
    target: { value: "127.0.0.1" },
  });
  fireEvent.change(screen.getByLabelText("端口"), {
    target: { value: "9080" },
  });
  fireEvent.change(screen.getByLabelText("路径"), {
    target: { value: "/examples/query" },
  });
  fireEvent.click(screen.getByRole("treeitem", { name: /线程组/ }));
  fireEvent.change(screen.getByLabelText(/添加到/), {
    target: { value: "http_request" },
  });
  expect(screen.getByLabelText("完整 URL")).toHaveValue("");
  expect(screen.getByLabelText(/添加到/)).toBeDisabled();
  fireEvent.click(screen.getByTitle("保存 (Ctrl+S)"));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("write_script", expect.anything()),
  );
  const source = JSON.parse(
    mock.invoke.mock.calls.find(([command]) => command === "write_script")![1]
      .source,
  );
  expect(source.groups[0].children[0]).toEqual({
    type: "http_defaults",
    name: "公共 HTTP 配置",
    settings: { host: "127.0.0.1", port: 9080, path: "/examples/query" },
  });
  expect(source.groups[0].children[1]).not.toHaveProperty("children");
});
it("saves and reopens named Loop and HTTP defaults nodes with their tree labels", async () => {
  mock.save.mockResolvedValue("C:/names.json");
  const view = render(<App />);
  fireEvent.click(screen.getByRole("treeitem", { name: /线程组/ }));
  fireEvent.change(screen.getByLabelText(/添加到/), {
    target: { value: "loop" },
  });
  fireEvent.change(screen.getByLabelText(/^名称/), {
    target: { value: "重复订单" },
  });
  fireEvent.change(screen.getByLabelText(/添加到/), {
    target: { value: "http_defaults" },
  });
  fireEvent.change(screen.getByLabelText(/^名称/), {
    target: { value: "订单接口默认配置" },
  });
  fireEvent.click(screen.getByRole("treeitem", { name: /重复订单/ }));
  expect(screen.getByLabelText(/^名称/)).toHaveValue("重复订单");
  fireEvent.click(screen.getByTitle("保存 (Ctrl+S)"));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("write_script", expect.anything()),
  );
  const source = mock.invoke.mock.calls.find(
    ([command]) => command === "write_script",
  )![1].source;
  const saved = JSON.parse(source).groups[0].children[0];
  expect(saved.name).toBe("重复订单");
  expect(saved.children[0].name).toBe("订单接口默认配置");
  view.unmount();
  mock.open.mockResolvedValue("C:/names.json");
  mock.invoke.mockImplementation(async (command) =>
    command === "read_script" ? source : undefined,
  );
  render(<App />);
  fireEvent.click(screen.getByTitle("打开 (Ctrl+O)"));
  fireEvent.click(
    await screen.findByRole("treeitem", { name: /订单接口默认配置/ }),
  );
  expect(screen.getByLabelText(/^名称/)).toHaveValue("订单接口默认配置");
  fireEvent.click(screen.getByRole("treeitem", { name: /重复订单/ }));
  expect(screen.getByLabelText(/^名称/)).toHaveValue("重复订单");
  expect(screen.queryByText("此脚本以只读模式打开")).not.toBeInTheDocument();
});
it("adds JDBC configuration under both plan and thread group and saves native scopes", async () => {
  mock.save.mockResolvedValue("C:/jdbc-scopes.json");
  render(<App />);
  fireEvent.change(screen.getByLabelText(/添加到/), {
    target: { value: "jdbc_connection_configuration" },
  });
  fireEvent.change(screen.getByLabelText(/^名称/), {
    target: { value: "全局连接" },
  });
  fireEvent.click(screen.getByRole("treeitem", { name: /线程组/ }));
  fireEvent.change(screen.getByLabelText(/添加到/), {
    target: { value: "jdbc_connection_configuration" },
  });
  fireEvent.change(screen.getByLabelText(/^名称/), {
    target: { value: "组内连接" },
  });
  fireEvent.click(screen.getByTitle("保存 (Ctrl+S)"));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("write_script", expect.anything()),
  );
  const call = mock.invoke.mock.calls.find(
    ([command]) => command === "write_script",
  )!;
  const saved = JSON.parse(call[1].source);
  expect(saved.jdbc_connections[0]).toMatchObject({
    name: "全局连接",
    variable_name: "db",
  });
  expect(saved.jdbc_connections[0]).not.toHaveProperty("type");
  expect(saved.groups[0].children[0]).toMatchObject({
    type: "jdbc_connection_configuration",
    name: "组内连接",
  });
});
it("shows assertion failure details even when HTTP returned 200", async () => {
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === "start_run") {
      args.channel.onmessage({
        run_id: "assertions",
        status: "completed",
        error: null,
        summary: { samples: 1, passed: 0, failed: 1, finished: true },
        events: [
          {
            body_truncated: false,
            event: {
              type: "sample_completed",
              label: "业务响应",
              group_name: "g",
              user_index: 0,
              iteration: 0,
              started_at_ms: 0,
              elapsed_ms: 1,
              success: false,
              response_code: "200",
              response_message: "OK",
              bytes_sent: 0,
              bytes_received: 12,
              response_body: null,
              assertions: [
                {
                  name: "JSON 业务码",
                  success: false,
                  message: 'JSONPath "$.code": expected equals 200; found 400',
                },
                { name: "正文正则", success: true, message: null },
              ],
            },
          },
        ],
      } satisfies RunMessage);
      return "assertions";
    }
  });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /▶\s*运行/ }));
  fireEvent.click(await screen.findByRole("row", { name: /业务响应/ }));
  expect(screen.getByText("1/2 通过")).toBeInTheDocument();
  const details = within(screen.getByRole("region", { name: "断言结果" }));
  expect(details.getByText("× 失败 · JSON 业务码")).toBeInTheDocument();
  expect(details.getByText("✓ 通过 · 正文正则")).toBeInTheDocument();
  expect(
    details.getByText(/expected equals 200; found 400/),
  ).toBeInTheDocument();
  expect(screen.getByRole("contentinfo")).toHaveTextContent("存在失败采样");
});
it("creates a sampler and preserves form edits across node selection", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("treeitem", { name: /线程组/ }));
  fireEvent.change(screen.getByLabelText(/添加到/), {
    target: { value: "http_request" },
  });
  fireEvent.change(screen.getByLabelText("完整 URL"), {
    target: { value: "http://localhost:8123/status" },
  });
  fireEvent.click(screen.getByRole("treeitem", { name: /线程组/ }));
  fireEvent.click(screen.getByRole("treeitem", { name: /HTTP 采样器/ }));
  expect(screen.getByLabelText("完整 URL")).toHaveValue(
    "http://localhost:8123/status",
  );
  expect(screen.getByRole("contentinfo")).toHaveTextContent("有未保存的修改");
});
it("keeps dirty state when saving fails", async () => {
  mock.save.mockResolvedValue("C:/plan.json");
  mock.invoke.mockImplementation(async (command) => {
    if (command === "write_script") throw "磁盘不可写";
  });
  render(<App />);
  fireEvent.change(screen.getByLabelText(/^名称/), {
    target: { value: "修改计划" },
  });
  fireEvent.click(screen.getByTitle("保存 (Ctrl+S)"));
  await screen.findByText("磁盘不可写");
  expect(screen.getByRole("contentinfo")).toHaveTextContent("有未保存的修改");
});
it("opens unsupported script read-only and prevents execution", async () => {
  mock.open.mockResolvedValue("C:/plan.json");
  mock.invoke.mockImplementation(async (command) =>
    command === "read_script"
      ? '{"version":1,"name":"外部计划","groups":[{"name":"g","children":[{"type":"controller","name":"x","children":[]}]}]}'
      : undefined,
  );
  render(<App />);
  fireEvent.click(screen.getByTitle("打开 (Ctrl+O)"));
  await screen.findByText("此脚本以只读模式打开");
  expect(screen.getByRole("button", { name: /▶\s*运行/ })).toBeDisabled();
  expect(screen.getByTitle("保存 (Ctrl+S)")).toBeDisabled();
});
it("cancels new document when dirty prompt is dismissed", async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText(/^名称/), {
    target: { value: "保留修改" },
  });
  fireEvent.click(screen.getByTitle("新建 (Ctrl+N)"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText(/^名称/)).toHaveValue("保留修改");
});

it("handles completion before start command resolves and ignores an old run", async () => {
  const channels: { onmessage: (message: RunMessage) => void }[] = [];
  let resolveStart: (id: string) => void = () => {};
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === "start_run") {
      channels.push(args.channel);
      return await new Promise<string>((resolve) => {
        resolveStart = resolve;
      });
    }
  });
  render(<App />);
  const run = screen.getByRole("button", { name: /▶\s*运行/ });
  fireEvent.click(run);
  await waitFor(() => expect(channels).toHaveLength(1));
  const terminal: RunMessage = {
    run_id: "1",
    status: "completed",
    events: [],
    summary: { samples: 0, passed: 0, failed: 0, finished: true },
    error: null,
  };
  await act(async () => {
    channels[0].onmessage(terminal);
    resolveStart("1");
  });
  expect(run).toBeEnabled();
  expect(screen.getByRole("contentinfo")).toHaveTextContent("已完成");
  fireEvent.click(run);
  await waitFor(() => expect(channels).toHaveLength(2));
  act(() =>
    channels[0].onmessage({ ...terminal, status: "failed", error: "stale" }),
  );
  expect(run).toBeDisabled();
  expect(screen.queryByText("stale")).not.toBeInTheDocument();
  await act(async () => {
    channels[1].onmessage({ ...terminal, run_id: "2" });
    resolveStart("2");
  });
});

it("locks editing during a run and stops using the matching run id", async () => {
  let channel: { onmessage: (message: RunMessage) => void };
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === "start_run") {
      channel = args.channel;
      return "42";
    }
    if (command === "stop_run") {
      channel.onmessage({
        run_id: "42",
        status: "cancelled",
        events: [],
        summary: { samples: 0, passed: 0, failed: 0, finished: false },
        error: null,
      });
    }
  });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /▶\s*运行/ }));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("start_run", expect.anything()),
  );
  expect(screen.getByLabelText(/^名称/)).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "启用组件" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /■\s*停止/ }));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("stop_run", { runId: "42" }),
  );
  expect(screen.getByLabelText(/^名称/)).toBeEnabled();
  expect(screen.getByRole("contentinfo")).toHaveTextContent("已停止");
});

it("can stop, save dirty changes, and close in one flow", async () => {
  let channel: { onmessage: (message: RunMessage) => void };
  mock.save.mockResolvedValue("C:/saved.json");
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === "start_run") {
      channel = args.channel;
      return "close-run";
    }
    if (command === "stop_run")
      channel.onmessage({
        run_id: "close-run",
        status: "cancelled",
        events: [],
        summary: { samples: 0, passed: 0, failed: 0, finished: false },
        error: null,
      });
  });
  render(<App />);
  fireEvent.change(screen.getByLabelText(/^名称/), {
    target: { value: "关闭前保存" },
  });
  fireEvent.click(screen.getByRole("button", { name: /▶\s*运行/ }));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("start_run", expect.anything()),
  );
  act(() => mock.close?.({ preventDefault: () => {} }));
  fireEvent.click(await screen.findByRole("button", { name: "停止并关闭" }));
  const dialog = await screen.findByRole("dialog", {
    name: "当前测试计划有未保存的修改。",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() => expect(mock.destroy).toHaveBeenCalledOnce());
  expect(mock.invoke).toHaveBeenCalledWith("write_script", {
    path: "C:/saved.json",
    source: expect.stringContaining("关闭前保存"),
  });
});
