import { inspectAssertions } from "./assertions";

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type ObjectValue = { [key: string]: Json };
export type Kind =
  | "plan"
  | "group"
  | "loop"
  | "if"
  | "while"
  | "http_request"
  | "http_defaults"
  | "jdbc_request"
  | "javascript"
  | "javascript_preprocessor"
  | "javascript_postprocessor"
  | "jsonpath_extractor"
  | "xpath_extractor"
  | "jmespath_extractor"
  | "regex_extractor"
  | "xpath2_extractor"
  | "jdbc_connection_configuration";
export interface EditorNode {
  id: string;
  kind: Kind;
  data: ObjectValue;
  children: EditorNode[];
}
export interface Document {
  root: EditorNode;
  source: string;
  issues: string[];
}
export const labels: Record<Kind, string> = {
  plan: "测试计划",
  group: "线程组",
  loop: "Loop 循环",
  if: "IF 条件选择",
  while: "While 循环",
  http_request: "HTTP 采样器",
  http_defaults: "HTTP 默认配置",
  jdbc_request: "JDBC 采样器",
  javascript: "JavaScript 采样器",
  javascript_preprocessor: "JavaScript 前置处理器",
  javascript_postprocessor: "JavaScript 后置处理器",
  jsonpath_extractor: "JSONPath 提取器",
  xpath_extractor: "XPath 提取器",
  jmespath_extractor: "JMESPath 提取器",
  regex_extractor: "正则表达式提取器",
  xpath2_extractor: "XPath2 提取器",
  jdbc_connection_configuration: "JDBC 连接配置",
};
export const icons: Record<Kind, string> = {
  plan: "▤",
  group: "♙",
  loop: "↻",
  if: "◇",
  while: "⟳",
  http_request: "↗",
  http_defaults: "⚙",
  jdbc_request: "▱",
  javascript: "JS",
  javascript_preprocessor: "JS↑",
  javascript_postprocessor: "JS↓",
  jsonpath_extractor: "J↓",
  xpath_extractor: "X↓",
  jmespath_extractor: "JM↓",
  regex_extractor: "RE↓",
  xpath2_extractor: "X2↓",
  jdbc_connection_configuration: "⚙",
};
export const componentKinds = Object.keys(labels).filter(
  (k) => k !== "plan",
) as Kind[];
export const object = (v: unknown): v is ObjectValue =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const uid = () => crypto.randomUUID();
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const defaultFields = [
  "protocol",
  "host",
  "port",
  "path",
  "headers",
  "query",
  "connect_timeout_ms",
  "request_timeout_ms",
  "follow_redirects",
  "max_redirects",
  "save_response_body",
  "max_saved_body_bytes",
  "use_system_proxy",
];
function inspectEditable(
  data: ObjectValue,
  kind: Kind,
  path: string,
  issues: string[],
) {
  if (own(data, "enabled") && typeof data.enabled !== "boolean")
    issues.push(`${path}.enabled 必须是布尔值`);
  if (kind === "javascript" || isJavaScriptProcessor(kind)) {
    for (const key of ["name", "script"]) {
      if (own(data, key) && typeof data[key] !== "string")
        issues.push(`${path}.${key} 必须是字符串`);
    }
  }
  if (isExtractor(kind)) {
    for (const key of ["name", "variable_name", "expression", "template"]) {
      if (own(data, key) && typeof data[key] !== "string")
        issues.push(`${path}.${key} 必须是字符串`);
    }
    if (
      own(data, "default_value") &&
      data.default_value !== null &&
      typeof data.default_value !== "string"
    )
      issues.push(`${path}.default_value 必须是字符串或 null`);
    for (const key of [
      "match_number",
      "timeout_ms",
      "max_variable_bytes",
      "max_matches",
    ]) {
      if (
        own(data, key) &&
        (typeof data[key] !== "number" || !Number.isSafeInteger(data[key]))
      )
        issues.push(`${path}.${key} 必须是整数`);
    }
    if (
      own(data, "namespaces") &&
      (!object(data.namespaces) ||
        Object.values(data.namespaces).some((v) => typeof v !== "string"))
    )
      issues.push(`${path}.namespaces 必须是字符串命名空间映射`);
  }
  const pairs = (value: Json, key: string) => {
    if (
      value !== null &&
      (!Array.isArray(value) ||
        value.some(
          (row) =>
            !Array.isArray(row) ||
            row.length !== 2 ||
            row.some((v) => typeof v !== "string"),
        ))
    )
      issues.push(`${key} 不是字符串二元数组，使用只读模式保护原数据`);
  };
  if (
    kind === "plan" &&
    own(data, "variables") &&
    (!object(data.variables) ||
      Object.values(data.variables).some((v) => typeof v !== "string"))
  )
    issues.push(`${path}.variables 必须是字符串变量表`);
  for (const key of ["settings", "defaults"])
    if (own(data, key)) {
      const settings = data[key];
      if (!object(settings)) issues.push(`${path}.${key} 必须是对象`);
      else
        for (const [field, value] of Object.entries(settings)) {
          if (!defaultFields.includes(field))
            issues.push(`${path}.${key}.${field} 暂不支持`);
          if (field === "headers" || field === "query")
            pairs(value, `${path}.${key}.${field}`);
        }
    }
  if (kind === "http_request" && own(data, "body")) {
    const body = data.body;
    if (
      !object(body) ||
      !["empty", "text", "bytes", "form", "json"].includes(String(body.type))
    )
      issues.push(`${path}.body 类型不支持`);
    else {
      for (const key of Object.keys(body))
        if (!["type", "value"].includes(key))
          issues.push(`${path}.body.${key} 暂不支持`);
      if (body.type === "form") pairs(body.value, `${path}.body.value`);
    }
  }
  if (
    kind === "jdbc_request" &&
    own(data, "variable_names") &&
    (!Array.isArray(data.variable_names) ||
      data.variable_names.some((name) => typeof name !== "string"))
  )
    issues.push(`${path}.variable_names 必须是按列顺序排列的字符串数组`);
}
const extractorFields = [
  "type",
  "name",
  "variable_name",
  "expression",
  "match_number",
  "default_value",
  "timeout_ms",
  "max_variable_bytes",
  "max_matches",
];
const fields: Record<Kind, string[]> = {
  jsonpath_extractor: extractorFields,
  jmespath_extractor: extractorFields,
  xpath_extractor: [...extractorFields, "namespaces"],
  xpath2_extractor: [...extractorFields, "namespaces"],
  regex_extractor: [...extractorFields, "template"],
  plan: [
    "version",
    "name",
    "variables",
    "defaults",
    "jdbc_connections",
    "groups",
  ],
  group: [
    "name",
    "users",
    "ramp_up_ms",
    "iterations",
    "max_duration_ms",
    "on_error",
    "children",
  ],
  loop: ["type", "name", "count", "children"],
  if: ["type", "name", "condition", "evaluate_all", "children"],
  while: ["type", "name", "condition", "children"],
  http_defaults: ["type", "name", "settings"],
  http_request: [
    "type",
    "name",
    "url",
    "method",
    "settings",
    "body",
    "assertions",
    "pre_processors",
    "post_processors",
    "max_assertion_body_bytes",
    "max_post_processor_body_bytes",
    "max_post_processor_body_bytes",
  ],
  jdbc_request: [
    "type",
    "name",
    "connection",
    "sql",
    "query_type",
    "parameters",
    "query_timeout_ms",
    "max_rows",
    "max_result_bytes",
    "save_response_body",
    "result_variable",
    "variable_names",
    "row_count_variable",
    "assertions",
    "pre_processors",
    "post_processors",
  ],
  javascript: [
    "type",
    "name",
    "script",
    "timeout_ms",
    "max_variable_bytes",
    "pre_processors",
    "post_processors",
  ],
  javascript_preprocessor: [
    "type",
    "name",
    "script",
    "timeout_ms",
    "max_variable_bytes",
  ],
  javascript_postprocessor: [
    "type",
    "name",
    "script",
    "timeout_ms",
    "max_variable_bytes",
  ],
  jdbc_connection_configuration: [
    "type",
    "name",
    "variable_name",
    "url",
    "driver",
    "username",
    "password",
    "password_env",
    "max_connections",
    "connect_timeout_ms",
    "acquire_timeout_ms",
  ],
};
export function createNode(kind: Kind): EditorNode {
  const data: ObjectValue =
    kind === "plan"
      ? { version: 1, name: "测试计划", groups: [] }
      : kind === "group"
        ? {
            name: "线程组",
            users: 1,
            ramp_up_ms: 0,
            iterations: 1,
            on_error: "continue",
          }
        : { type: kind };
  if (kind !== "plan" && kind !== "group") data.name = labels[kind];
  if (kind === "loop") data.count = 1;
  if (kind === "if" || kind === "while") data.condition = "${enabled}";
  if (kind === "http_request")
    Object.assign(data, {
      method: "GET",
      settings: { save_response_body: true },
    });
  if (kind === "http_defaults") data.settings = {};
  if (kind === "jdbc_request")
    Object.assign(data, {
      connection: "db",
      query_type: "select",
      sql: "SELECT 1",
      parameters: [],
    });
  if (kind === "javascript" || isJavaScriptProcessor(kind))
    Object.assign(data, {
      script: 'vars.put("enabled", "true");',
      timeout_ms: 100,
      max_variable_bytes: 1048576,
    });
  if (isExtractor(kind)) {
    Object.assign(data, {
      variable_name: "extracted",
      expression:
        kind === "jsonpath_extractor"
          ? "$.id"
          : kind === "jmespath_extractor"
            ? "id"
            : kind === "regex_extractor"
              ? "(.*)"
              : "//item/text()",
      match_number: 1,
      default_value: "",
      timeout_ms: 1000,
      max_variable_bytes: 1048576,
      max_matches: 1000,
    });
    if (kind === "regex_extractor") data.template = "$1$";
    if (kind === "xpath_extractor" || kind === "xpath2_extractor")
      data.namespaces = {};
  }
  if (kind === "jdbc_connection_configuration")
    Object.assign(data, {
      variable_name: "db",
      url: "postgresql://localhost:5432/postgres",
      driver: "postgresql",
    });
  return { id: uid(), kind, data, children: [] };
}
export function newDocument(): Document {
  const root = createNode("plan");
  root.children = [createNode("group")];
  return { root, source: "", issues: [] };
}
export function title(node: EditorNode): string {
  return typeof node.data.name === "string"
    ? node.data.name || "（未命名）"
    : labels[node.kind];
}
export const isSampler = (kind: Kind) =>
  ["http_request", "jdbc_request", "javascript"].includes(kind);
export const extractorKinds: Kind[] = [
  "jsonpath_extractor",
  "xpath_extractor",
  "jmespath_extractor",
  "regex_extractor",
  "xpath2_extractor",
];
export const isExtractor = (kind: Kind) => extractorKinds.includes(kind);
export const isJavaScriptProcessor = (kind: Kind) =>
  ["javascript_preprocessor", "javascript_postprocessor"].includes(kind);
export const isPostProcessor = (kind: Kind) =>
  kind === "javascript_postprocessor" || isExtractor(kind);
export const isProcessor = (kind: Kind) =>
  isJavaScriptProcessor(kind) || isExtractor(kind);
export const sameProcessorPhase = (a: Kind, b?: Kind) =>
  b !== undefined &&
  ((isPostProcessor(a) && isPostProcessor(b)) ||
    (a === "javascript_preprocessor" && b === a));
// Native JSON has separate ordered pre/post arrays; show that execution order in the tree.
export function orderChildren(children: EditorNode[]): EditorNode[] {
  return [
    ...children.filter((n) => !isPostProcessor(n.kind)),
    ...children.filter((n) => isPostProcessor(n.kind)),
  ];
}
export function allowed(parent: Kind, child: Kind): boolean {
  if (isExtractor(child)) return parent === "http_request";
  if (isSampler(parent)) return isJavaScriptProcessor(child);
  if (isProcessor(child)) return false;
  if (parent === "plan")
    return child === "group" || child === "jdbc_connection_configuration";
  return (
    ["group", "loop", "if", "while"].includes(parent) &&
    child !== "plan" &&
    child !== "group"
  );
}
export function flatten(node: EditorNode): EditorNode[] {
  return [node, ...node.children.flatMap(flatten)];
}
export function findNode(root: EditorNode, id: string): EditorNode | undefined {
  return flatten(root).find((n) => n.id === id);
}
export function updateNode(
  root: EditorNode,
  id: string,
  update: (n: EditorNode) => EditorNode,
): EditorNode {
  if (root.id === id) return update(root);
  return {
    ...root,
    children: root.children.map((n) => updateNode(n, id, update)),
  };
}
export function parentOf(root: EditorNode, id: string): EditorNode | undefined {
  return flatten(root).find((n) => n.children.some((c) => c.id === id));
}
export function removeNode(root: EditorNode, id: string): EditorNode {
  return {
    ...root,
    children: root.children
      .filter((n) => n.id !== id)
      .map((n) => removeNode(n, id)),
  };
}
export function cloneNode(node: EditorNode): EditorNode {
  return {
    ...structuredClone(node),
    id: uid(),
    children: node.children.map(cloneNode),
  };
}
export function moveNode(
  root: EditorNode,
  id: string,
  parentId: string,
): EditorNode {
  const node = findNode(root, id),
    parent = findNode(root, parentId);
  if (
    !node ||
    !parent ||
    !allowed(parent.kind, node.kind) ||
    flatten(node).some((n) => n.id === parentId)
  )
    return root;
  return updateNode(removeNode(root, id), parentId, (p) => ({
    ...p,
    children: orderChildren([...p.children, node]),
  }));
}
export function reorderNode(
  root: EditorNode,
  id: string,
  delta: number,
): EditorNode {
  const parent = parentOf(root, id);
  if (!parent) return root;
  const index = parent.children.findIndex((n) => n.id === id),
    next = index + delta;
  if (
    isSampler(parent.kind) &&
    !sameProcessorPhase(
      parent.children[index].kind,
      parent.children[next]?.kind,
    )
  )
    return root;
  if (next < 0 || next >= parent.children.length) return root;
  return updateNode(root, parent.id, (p) => {
    const children = [...p.children];
    [children[index], children[next]] = [children[next], children[index]];
    return { ...p, children };
  });
}
export function serializeNode(
  node: EditorNode,
  globalConnection = false,
): ObjectValue {
  const data = structuredClone(node.data);
  if (node.kind === "plan") {
    data.groups = node.children
      .filter((n) => n.kind === "group")
      .map((n) => serializeNode(n));
    const connections = node.children
      .filter((n) => n.kind === "jdbc_connection_configuration")
      .map((n) => serializeNode(n, true));
    if (connections.length || "jdbc_connections" in data)
      data.jdbc_connections = connections;
  } else if (["group", "loop", "if", "while"].includes(node.kind))
    data.children = node.children.map((n) => serializeNode(n));
  if (isSampler(node.kind)) {
    for (const [key, kind] of [
      ["pre_processors", "javascript_preprocessor"],
      ["post_processors", "javascript_postprocessor"],
    ]) {
      const processors = node.children
        .filter((n) =>
          kind === "javascript_postprocessor"
            ? isPostProcessor(n.kind)
            : n.kind === kind,
        )
        .map((n) => serializeNode(n));
      if (processors.length || key in data) data[key] = processors;
    }
  }
  if (globalConnection) delete data.type;
  else if (node.kind !== "plan" && node.kind !== "group")
    data.type = isJavaScriptProcessor(node.kind) ? "javascript" : node.kind;
  return data;
}
export function stringify(root: EditorNode): string {
  return JSON.stringify(serializeNode(root), null, 2) + "\n";
}
export function parseDocument(source: string): Document {
  const issues: string[] = [];
  let value: unknown;
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (e) {
    return {
      ...newDocument(),
      source,
      issues: [`JSON 无法解析：${String(e)}`],
    };
  }
  const inspectNumbers = (v: unknown): void => {
    if (
      typeof v === "number" &&
      (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))
    )
      issues.push("包含超出编辑器安全数值范围的数字，保留原始 JSON 只读查看");
    if (Array.isArray(v)) v.forEach(inspectNumbers);
    else if (object(v)) Object.values(v).forEach(inspectNumbers);
  };
  inspectNumbers(value);
  const visit = (value: unknown, kind: Kind, path: string): EditorNode => {
    if (!object(value)) {
      issues.push(`${path} 必须是对象`);
      return createNode(kind);
    }
    const data = structuredClone(value),
      node: EditorNode = { id: uid(), kind, data, children: [] };
    inspectEditable(data, kind, path, issues);
    for (const key of Object.keys(data))
      if (key !== "enabled" && !fields[kind].includes(key))
        issues.push(`${path}.${key} 不在首版编辑范围内`);
    if ("assertions" in data)
      inspectAssertions(data.assertions, `${path}.assertions`, issues);
    if (isJavaScriptProcessor(kind) && data.type !== "javascript")
      issues.push(`${path}.type 仅支持 javascript 处理器`);
    if (
      kind === "jdbc_connection_configuration" &&
      data.driver !== undefined &&
      data.driver !== "postgresql"
    )
      issues.push(`${path}.driver 仅支持 PostgreSQL`);
    const children = (items: unknown, childKind?: Kind, key = "children") => {
      if (!Array.isArray(items)) {
        issues.push(`${path}.${key} 必须是数组`);
        return [];
      }
      return items.flatMap((v: unknown, i) => {
        const rawType = object(v) ? v.type : undefined;
        const k =
          childKind ??
          (key === "post_processors" && rawType === "javascript"
            ? "javascript_postprocessor"
            : rawType === "jdbc_connection"
              ? "jdbc_connection_configuration"
              : rawType === "jdbc_sampler"
                ? "jdbc_request"
                : rawType);
        if (
          typeof k !== "string" ||
          !own(labels, k) ||
          !allowed(kind, k as Kind)
        ) {
          issues.push(`${path}.${key}[${i}] 不支持的组件：${String(k)}`);
          return [];
        }
        const n = visit(v, k as Kind, `${path}.${key}[${i}]`);
        // Documented aliases are normalised to canonical component names on save.
        return [n];
      });
    };
    if (kind === "plan") {
      if (data.version !== 1) issues.push("仅支持 version: 1 的 rmeter JSON");
      node.children = [
        ...("jdbc_connections" in data
          ? children(
              data.jdbc_connections,
              "jdbc_connection_configuration",
              "jdbc_connections",
            )
          : []),
        ...children(data.groups, "group", "groups"),
      ];
    } else if (["group", "loop", "if", "while"].includes(kind))
      node.children = children(data.children);
    else if (isSampler(kind)) {
      node.children = [
        ...("pre_processors" in data
          ? children(
              data.pre_processors,
              "javascript_preprocessor",
              "pre_processors",
            )
          : []),
        ...("post_processors" in data
          ? children(data.post_processors, undefined, "post_processors")
          : []),
      ];
    }
    return node;
  };
  const root = visit(value, "plan", "plan");
  return { root, source, issues };
}
export function getValue(data: ObjectValue, path: string): Json | undefined {
  let current: Json | undefined = data;
  for (const key of path.split("."))
    current = object(current) ? current[key] : undefined;
  return current;
}
export function setValue(
  data: ObjectValue,
  path: string,
  value: Json | undefined,
): ObjectValue {
  const result = structuredClone(data),
    keys = path.split(".");
  let target = result;
  for (const key of keys.slice(0, -1)) {
    if (!object(target[key])) target[key] = {};
    target = target[key] as ObjectValue;
  }
  if (value === undefined) delete target[keys[keys.length - 1]];
  else target[keys[keys.length - 1]] = value;
  return result;
}
