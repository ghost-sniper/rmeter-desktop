import { useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  EditorNode,
  Kind,
  ObjectValue,
  allowed,
  cloneNode,
  componentKinds,
  createNode,
  findNode,
  flatten,
  icons,
  labels,
  moveNode,
  newDocument,
  parentOf,
  parseDocument,
  removeNode,
  reorderNode,
  stringify,
  title,
  updateNode,
} from "./model";
import NodeForm, { Draft, Drafts } from "./NodeForm";
import { RunMessage, emptyResults, receiveResults } from "./results";
import "./App.css";

const filter = [{ name: "rmeter 测试脚本", extensions: ["json"] }];
type RunState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "cancelled"
  | "failed";
const statusLabel: Record<RunState, string> = {
  idle: "就绪",
  starting: "正在校验",
  running: "运行中",
  stopping: "正在停止",
  completed: "已完成",
  cancelled: "已停止",
  failed: "运行失败",
};
interface Prompt {
  message: string;
  choices: string[];
  resolve: (choice: string) => void;
}

export default function App() {
  const [document, setDocument] = useState(newDocument);
  const [selected, setSelected] = useState(document.root.id);
  const [savedSource, setSavedSource] = useState(() =>
    stringify(document.root),
  );
  const [filePath, setFilePath] = useState<string>();
  const [drafts, setDrafts] = useState<Drafts>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [treeWidth, setTreeWidth] = useState(272);
  const [tab, setTab] = useState("form");
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [busy, setBusy] = useState(false);
  const [runState, setRunState] = useState<RunState>("idle");
  const [results, setResults] = useState(emptyResults);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [selectedResult, setSelectedResult] = useState<number>();
  const [menu, setMenu] = useState<string>();
  const [context, setContext] = useState<{
    id: string;
    x: number;
    y: number;
  }>();
  const [moveTarget, setMoveTarget] = useState("");
  const [prompt, setPrompt] = useState<Prompt>();
  const [workerError, setWorkerError] = useState<string>();
  const lock = useRef(false),
    active = useRef(false),
    runId = useRef<string | undefined>(undefined),
    token = useRef<symbol | undefined>(undefined);
  const starting = useRef<Promise<string> | undefined>(undefined);
  const closeHandler = useRef<() => Promise<void>>(async () => {});
  const readonly = document.issues.length > 0;
  const source = useMemo(
    () => (readonly ? document.source : stringify(document.root)),
    [document, readonly],
  );
  const hasDrafts = Object.keys(drafts).length > 0;
  const dirty = !readonly && (source !== savedSource || hasDrafts);
  const running = ["starting", "running", "stopping"].includes(runState);
  const disabled = readonly || busy || running;
  const node = findNode(document.root, selected) ?? document.root;
  const allNodes = useMemo(() => flatten(document.root), [document.root]);
  const parent = parentOf(document.root, node.id);
  const selectedRow = results.rows.find((row) => row.id === selectedResult);
  const ask = (message: string, choices: string[]) =>
    new Promise<string>((resolve) => setPrompt({ message, choices, resolve }));
  const report = (error: unknown) =>
    setNotice({ text: String(error), error: true });
  const desktop = () => {
    if (!isTauri())
      throw Error(
        "此操作需要桌面应用。请使用 bun run tauri dev 启动；浏览器模式仅预览编辑器。",
      );
  };
  const edit = (root: EditorNode) => {
    if (!disabled) setDocument((current) => ({ ...current, root }));
  };
  const setDraft = (key: string, draft?: Draft) =>
    setDrafts((current) => {
      const next = { ...current };
      if (draft) next[key] = draft;
      else delete next[key];
      return next;
    });
  const changeData = (data: ObjectValue) =>
    edit(updateNode(document.root, node.id, (n) => ({ ...n, data })));

  async function saveDocument(as = false): Promise<boolean> {
    if (readonly || active.current || hasDrafts) {
      report("请先修正表单格式，且在可编辑状态下保存。");
      return false;
    }
    try {
      desktop();
      const path =
        !as && filePath
          ? filePath
          : await save({
              title: "保存测试脚本",
              defaultPath: filePath ?? "test-plan.json",
              filters: filter,
            });
      if (!path) return false;
      await invoke("write_script", { path, source });
      setFilePath(path);
      setSavedSource(source);
      setNotice({ text: "测试脚本已保存", error: false });
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }
  async function preserveChanges() {
    if (!dirty) return true;
    const answer = await ask("当前测试计划有未保存的修改。", [
      "保存",
      "不保存",
      "取消",
    ]);
    return answer === "不保存" || (answer === "保存" && (await saveDocument()));
  }
  async function action(work: () => Promise<unknown>) {
    if (lock.current || active.current) return;
    lock.current = true;
    setBusy(true);
    setMenu(undefined);
    try {
      await work();
    } catch (error) {
      report(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function replaceDocument(
    next: ReturnType<typeof newDocument>,
    path?: string,
  ) {
    setDocument(next);
    setSelected(next.root.id);
    setSavedSource(next.issues.length ? next.source : stringify(next.root));
    setFilePath(path);
    setDrafts({});
    setCollapsed(new Set());
    setTab(next.issues.length ? "source" : "form");
    setNotice(undefined);
    setResults(emptyResults());
    setSelectedResult(undefined);
    setRunState("idle");
  }
  const newPlan = () =>
    action(async () => {
      if (await preserveChanges()) replaceDocument(newDocument());
    });
  const openPlan = () =>
    action(async () => {
      desktop();
      if (!(await preserveChanges())) return;
      const path = await open({
        title: "打开 rmeter JSON 脚本",
        multiple: false,
        filters: filter,
      });
      if (typeof path !== "string") return;
      const contents = await invoke<string>("read_script", { path });
      replaceDocument(parseDocument(contents), path);
    });
  const validate = () =>
    action(async () => {
      desktop();
      if (readonly || hasDrafts)
        throw Error("请先修正表单格式，且使用受支持的脚本。");
      await invoke("validate_script", { source });
      setNotice({ text: "校验通过 · 未发送请求或连接数据库", error: false });
    });
  async function start() {
    if (lock.current || active.current || readonly || hasDrafts) return;
    try {
      desktop();
      active.current = true;
      setRunState("starting");
      setResults(emptyResults());
      setSelectedResult(undefined);
      setResultsOpen(true);
      setNotice(undefined);
      setMenu(undefined);
      const currentToken = Symbol();
      token.current = currentToken;
      const channel = new Channel<RunMessage>();
      channel.onmessage = (message) => {
        if (token.current !== currentToken) return;
        runId.current = message.run_id;
        setResults((current) => receiveResults(current, message));
        if (message.status === "running")
          setRunState((current) =>
            current === "stopping" ? current : "running",
          );
        else {
          active.current = false;
          runId.current = undefined;
          setRunState(message.status);
          if (message.error) report(message.error);
        }
      };
      starting.current = invoke<string>("start_run", { source, channel });
      const id = await starting.current;
      if (active.current && token.current === currentToken) runId.current = id;
    } catch (error) {
      active.current = false;
      runId.current = undefined;
      setRunState("failed");
      report(error);
    } finally {
      starting.current = undefined;
    }
  }
  async function stop() {
    if (!active.current) return;
    setRunState("stopping");
    try {
      const id = runId.current ?? (await starting.current);
      if (id) {
        await invoke("stop_run", { runId: id });
        if (runId.current === id) {
          active.current = false;
          runId.current = undefined;
          setRunState((current) =>
            current === "stopping" ? "cancelled" : current,
          );
        }
      }
    } catch (error) {
      report(error);
      setRunState((current) => (current === "stopping" ? "running" : current));
    }
  }
  closeHandler.current = async () => {
    if (lock.current || prompt) return;
    if (active.current) {
      if (
        (await ask("测试正在运行，停止后关闭窗口？", [
          "停止并关闭",
          "取消",
        ])) !== "停止并关闭"
      )
        return;
      await stop();
      if (active.current) return;
    }
    await action(async () => {
      if (await preserveChanges()) await getCurrentWindow().destroy();
    });
  };
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void closeHandler.current();
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else remove = unlisten;
      });
    void invoke("worker_status").catch((error) =>
      setWorkerError(String(error)),
    );
    return () => {
      disposed = true;
      remove?.();
    };
  }, []);
  useEffect(() => {
    if (isTauri())
      void getCurrentWindow()
        .setTitle(`${dirty ? "* " : ""}${title(document.root)} — rmeter`)
        .catch(() => {});
  }, [dirty, document.root.data.name]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (prompt) {
        if (event.key === "Escape") {
          event.preventDefault();
          setPrompt(undefined);
          prompt.resolve(prompt.choices[prompt.choices.length - 1]);
        }
        if (event.key === "Tab") {
          const buttons = Array.from(
            window.document.querySelectorAll<HTMLButtonElement>(
              ".modal button",
            ),
          );
          const index = buttons.indexOf(
            window.document.activeElement as HTMLButtonElement,
          );
          event.preventDefault();
          buttons[
            (index + (event.shiftKey ? -1 : 1) + buttons.length) %
              buttons.length
          ]?.focus();
        }
        return;
      }
      if (event.key === "Escape") {
        setMenu(undefined);
        setContext(undefined);
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (["s", "o", "n"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (event.key.toLowerCase() === "s")
          void action(() => saveDocument(event.shiftKey));
        if (event.key.toLowerCase() === "o") void openPlan();
        if (event.key.toLowerCase() === "n") void newPlan();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  function add(kind: Kind, parentId = node.id) {
    if (disabled) return;
    const target = findNode(document.root, parentId);
    if (!target || !allowed(target.kind, kind)) return;
    const child = createNode(kind);
    edit(
      updateNode(document.root, parentId, (n) => ({
        ...n,
        children: [...n.children, child],
      })),
    );
    setSelected(child.id);
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(parentId);
      return next;
    });
    setContext(undefined);
    setMenu(undefined);
  }
  function duplicate(id = node.id) {
    if (disabled) return;
    const n = findNode(document.root, id),
      p = parentOf(document.root, id);
    if (!n || !p) return;
    const copy = cloneNode(n);
    edit(
      updateNode(document.root, p.id, (current) => {
        const children = [...current.children];
        children.splice(children.findIndex((c) => c.id === id) + 1, 0, copy);
        return { ...current, children };
      }),
    );
    setSelected(copy.id);
    setContext(undefined);
  }
  async function remove(id = node.id) {
    if (disabled) return;
    const n = findNode(document.root, id),
      p = parentOf(document.root, id);
    if (!n || !p) return;
    if (
      (await ask(
        `删除“${title(n)}”${n.children.length ? "及全部子节点" : ""}？`,
        ["删除", "取消"],
      )) !== "删除"
    )
      return;
    edit(removeNode(document.root, id));
    setSelected(p.id);
    const ids = new Set(flatten(n).map((child) => child.id));
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !ids.has(key.split(":")[0])),
      ),
    );
    setContext(undefined);
  }
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const visibleNodes = (n: EditorNode): EditorNode[] => [
    n,
    ...(collapsed.has(n.id) ? [] : n.children.flatMap(visibleNodes)),
  ];
  function tree(n: EditorNode, depth = 0) {
    return (
      <div key={n.id} role="none">
        <div
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={selected === n.id}
          aria-expanded={n.children.length ? !collapsed.has(n.id) : undefined}
          tabIndex={selected === n.id ? 0 : -1}
          className={`tree-row ${selected === n.id ? "selected" : ""}`}
          style={{ paddingLeft: 10 + depth * 18 }}
          onClick={() => {
            setSelected(n.id);
            setMoveTarget("");
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setSelected(n.id);
            setContext({
              id: n.id,
              x: Math.min(e.clientX, window.innerWidth - 230),
              y: Math.min(e.clientY, window.innerHeight - 430),
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Delete") {
              e.preventDefault();
              void remove(n.id);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "d") {
              e.preventDefault();
              duplicate(n.id);
            }
            if (e.key === "ArrowRight" && collapsed.has(n.id)) toggle(n.id);
            if (
              e.key === "ArrowLeft" &&
              !collapsed.has(n.id) &&
              n.children.length
            )
              toggle(n.id);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const list = visibleNodes(document.root);
              const next =
                list[
                  list.findIndex((item) => item.id === n.id) +
                    (e.key === "ArrowDown" ? 1 : -1)
                ];
              if (next) {
                setSelected(next.id);
                requestAnimationFrame(() =>
                  window.document
                    .querySelector<HTMLElement>(`[data-node-id="${next.id}"]`)
                    ?.focus(),
                );
              }
            }
          }}
          data-node-id={n.id}
        >
          <button
            type="button"
            tabIndex={-1}
            className="chevron"
            aria-label={`展开或折叠${title(n)}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(n.id);
            }}
          >
            {n.children.length ? (collapsed.has(n.id) ? "▸" : "▾") : ""}
          </button>
          <span className={`node-icon ${n.kind}`}>{icons[n.kind]}</span>
          <span className="node-title">{title(n)}</span>
          {n.kind === "group" && (
            <span className="tree-count">{n.children.length}</span>
          )}
        </div>
        {!collapsed.has(n.id) && n.children.length > 0 && (
          <div role="group">
            {n.children.map((child) => tree(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }
  const controls = (
    <>
      <button onClick={() => void newPlan()} disabled={busy || running}>
        新建 <kbd>Ctrl N</kbd>
      </button>
      <button onClick={() => void openPlan()} disabled={busy || running}>
        打开… <kbd>Ctrl O</kbd>
      </button>
      <button
        onClick={() => void action(() => saveDocument())}
        disabled={disabled || hasDrafts}
      >
        保存 <kbd>Ctrl S</kbd>
      </button>
      <button
        onClick={() => void action(() => saveDocument(true))}
        disabled={disabled || hasDrafts}
      >
        另存为…
      </button>
    </>
  );
  return (
    <main
      className="app"
      onClick={() => {
        if (menu) setMenu(undefined);
        if (context) setContext(undefined);
      }}
    >
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            r<span>m</span>
          </span>
          <strong>rmeter</strong>
          <span className="version">DESKTOP</span>
        </div>
        <nav aria-label="主菜单">
          {["文件", "编辑", "运行", "帮助"].map((name) => (
            <div className="menu-wrap" key={name}>
              <button
                className={menu === name ? "active" : ""}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === name ? undefined : name);
                }}
              >
                {name}
              </button>
              {menu === name && (
                <div className="dropdown" onClick={(e) => e.stopPropagation()}>
                  {name === "文件" ? (
                    controls
                  ) : name === "编辑" ? (
                    <>
                      <button
                        disabled={disabled || !parent}
                        onClick={() => duplicate()}
                      >
                        复制节点 <kbd>Ctrl D</kbd>
                      </button>
                      <button
                        disabled={disabled || !parent}
                        onClick={() => void remove()}
                      >
                        删除节点 <kbd>Del</kbd>
                      </button>
                    </>
                  ) : name === "运行" ? (
                    <>
                      <button
                        disabled={disabled || hasDrafts}
                        onClick={() => void validate()}
                      >
                        校验脚本
                      </button>
                      <button
                        disabled={disabled || hasDrafts}
                        onClick={() => void start()}
                      >
                        开始运行
                      </button>
                      <button disabled={!running} onClick={() => void stop()}>
                        停止运行
                      </button>
                    </>
                  ) : (
                    <div className="help-text">
                      <strong>rmeter desktop 0.1.0</strong>
                      <p>使用 rmeter v0.1.0 核心。</p>
                      <p>原生 JSON · PostgreSQL · JavaScript</p>
                      <p>
                        仅提供八类基础组件。不支持 JMX、JMeter 函数或完整 JSR223
                        API。
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
        <span className="header-state">
          <span className={`status-dot ${running ? "live" : ""}`} />
          {statusLabel[runState]}
        </span>
      </header>
      <div className="toolbar">
        <div className="toolbar-group">
          <button
            title="新建 (Ctrl+N)"
            disabled={busy || running}
            onClick={() => void newPlan()}
          >
            <span>▤</span>新建
          </button>
          <button
            title="打开 (Ctrl+O)"
            disabled={busy || running}
            onClick={() => void openPlan()}
          >
            <span>▱</span>打开
          </button>
          <button
            title="保存 (Ctrl+S)"
            disabled={disabled || hasDrafts}
            onClick={() => void action(() => saveDocument())}
          >
            <span>▣</span>保存
          </button>
        </div>
        <div className="toolbar-group">
          <button
            disabled={disabled || hasDrafts}
            onClick={() => void validate()}
          >
            <span>✓</span>校验
          </button>
          <button
            className="run-button"
            disabled={disabled || hasDrafts}
            onClick={() => void start()}
          >
            <span>▶</span>运行
          </button>
          <button
            className="stop-button"
            disabled={!running || runState === "stopping"}
            onClick={() => void stop()}
          >
            <span>■</span>停止
          </button>
        </div>
        <div className="toolbar-spacer" />
        <span className="file-label" title={filePath ?? "未保存的测试计划"}>
          {dirty && <span className="dirty-dot">●</span>}
          {filePath?.split(/[\\/]/).pop() ?? "未命名.json"}
          {readonly && " · 只读"}
        </span>
        <button
          className={resultsOpen ? "active" : ""}
          onClick={() => setResultsOpen(!resultsOpen)}
        >
          ▥ 结果
        </button>
      </div>
      {!isTauri() && (
        <div className="preview-banner">
          浏览器预览 · 可编辑脚本；文件与执行功能请使用桌面应用。
        </div>
      )}
      {notice && (
        <div
          className={`notice ${notice.error ? "error" : "success"}`}
          role="status"
        >
          <span>{notice.text}</span>
          <button aria-label="关闭提示" onClick={() => setNotice(undefined)}>
            ×
          </button>
        </div>
      )}
      <div className="workspace">
        <aside className="tree-panel" style={{ width: treeWidth }}>
          <div className="panel-heading">
            <span>测试计划</span>
            <span className="count-badge">{allNodes.length - 1}</span>
            <div className="toolbar-spacer" />
            <button title="展开全部" onClick={() => setCollapsed(new Set())}>
              ⊞
            </button>
          </div>
          <div role="tree" aria-label="测试脚本节点树" className="tree">
            {tree(document.root)}
          </div>
          <div className="tree-tools">
            <label htmlFor="add-component">添加到“{title(node)}”</label>
            <select
              id="add-component"
              disabled={
                disabled || !componentKinds.some((k) => allowed(node.kind, k))
              }
              value=""
              onChange={(e) => add(e.target.value as Kind)}
            >
              <option value="">＋ 添加组件…</option>
              {componentKinds
                .filter((kind) => allowed(node.kind, kind))
                .map((kind) => (
                  <option key={kind} value={kind}>
                    {labels[kind]}
                  </option>
                ))}
            </select>
            <div className="node-actions">
              <button
                title="复制节点"
                disabled={disabled || !parent}
                onClick={() => duplicate()}
              >
                复制
              </button>
              <button
                title="上移"
                disabled={
                  disabled || !parent || parent.children[0].id === node.id
                }
                onClick={() => edit(reorderNode(document.root, node.id, -1))}
              >
                ↑
              </button>
              <button
                title="下移"
                disabled={
                  disabled ||
                  !parent ||
                  parent.children[parent.children.length - 1].id === node.id
                }
                onClick={() => edit(reorderNode(document.root, node.id, 1))}
              >
                ↓
              </button>
              <button
                title="删除节点"
                disabled={disabled || !parent}
                onClick={() => void remove()}
              >
                删除
              </button>
            </div>
            {parent && (
              <div className="move-row">
                <select
                  aria-label="移动到父节点"
                  value={moveTarget}
                  disabled={disabled}
                  onChange={(e) => setMoveTarget(e.target.value)}
                >
                  <option value="">移动到…</option>
                  {allNodes
                    .filter(
                      (n) =>
                        n.id !== parent.id &&
                        allowed(n.kind, node.kind) &&
                        !flatten(node).some((c) => c.id === n.id),
                    )
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {title(n)}
                      </option>
                    ))}
                </select>
                <button
                  disabled={disabled || !moveTarget}
                  onClick={() => {
                    edit(moveNode(document.root, node.id, moveTarget));
                    setCollapsed((current) => {
                      const next = new Set(current);
                      next.delete(moveTarget);
                      return next;
                    });
                    setMoveTarget("");
                  }}
                >
                  移动
                </button>
              </div>
            )}
          </div>
          <div className="tree-foot">
            rmeter 引擎 <span>v0.1.0</span>
          </div>
        </aside>
        <div
          role="separator"
          aria-label="调整节点树宽度"
          aria-orientation="vertical"
          aria-valuenow={treeWidth}
          tabIndex={0}
          className="splitter"
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight"].includes(e.key))
              setTreeWidth((w) =>
                Math.min(
                  480,
                  Math.max(200, w + (e.key === "ArrowRight" ? 16 : -16)),
                ),
              );
          }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              setTreeWidth(Math.max(200, Math.min(480, e.clientX)));
          }}
          onPointerUp={(e) =>
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        />
        <section className="detail-panel">
          <div className="detail-heading">
            <div className={`detail-icon ${node.kind}`}>{icons[node.kind]}</div>
            <div>
              <div className="breadcrumb">
                测试计划{parent && ` / ${labels[node.kind]}`}
              </div>
              <h1>{title(node)}</h1>
            </div>
            <span className="type-tag">{labels[node.kind]}</span>
          </div>
          <div className="tabs">
            <button
              className={tab === "form" ? "selected" : ""}
              disabled={readonly}
              onClick={() => setTab("form")}
            >
              节点配置
            </button>
            <button
              className={tab === "source" ? "selected" : ""}
              onClick={() => setTab("source")}
            >
              脚本预览 <span>JSON</span>
            </button>
            {busy && <span className="working">正在处理…</span>}
            {running && <span className="working">运行期间配置已锁定</span>}
          </div>
          <div className="detail-scroll">
            {readonly && (
              <div className="readonly-notice">
                <strong>此脚本以只读模式打开</strong>
                <p>以下内容超出首版编辑范围，文件将保持原样。</p>
                <ul>
                  {document.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            {node.kind === "javascript" && workerError && (
              <div className="readonly-notice">
                JavaScript worker 不可用：{workerError}
              </div>
            )}
            {hasDrafts && (
              <div className="draft-notice">
                有 {Object.keys(drafts).length}{" "}
                处输入格式待修正。切换节点不会丢失输入；修正后即可保存和运行。
              </div>
            )}
            {tab === "source" || readonly ? (
              <pre className="source-preview">{source}</pre>
            ) : (
              <NodeForm
                node={node}
                disabled={disabled}
                drafts={drafts}
                setDraft={setDraft}
                onChange={changeData}
              />
            )}
          </div>
        </section>
      </div>
      {resultsOpen && (
        <section className="results-panel">
          <div className="results-heading">
            <strong>运行结果</strong>
            <span className="metric">
              采样 <b>{results.summary.samples}</b>
            </span>
            <span className="metric passed">
              成功 <b>{results.summary.passed}</b>
            </span>
            <span className="metric failed">
              失败 <b>{results.summary.failed}</b>
            </span>
            <span className="results-limit">
              最近 1000 条 · 响应预览最多 64 KiB
            </span>
            <div className="toolbar-spacer" />
            <button
              disabled={running}
              onClick={() => {
                setResults(emptyResults());
                setSelectedResult(undefined);
              }}
            >
              清空
            </button>
            <button aria-label="收起结果" onClick={() => setResultsOpen(false)}>
              ⌄
            </button>
          </div>
          <div className="results-content">
            <div className="results-table">
              <table>
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>采样名称</th>
                    <th>线程组</th>
                    <th>耗时</th>
                    <th>返回码</th>
                    <th>断言</th>
                  </tr>
                </thead>
                <tbody>
                  {results.rows.map((row) => (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      className={selectedResult === row.id ? "selected" : ""}
                      onClick={() => setSelectedResult(row.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setSelectedResult(row.id);
                      }}
                    >
                      <td className={row.sample.success ? "passed" : "failed"}>
                        {row.sample.success ? "✓ 成功" : "× 失败"}
                      </td>
                      <td>{row.sample.label}</td>
                      <td>{row.sample.group_name}</td>
                      <td>{row.sample.elapsed_ms.toFixed(2)} ms</td>
                      <td>{row.sample.response_code ?? "—"}</td>
                      <td
                        className={
                          row.sample.assertions?.some((a) => !a.success)
                            ? "failed"
                            : ""
                        }
                      >
                        {row.sample.assertions?.length
                          ? `${row.sample.assertions.filter((a) => a.success).length}/${row.sample.assertions.length} 通过`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!results.rows.length && (
                <div className="results-empty">
                  <span>▥</span>
                  <strong>
                    {running ? "等待采样结果" : "运行测试后，在此查看采样结果"}
                  </strong>
                  <p>选择一条结果，查看响应与错误详情</p>
                </div>
              )}
            </div>
            <div className="response-preview">
              {selectedRow ? (
                <>
                  <h3>{selectedRow.sample.label}</h3>
                  <p>
                    用户 {selectedRow.sample.user_index} · 迭代{" "}
                    {selectedRow.sample.iteration}（从 0 开始）
                  </p>
                  <p>
                    发送 {selectedRow.sample.bytes_sent} B · 接收{" "}
                    {selectedRow.sample.bytes_received} B
                  </p>
                  {selectedRow.sample.response_message && (
                    <pre>{selectedRow.sample.response_message}</pre>
                  )}
                  <section className="assertion-results" aria-label="断言结果">
                    <h4>断言结果</h4>
                    {selectedRow.sample.assertions?.length ? (
                      <ul>
                        {selectedRow.sample.assertions.map(
                          (assertion, index) => (
                            <li key={index}>
                              <strong
                                className={
                                  assertion.success ? "passed" : "failed"
                                }
                              >
                                {assertion.success ? "✓ 通过" : "× 失败"} ·{" "}
                                {assertion.name}
                              </strong>
                              {assertion.message && (
                                <pre>{assertion.message}</pre>
                              )}
                            </li>
                          ),
                        )}
                      </ul>
                    ) : (
                      <p>此采样没有断言结果</p>
                    )}
                  </section>
                  {selectedRow.truncated && (
                    <p className="error-text">
                      响应预览已截断或因缓存上限释放。
                    </p>
                  )}
                  <pre>
                    {selectedRow.sample.response_body
                      ? new TextDecoder().decode(
                          new Uint8Array(selectedRow.sample.response_body),
                        )
                      : "未保存响应体"}
                  </pre>
                </>
              ) : (
                <div className="response-empty">选择采样查看详情</div>
              )}
            </div>
          </div>
        </section>
      )}
      <footer className="statusbar">
        <span className={`status-dot ${running ? "live" : ""}`} />
        {statusLabel[runState]}
        {runState === "completed" &&
          results.summary.failed > 0 &&
          " · 存在失败采样"}
        <span className="status-separator">|</span>
        {dirty ? "有未保存的修改" : "所有修改已保存"}
        <div className="toolbar-spacer" />
        <span>{readonly ? "只读" : "UTF-8 · JSON v1"}</span>
        <span className="status-separator">|</span>
        <span>
          {allNodes.filter((n) => n.kind === "group").length} 个线程组
        </span>
      </footer>
      {context && (
        <div
          className="context-menu dropdown"
          style={{ left: context.x, top: Math.max(8, context.y) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="menu-caption">添加组件</div>
          {componentKinds
            .filter((k) =>
              allowed(findNode(document.root, context.id)!.kind, k),
            )
            .map((k) => (
              <button
                key={k}
                disabled={disabled}
                onClick={() => add(k, context.id)}
              >
                <span className="node-icon">{icons[k]}</span>
                {labels[k]}
              </button>
            ))}
          <hr />
          <button
            disabled={disabled || context.id === document.root.id}
            onClick={() => duplicate(context.id)}
          >
            复制节点
          </button>
          <button
            disabled={disabled || context.id === document.root.id}
            onClick={() => void remove(context.id)}
          >
            删除节点
          </button>
        </div>
      )}
      {prompt && (
        <div className="modal-backdrop" onClick={(e) => e.stopPropagation()}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-title"
          >
            <h2 id="prompt-title">{prompt.message}</h2>
            <div>
              {prompt.choices.map((choice, i) => (
                <button
                  key={choice}
                  autoFocus={i === prompt.choices.length - 1}
                  onClick={() => {
                    setPrompt(undefined);
                    prompt.resolve(choice);
                  }}
                >
                  {choice}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
