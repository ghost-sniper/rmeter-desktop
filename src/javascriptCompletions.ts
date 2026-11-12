import { functionDefinitions } from "./functionSyntax";

export type ScriptKind =
  "javascript" | "javascript_preprocessor" | "javascript_postprocessor";
export interface Completion {
  name: string;
  signature: string;
  description: string;
  call?: "arguments" | "empty";
  object?: boolean;
}
const method = (
  name: string,
  parameters: string,
  description: string,
): Completion => ({
  name,
  signature: `${name}(${parameters})`,
  description,
  call: parameters ? "arguments" : "empty",
});
const property = (name: string, description: string): Completion => ({
  name,
  signature: name,
  description,
});

const members: Record<string, Completion[]> = {
  vars: [
    method("get", "name", "读取字符串变量；变量不存在时返回 null。"),
    method("put", "name, value", "写入字符串变量，受变量容量限制。"),
    method("set", "name, value", "写入字符串变量，与 vars.put 相同。"),
    method("remove", "name", "删除变量。"),
    method("contains", "name", "检查变量是否存在。"),
    method("getIteration", "", "获取当前线程组迭代次数，从 1 开始。"),
  ],
  ctx: [
    property("groupName", "当前线程组名称。"),
    property("userIndex", "当前虚拟用户编号，从 0 开始。"),
    property("iteration", "当前线程组迭代编号，从 0 开始。"),
    property("lastSampleOk", "上一次采样最终是否成功。"),
    property("samplerName", "当前采样器名称。"),
    method("getThreadNum", "", "获取当前虚拟用户编号，从 0 开始。"),
    method("getVariables", "", "获取 vars 变量对象。"),
  ],
  functions: functionDefinitions.map((definition) =>
    method(
      definition.name,
      definition.parameters
        .map(
          (parameter, index) =>
            `${parameter.name}${index >= definition.minimumArguments ? "?" : ""}`,
        )
        .join(", "),
      `${definition.description} 返回字符串；大整数请传十进制字符串。`,
    ),
  ),
  log: [
    ...["trace", "debug", "info", "warn", "error"].map((name) =>
      method(name, "message, ...args", "写入脚本日志，支持 {} 参数占位符。"),
    ),
    method("isDebugEnabled", "", "当前始终返回 true。"),
    method("isInfoEnabled", "", "当前始终返回 true。"),
  ],
  sampler: [
    property("name", "当前采样器名称（只读）。"),
    method("getName", "", "获取当前采样器名称。"),
  ],
  prev: [
    property("body", "本次采样响应文本；不可用时为 null。"),
    property("responseCode", "本次采样响应码。"),
    property("responseMessage", "本次采样响应消息。"),
    property("label", "本次采样名称。"),
    property("elapsedMs", "本次采样耗时，单位毫秒。"),
    property("success", "本次采样是否成功。"),
    property("bodyUnavailableReason", "响应正文不可用的原因。"),
    method("getResponseDataAsString", "", "获取响应正文，不可用时为 null。"),
    method("getResponseCode", "", "获取响应码。"),
    method("getResponseMessage", "", "获取响应消息。"),
    method("getSampleLabel", "", "获取本次采样名称。"),
    method("getTime", "", "获取本次采样耗时，单位毫秒。"),
    method("isSuccessful", "", "获取本次采样成功状态。"),
  ],
  JSON: [
    method("parse", "text", "将 JSON 字符串解析为 JavaScript 值。"),
    method(
      "stringify",
      "value, replacer?, space?",
      "将 JavaScript 值转换为 JSON 字符串。",
    ),
  ],
  Math: [
    method("random", "", "返回大于等于 0、小于 1 的随机数。"),
    ...["floor", "ceil", "round", "abs"].map((name, index) =>
      method(
        name,
        "value",
        ["向下取整。", "向上取整。", "四舍五入。", "取绝对值。"][index],
      ),
    ),
    method("min", "...values", "取最小值。"),
    method("max", "...values", "取最大值。"),
  ],
  Date: [
    method("now", "", "获取当前 Unix 毫秒时间戳。"),
    method(
      "parse",
      "text",
      "解析日期字符串并返回毫秒时间戳；自定义日期格式请使用 functions.dateTimeConvert。",
    ),
  ],
};
const globals: Completion[] = [
  ...Object.keys(members).map((name) => ({
    ...property(name, `${name} 对象；输入点号查看成员。`),
    object: true,
  })),
  property("Label", "当前 JavaScript 组件名称（只读）。"),
  method("parseInt", "text, radix?", "解析整数，通常将 radix 设为 10。"),
  method("parseFloat", "text", "解析浮点数。"),
  ...["String", "Number", "Boolean"].map((name) =>
    method(name, "value", `转换为 ${name} 类型。`),
  ),
  ...[
    "const",
    "let",
    "if",
    "else",
    "for",
    "while",
    "return",
    "throw",
    "new",
    "try",
    "catch",
    "true",
    "false",
    "null",
    "undefined",
  ].map((name) => property(name, "JavaScript 关键字或全局值。")),
];

// A small lexical guard, not a parser or type checker. Templates are suppressed
// as a whole; completion is intentionally limited to known direct object names.
function inCode(text: string): boolean {
  let quote = "",
    comment = "",
    regex = false,
    characterClass = false,
    regexAllowed = true;
  for (let index = 0; index < text.length; index++) {
    const char = text[index],
      next = text[index + 1];
    if (comment === "line") {
      if (char === "\n") comment = "";
      continue;
    }
    if (comment === "block") {
      if (char === "*" && next === "/") {
        comment = "";
        index++;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) {
        quote = "";
        regexAllowed = false;
      }
      continue;
    }
    if (regex) {
      if (char === "\\") index++;
      else if (char === "[") characterClass = true;
      else if (char === "]") characterClass = false;
      else if (char === "/" && !characterClass) {
        regex = false;
        regexAllowed = false;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      comment = "line";
      index++;
    } else if (char === "/" && next === "*") {
      comment = "block";
      index++;
    } else if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "/" && regexAllowed) {
      regex = true;
      characterClass = false;
    } else if (/[\w$\u0080-\uffff]/.test(char)) {
      const start = index;
      while (
        index + 1 < text.length &&
        /[\w$\u0080-\uffff]/.test(text[index + 1])
      )
        index++;
      regexAllowed =
        /^(return|throw|case|delete|void|typeof|yield|await|new)$/.test(
          text.slice(start, index + 1),
        );
    } else if (!/\s/.test(char)) regexAllowed = !/[)\]}]/.test(char);
  }
  return !quote && !comment && !regex;
}

export interface CompletionQuery {
  start: number;
  end: number;
  caret: number;
  source: string;
  items: Completion[];
}

export function getCompletions(
  source: string,
  caret: number,
  kind: ScriptKind,
  explicit = false,
): CompletionQuery | undefined {
  const before = source.slice(0, caret);
  if (!inCode(before)) return;
  const member = before.match(
    /(?:^|[^\w$.\u0080-\uffff])([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*([\w$]*)$/,
  );
  let prefix: string, candidates: Completion[];
  if (member) {
    if (member[1] === "prev" && kind !== "javascript_postprocessor") return;
    candidates = Object.prototype.hasOwnProperty.call(members, member[1])
      ? members[member[1]]
      : [];
    prefix = member[2];
  } else {
    const word = before.match(/(?:^|[^\w$.\u0080-\uffff])([A-Za-z_$][\w$]*)$/);
    prefix = word?.[1] ?? "";
    if (!prefix && (!explicit || /[\w$.\u0080-\uffff]$/.test(before))) return;
    candidates = globals.filter(
      (item) => item.name !== "prev" || kind === "javascript_postprocessor",
    );
  }
  const items = candidates.filter((item) =>
    item.name.toLowerCase().startsWith(prefix.toLowerCase()),
  );
  if (!items.length) return;
  return {
    start: caret - prefix.length,
    end: caret + (source.slice(caret).match(/^[\w$]*/)?.[0].length ?? 0),
    caret,
    source,
    items,
  };
}

export function insertCompletion(query: CompletionQuery, item: Completion) {
  let text = item.name,
    cursor = text.length;
  const suffix = query.source.slice(query.end);
  if (item.call && !/^\s*\(/.test(suffix)) {
    text += "()";
    cursor = text.length - (item.call === "arguments" ? 1 : 0);
  } else if (item.object && !/^\s*(?:\?\.|\.)/.test(suffix)) {
    text += ".";
    cursor = text.length;
  }
  return {
    value: query.source.slice(0, query.start) + text + suffix,
    caret: query.start + cursor,
  };
}
