import type { Json, ObjectValue } from "./model";

export type AssertionKind = "json" | "xml" | "regex";
export const assertionLabels: Record<AssertionKind, string> = {
  json: "JSONPath 断言",
  xml: "XPath 断言",
  regex: "正则表达式断言",
};
export type Selection = "one" | "any" | "all";
export type Matcher<T> =
  | { type: "equals"; expected: T }
  | { type: "regex"; pattern: string }
  | { type: "exists" | "not_exists" };
export type ResponseAssertion = { enabled?: boolean } & (
  | {
      type?: "json";
      name: string;
      path: string;
      matcher: Matcher<Json>;
      selection?: Selection;
    }
  | {
      type: "xml";
      name: string;
      xpath: string;
      matcher: Matcher<string>;
      selection?: Selection;
      namespaces?: Record<string, string>;
    }
  | { type: "regex"; name: string; pattern: string; invert?: boolean }
);

const record = (value: unknown): value is ObjectValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
export function newAssertion(type: AssertionKind): ObjectValue {
  const base = { type, name: assertionLabels[type] };
  return type === "regex"
    ? { ...base, pattern: ".*" }
    : {
        ...base,
        [type === "json" ? "path" : "xpath"]: type === "json" ? "$" : "/",
        matcher: { type: "exists" },
      };
}

// Only inspect editable shape here. Syntax and execution semantics belong to rmeter.
// In particular do not compile Rust regex, JSONPath or XPath using JavaScript.
export function inspectAssertions(value: Json, path: string, issues: string[]) {
  if (!Array.isArray(value)) {
    issues.push(`${path} 必须是断言数组`);
    return;
  }
  value.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    if (!record(entry)) {
      issues.push(`${at} 必须是断言对象`);
      return;
    }
    const type = entry.type === undefined ? "json" : entry.type;
    if (own(entry, "enabled") && typeof entry.enabled !== "boolean")
      issues.push(`${at}.enabled 必须是布尔值`);
    if (type !== "json" && type !== "xml" && type !== "regex") {
      issues.push(`${at} 不支持的断言类型：${String(type)}`);
      return;
    }
    const keys =
      type === "regex"
        ? ["type", "name", "pattern", "invert"]
        : type === "json"
          ? ["type", "name", "path", "matcher", "selection"]
          : ["type", "name", "xpath", "matcher", "selection", "namespaces"];
    for (const key of Object.keys(entry)) {
      if (key !== "enabled" && !keys.includes(key))
        issues.push(`${at}.${key} 暂不支持`);
    }
    for (const key of [
      "name",
      type === "regex" ? "pattern" : type === "json" ? "path" : "xpath",
    ]) {
      if (typeof entry[key] !== "string")
        issues.push(`${at}.${key} 必须是字符串`);
    }
    if (type === "regex") {
      if (own(entry, "invert") && typeof entry.invert !== "boolean")
        issues.push(`${at}.invert 必须是布尔值`);
      return;
    }
    if (
      own(entry, "selection") &&
      (typeof entry.selection !== "string" ||
        !["one", "any", "all"].includes(entry.selection))
    )
      issues.push(`${at}.selection 暂不支持`);
    if (
      own(entry, "namespaces") &&
      (!record(entry.namespaces) ||
        Object.values(entry.namespaces).some((v) => typeof v !== "string"))
    )
      issues.push(`${at}.namespaces 必须是前缀与 URI 的字符串映射`);
    const matcher = entry.matcher;
    if (
      !record(matcher) ||
      typeof matcher.type !== "string" ||
      !["equals", "regex", "exists", "not_exists"].includes(
        String(matcher.type),
      )
    ) {
      issues.push(`${at}.matcher 暂不支持`);
      return;
    }
    const matcherKeys =
      matcher.type === "equals"
        ? ["type", "expected"]
        : matcher.type === "regex"
          ? ["type", "pattern"]
          : ["type"];
    for (const key of Object.keys(matcher))
      if (!matcherKeys.includes(key))
        issues.push(`${at}.matcher.${key} 暂不支持`);
    if (
      matcher.type === "equals" &&
      (!own(matcher, "expected") ||
        (type === "xml" && typeof matcher.expected !== "string"))
    )
      issues.push(`${at}.matcher.expected 缺失或类型不正确`);
    if (matcher.type === "regex" && typeof matcher.pattern !== "string")
      issues.push(`${at}.matcher.pattern 必须是字符串`);
  });
}
