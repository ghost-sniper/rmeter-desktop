import { useId } from "react";
import JavaScriptEditor from "./JavaScriptEditor";
import { AssertionKind, assertionLabels, newAssertion } from "./assertions";
import {
  EditorNode,
  Json,
  ObjectValue,
  getValue,
  setValue,
  labels,
  object,
  isJavaScriptProcessor,
  isExtractor,
  isTimer,
} from "./model";

export interface Draft {
  text: string;
  error: string;
}
export type Drafts = Record<string, Draft>;
interface Props {
  node: EditorNode;
  disabled: boolean;
  drafts: Drafts;
  setDraft: (key: string, draft?: Draft) => void;
  onChange: (data: ObjectValue) => void;
}
type Field = {
  path: string;
  label: string;
  type?:
    | "duration"
    | "deviation"
    | "integer"
    | "number"
    | "text"
    | "password"
    | "code"
    | "json"
    | "boolean"
    | "count"
    | "csv";
  hint?: string;
  placeholder?: string;
  options?: [string, string][];
  required?: boolean;
  nullable?: boolean;
};
const httpFields: Field[] = [
  {
    path: "protocol",
    label: "协议",
    options: [
      ["http", "HTTP"],
      ["https", "HTTPS"],
    ],
  },
  { path: "host", label: "服务器名称或 IP" },
  { path: "port", label: "端口", type: "number" },
  { path: "path", label: "路径" },
  {
    path: "connect_timeout_ms",
    label: "连接超时（ms）",
    type: "number",
    nullable: true,
  },
  {
    path: "request_timeout_ms",
    label: "请求超时（ms）",
    type: "number",
    nullable: true,
  },
  { path: "follow_redirects", label: "跟随重定向", type: "boolean" },
  { path: "max_redirects", label: "最大重定向次数", type: "number" },
  { path: "save_response_body", label: "保存响应体", type: "boolean" },
  {
    path: "max_saved_body_bytes",
    label: "保存响应上限（bytes）",
    type: "number",
  },
  { path: "use_system_proxy", label: "使用系统代理", type: "boolean" },
];
const specificFields: Partial<Record<EditorNode["kind"], Field[]>> = {
  constant_timer: [
    {
      path: "delay_ms",
      label: "线程延迟（ms）",
      type: "duration",
      required: true,
      hint: "每次采样前的固定等待时间；0 表示不等待。",
    },
  ],
  gaussian_random_timer: [
    {
      path: "deviation_ms",
      label: "偏差（ms）",
      type: "deviation",
      required: true,
      hint: "标准差，可为小数；0 表示只等待固定偏移。",
    },
    {
      path: "offset_ms",
      label: "固定延迟偏移（ms）",
      type: "duration",
      required: true,
      hint: "延迟 = |标准正态随机数 × 偏差 + 偏移|，截去小数；每次采样独立计算。",
    },
  ],
  group: [
    {
      path: "users",
      label: "线程数（用户数）",
      type: "number",
      hint: "0 表示不运行此线程组；默认 1",
    },
    {
      path: "ramp_up_ms",
      label: "启动时间（ms）",
      type: "number",
      hint: "默认 0",
    },
    { path: "iterations", label: "循环次数", type: "count", hint: "默认 1" },
    {
      path: "max_duration_ms",
      label: "最长运行时间（ms）",
      type: "number",
      nullable: true,
      hint: "缺省或 null 表示不限时",
    },
    {
      path: "on_error",
      label: "采样错误后",
      options: [
        ["continue", "继续"],
        ["next_iteration", "开始下一次迭代"],
        ["stop_user", "停止当前用户"],
        ["stop_test", "停止测试"],
      ],
    },
  ],
  while: [
    {
      path: "timeout_ms",
      label: "每轮超时（ms）",
      type: "number",
      hint: "0 或缺省表示不限时；每轮重新计时，累计所有子节点（含定时器和处理器）耗时。超时取消当前节点并退出此控制器，记录失败。",
    },
  ],
  loop: [
    {
      path: "timeout_ms",
      label: "每轮超时（ms）",
      type: "number",
      hint: "0 或缺省表示不限时；每轮重新计时，累计所有子节点（含定时器和处理器）耗时。超时取消当前节点并退出此控制器，记录失败。",
    },
    {
      path: "count",
      label: "循环次数",
      type: "count",
      required: true,
      hint: "0 跳过执行；infinite 表示无限循环",
    },
  ],
  if: [
    { path: "evaluate_all", label: "每个子节点前重新求值", type: "boolean" },
  ],
  jdbc_connection_configuration: [
    { path: "variable_name", label: "连接变量名", required: true },
    {
      path: "url",
      label: "数据库 URL",
      required: true,
      hint: "postgresql://host:5432/database；仅 PostgreSQL，默认要求 TLS",
    },
    {
      path: "driver",
      label: "驱动",
      options: [["postgresql", "PostgreSQL（Rust 原生）"]],
    },
    { path: "username", label: "用户名" },
    {
      path: "password",
      label: "密码",
      type: "password",
      hint: "写入脚本文件；与密码环境变量互斥",
    },
    {
      path: "password_env",
      label: "密码环境变量",
      hint: "例如 PGPASSWORD；与密码互斥",
    },
    {
      path: "max_connections",
      label: "最大连接数",
      type: "number",
      hint: "默认 10",
    },
    {
      path: "connect_timeout_ms",
      label: "连接超时（ms）",
      type: "number",
      hint: "默认 10000",
    },
    {
      path: "acquire_timeout_ms",
      label: "获取连接超时（ms）",
      type: "number",
      hint: "默认 10000",
    },
  ],
  jdbc_request: [
    { path: "connection", label: "连接变量名", required: true },
    {
      path: "query_type",
      label: "查询类型",
      options: [
        ["select", "Select · 返回行"],
        ["update", "Update · 返回影响行数"],
      ],
    },
    {
      path: "sql",
      label: "SQL",
      type: "code",
      required: true,
      hint: "参数占位符使用 $1、$2；每次采样执行一条语句",
    },
    {
      path: "parameters",
      label: "参数（JSON 数组）",
      type: "json",
      hint: '例如 [42, "${name}"]',
    },
    {
      path: "query_timeout_ms",
      label: "查询超时（ms）",
      type: "number",
      hint: "默认 30000",
    },
    {
      path: "max_rows",
      label: "最大结果行数",
      type: "number",
      hint: "默认 1000",
    },
    {
      path: "max_result_bytes",
      label: "结果容量（bytes）",
      type: "number",
      hint: "默认 8388608",
    },
    { path: "save_response_body", label: "保存响应体", type: "boolean" },
    {
      path: "result_variable",
      label: "整表结果变量",
      hint: '保存 JSONArray，例如 [{"id":1,"name":"张三"}]；填写 result 后可通过 ${result_#} 读取行数。',
    },
    {
      path: "variable_names",
      label: "按列变量名",
      type: "csv",
      placeholder: "id,,name",
      hint: "按查询列顺序填写，逗号分隔；空位置跳过该列。id_1、id_2 读取各行，id_# 读取行数。可与整表结果变量同时使用。",
    },
    {
      path: "row_count_variable",
      label: "额外行数变量",
      hint: "可选；上述两种保存方式已自动生成 变量_#。",
    },
  ],
  javascript: [
    {
      path: "script",
      label: "JavaScript",
      type: "code",
      required: true,
      hint: "vars.get / put / remove / contains；functions.RandomString / changeCase / dateTimeConvert / Random / RandomDate。日期示例：functions.dateTimeConvert('2024-02-29', 'yyyy-MM-dd', 'dd/MM/yyyy')。ctx 提供运行上下文，log 提供日志；函数返回字符串，大整数请传十进制字符串。",
    },
    {
      path: "timeout_ms",
      label: "执行超时（ms）",
      type: "number",
      hint: "默认 100；范围 1–60000",
    },
    {
      path: "max_variable_bytes",
      label: "变量容量（bytes）",
      type: "number",
      hint: "默认 1048576",
    },
  ],
};

function InputField({ field, ...props }: Props & { field: Field }) {
  const { node, onChange, drafts, setDraft } = props;
  const id = useId(),
    value = getValue(node.data, field.path),
    key = `${node.id}:${field.path}`,
    draft = drafts[key];
  const change = (v: Json | undefined) => {
    setDraft(key);
    onChange(setValue(node.data, field.path, v));
  };
  const accept = (text: string) => {
    if (!text && !field.required && field.path !== "default_value") {
      change(undefined);
      return;
    }
    if (field.type === "duration" || field.type === "deviation") {
      if (text.includes("${")) {
        change(text);
        return;
      }
      const number = Number(text);
      if (
        !text.trim() ||
        !Number.isFinite(number) ||
        number < 0 ||
        number > Number.MAX_SAFE_INTEGER ||
        (field.type === "duration" && !Number.isInteger(number))
      ) {
        setDraft(key, {
          text,
          error:
            field.type === "duration"
              ? "请输入非负安全整数或 ${变量名}"
              : "请输入非负数字或 ${变量名}",
        });
        return;
      }
      change(number);
      return;
    }
    if (field.type === "csv") {
      change(text.split(","));
      return;
    }
    if (
      field.type === "json" ||
      field.type === "number" ||
      field.type === "integer" ||
      field.type === "count"
    ) {
      try {
        const next: Json =
          field.type === "json"
            ? JSON.parse(text)
            : field.type === "count" && text === "infinite"
              ? "infinite"
              : field.nullable && text === "null"
                ? null
                : Number(text);
        if (
          field.type !== "json" &&
          next !== "infinite" &&
          next !== null &&
          (!text.trim() ||
            !Number.isSafeInteger(next) ||
            (field.type !== "integer" && Number(next) < 0))
        )
          throw Error(
            field.type === "integer" ? "请输入安全整数" : "请输入非负安全整数",
          );
        change(next);
      } catch (e) {
        setDraft(key, {
          text,
          error:
            field.type === "json"
              ? "JSON 格式不正确；修正后可以保存或运行"
              : String(e).replace("Error: ", ""),
        });
      }
    } else change(text);
  };
  const shown =
    draft?.text ??
    (value === undefined
      ? ""
      : field.type === "csv" && Array.isArray(value)
        ? value.join(",")
        : field.type === "json"
          ? JSON.stringify(value, null, 2)
          : value === null
            ? "null"
            : String(value));
  return (
    <div
      className={`field ${field.type === "code" || field.type === "json" ? "wide" : ""}`}
    >
      <label htmlFor={id}>
        {field.label}
        {field.required && <span className="required"> *</span>}
      </label>
      <div className="input-row">
        {field.options ? (
          <select
            id={id}
            value={shown}
            onChange={(e) => change(e.target.value || undefined)}
          >
            <option value="">默认 / 未设置</option>
            {field.options.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        ) : field.type === "boolean" ? (
          <select
            id={id}
            value={shown}
            onChange={(e) =>
              change(
                e.target.value === "" ? undefined : e.target.value === "true",
              )
            }
          >
            <option value="">默认 / 继承</option>
            <option value="true">是</option>
            <option value="false">否</option>
          </select>
        ) : field.path === "script" &&
          (node.kind === "javascript" || isJavaScriptProcessor(node.kind)) ? (
          <JavaScriptEditor
            key={node.id}
            id={id}
            value={shown}
            onChange={accept}
            kind={
              node.kind as
                | "javascript"
                | "javascript_preprocessor"
                | "javascript_postprocessor"
            }
            disabled={props.disabled}
          />
        ) : field.type === "code" || field.type === "json" ? (
          <textarea
            id={id}
            className="code"
            spellCheck={false}
            rows={field.type === "code" ? 9 : 5}
            value={shown}
            onChange={(e) => accept(e.target.value)}
          />
        ) : (
          <input
            id={id}
            type={field.type === "password" ? "password" : "text"}
            inputMode={field.type === "number" ? "numeric" : undefined}
            autoComplete="off"
            value={shown}
            placeholder={
              field.placeholder ??
              (field.type === "count"
                ? "1 或 infinite"
                : field.nullable
                  ? "默认；null 为禁用/无限"
                  : "未设置")
            }
            onChange={(e) => accept(e.target.value)}
          />
        )}
        {!field.required && (
          <button
            type="button"
            className="reset"
            title={`重置${field.label}为缺省`}
            aria-label={`重置${field.label}`}
            onClick={() => change(undefined)}
          >
            ↺
          </button>
        )}
      </div>
      {field.hint && <small>{field.hint}</small>}
      {draft?.error && (
        <small className="error-text" role="alert">
          {draft.error}
        </small>
      )}
    </div>
  );
}

function Pairs({
  path,
  label,
  variables = false,
  ...props
}: Props & { path: string; label: string; variables?: boolean }) {
  const value = getValue(props.node.data, path);
  const samplerList =
    props.node.kind === "http_request" &&
    (path === "settings.headers" || path === "settings.query");
  const pairs: [string, string][] =
    variables && object(value)
      ? Object.entries(value).map(([k, v]) => [k, String(v)])
      : Array.isArray(value)
        ? value
            .filter(Array.isArray)
            .map((p) => [String(p[0] ?? ""), String(p[1] ?? "")])
        : [];
  const set = (next: [string, string][]) =>
    props.onChange(
      setValue(
        props.node.data,
        path,
        variables ? Object.fromEntries(next) : next,
      ),
    );
  return (
    <section className="pairs wide">
      <div className="section-line">
        <h3>{label}</h3>
        <div>
          <button
            type="button"
            onClick={() => {
              let index = pairs.length + 1;
              while (
                variables &&
                pairs.some(([name]) => name === `variable${index}`)
              )
                index++;
              set([...pairs, [variables ? `variable${index}` : "", ""]]);
            }}
          >
            ＋ 添加
          </button>
          {samplerList && (
            <button type="button" onClick={() => set([])}>
              清空并停止继承
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              props.onChange(setValue(props.node.data, path, undefined))
            }
          >
            恢复缺省
          </button>
        </div>
      </div>
      {samplerList && (
        <p className="field-hint">
          {Array.isArray(value)
            ? value.length
              ? "已设置：整组使用以下条目，不合并 HTTP 默认配置中的条目。"
              : "已清空：不继承 HTTP 默认配置中的条目。"
            : "未设置：继承 HTTP 默认配置中的条目。"}
          点击“恢复缺省”可重新继承。
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>值</th>
            <th className="action-cell" />
          </tr>
        </thead>
        <tbody>
          {pairs.map(([key, val], index) => (
            <tr key={index}>
              <td>
                <input
                  aria-label={`${label}名称 ${index + 1}`}
                  value={key}
                  onChange={(e) => {
                    const next = [...pairs];
                    next[index] = [e.target.value, val];
                    if (
                      variables &&
                      next.some(
                        (p, i) => i !== index && p[0] === e.target.value,
                      )
                    )
                      return;
                    set(next);
                  }}
                />
              </td>
              <td>
                <input
                  aria-label={`${label}值 ${index + 1}`}
                  value={val}
                  onChange={(e) => {
                    const next = [...pairs];
                    next[index] = [key, e.target.value];
                    set(next);
                  }}
                />
              </td>
              <td>
                <button
                  type="button"
                  aria-label={`删除${label} ${index + 1}`}
                  onClick={() => set(pairs.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!pairs.length && <p className="empty-line">暂无条目</p>}
    </section>
  );
}

function AssertionsForm(props: Props) {
  const { node, onChange, drafts, setDraft } = props;
  const assertions = (
    Array.isArray(node.data.assertions) ? node.data.assertions : []
  ) as ObjectValue[];
  const prefix = `${node.id}:assertions:`;
  const save = (next: ObjectValue[]) =>
    onChange({ ...node.data, assertions: next });
  // Drafts belong to the assertion, including when it is reordered or removed.
  const reorder = (order: number[]) => {
    const retained: [string, Draft][] = [];
    for (const [key, draft] of Object.entries(drafts)) {
      if (!key.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length),
        separator = suffix.indexOf(":");
      const oldIndex = Number(suffix.slice(0, separator)),
        newIndex = order.indexOf(oldIndex);
      setDraft(key);
      if (newIndex >= 0)
        retained.push([
          `${prefix}${newIndex}${suffix.slice(separator)}`,
          draft,
        ]);
    }
    retained.forEach(([key, draft]) => setDraft(key, draft));
    save(order.map((index) => assertions[index]));
  };
  return (
    <section
      className="form-section assertion-editor"
      aria-label="响应断言配置"
    >
      <h3>响应断言</h3>
      <p className="field-hint">
        按顺序验证每项断言；任一断言失败会使采样失败，并触发线程组的错误策略。表达式与期望值按字面配置，不展开变量。
      </p>
      {node.kind === "http_request" && (
        <InputField
          {...props}
          field={{
            path: "max_assertion_body_bytes",
            label: "断言响应体上限（bytes）",
            placeholder: "默认；null 使用引擎默认值",
            type: "number",
            nullable: true,
            hint: "缺省或 null 使用引擎默认值；超限由引擎报告断言失败，独立于响应预览上限。",
          }}
        />
      )}
      {assertions.map((assertion, index) => {
        const type = (assertion.type ?? "json") as AssertionKind;
        const itemProps: Props = {
          ...props,
          node: { ...node, id: `${prefix}${index}`, data: assertion },
          onChange: (data) =>
            save(assertions.map((item, i) => (i === index ? data : item))),
        };
        const field = (field: Field) => (
          <InputField key={field.path} {...itemProps} field={field} />
        );
        const matcher = object(assertion.matcher) ? assertion.matcher : {};
        const move = (delta: number) => {
          const order = assertions.map((_, i) => i);
          [order[index], order[index + delta]] = [
            order[index + delta],
            order[index],
          ];
          reorder(order);
        };
        return (
          <section
            className={`assertion-card${assertion.enabled === false ? " is-inactive" : ""}`}
            key={index}
            aria-label={`断言 ${index + 1}`}
          >
            <div className="section-line">
              <h4>
                {index + 1}. {assertionLabels[type]}
                {assertion.enabled === false && "（已禁用）"}
              </h4>
              <div>
                <label className="enable-toggle">
                  <input
                    type="checkbox"
                    aria-label={`启用断言 ${index + 1}`}
                    checked={assertion.enabled !== false}
                    onChange={(event) =>
                      itemProps.onChange({
                        ...assertion,
                        enabled: event.target.checked,
                      })
                    }
                  />
                  启用断言
                </label>
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`上移断言 ${index + 1}`}
                  onClick={() => move(-1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === assertions.length - 1}
                  aria-label={`下移断言 ${index + 1}`}
                  onClick={() => move(1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`删除断言 ${index + 1}`}
                  onClick={() =>
                    reorder(
                      assertions.map((_, i) => i).filter((i) => i !== index),
                    )
                  }
                >
                  删除
                </button>
              </div>
            </div>
            <div className="form-grid">
              {field({ path: "name", label: "断言名称", required: true })}
              {type === "regex" ? (
                <>
                  {field({
                    path: "pattern",
                    label: "正文正则表达式",
                    required: true,
                    hint: "Rust regex 语法；默认搜索匹配，可用 ^…$ 匹配全文。",
                  })}
                  {field({
                    path: "invert",
                    label: "反向匹配（不应匹配）",
                    type: "boolean",
                  })}
                </>
              ) : (
                <>
                  {field({
                    path: type === "json" ? "path" : "xpath",
                    label: type === "json" ? "JSONPath" : "XPath",
                    required: true,
                  })}
                  <div className="field">
                    <label htmlFor={`${itemProps.node.id}-matcher`}>
                      匹配方式
                    </label>
                    <select
                      id={`${itemProps.node.id}-matcher`}
                      value={String(matcher.type ?? "")}
                      onChange={(e) => {
                        for (const key of Object.keys(drafts))
                          if (key.startsWith(`${itemProps.node.id}:matcher.`))
                            setDraft(key);
                        const type = e.target.value;
                        itemProps.onChange({
                          ...assertion,
                          matcher:
                            type === "equals"
                              ? {
                                  type,
                                  expected:
                                    assertion.type === "xml" ? "" : null,
                                }
                              : type === "regex"
                                ? { type, pattern: ".*" }
                                : { type },
                        });
                      }}
                    >
                      <option value="equals">等于</option>
                      <option value="regex">正则匹配</option>
                      <option value="exists">存在</option>
                      <option value="not_exists">不存在</option>
                    </select>
                  </div>
                  {field({
                    path: "selection",
                    label: "匹配节点范围",
                    options: [
                      ["one", "恰好一个节点"],
                      ["any", "任一节点匹配"],
                      ["all", "全部节点匹配"],
                    ],
                    hint: "缺省为恰好一个；全部要求非空。存在 / 不存在判断不使用此选项。",
                  })}
                  {matcher.type === "equals" &&
                    field({
                      path: "matcher.expected",
                      label:
                        type === "json" ? "期望值（JSON）" : "期望值（文本）",
                      type: type === "json" ? "json" : "text",
                      required: true,
                      hint:
                        type === "json"
                          ? '保留 JSON 类型，例如 200、"200"、null、对象或数组。'
                          : "按 XPath 字符串值比较，不自动去除空白。",
                    })}
                  {matcher.type === "regex" &&
                    field({
                      path: "matcher.pattern",
                      label: "值正则表达式",
                      required: true,
                    })}
                  {type === "xml" &&
                    field({
                      path: "namespaces",
                      label: "命名空间（JSON 映射）",
                      type: "json",
                      hint: '例如 {"o":"urn:orders"}，XPath 中使用 /o:order。',
                    })}
                </>
              )}
            </div>
          </section>
        );
      })}
      {!assertions.length && <p className="empty-line">尚未配置响应断言</p>}
      <div className="assertion-actions">
        {(["json", "xml", "regex"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => save([...assertions, newAssertion(type)])}
          >
            ＋ 添加{assertionLabels[type]}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function NodeForm(props: Props) {
  const { node, disabled, onChange } = props;
  const render = (field: Field) => (
    <InputField key={field.path} {...props} field={field} />
  );
  const condition = node.data.condition,
    conditionMode =
      typeof condition === "boolean"
        ? "boolean"
        : object(condition)
          ? "json"
          : "text";
  const prefix = node.kind === "plan" ? "defaults" : "settings";
  const body = object(node.data.body) ? node.data.body : { type: "empty" };
  return (
    <fieldset className="node-form" disabled={disabled}>
      <div className="form-section">
        <h3>基本信息</h3>
        <div className="form-grid">
          {render({
            path: "name",
            label: "名称",
            required: node.kind !== "loop" && node.kind !== "http_defaults",
            placeholder: labels[node.kind],
          })}
          <div className="field">
            <label className="enable-toggle">
              <input
                type="checkbox"
                checked={node.data.enabled !== false}
                onChange={(event) =>
                  onChange({ ...node.data, enabled: event.target.checked })
                }
              />
              启用组件
            </label>
            <small>
              禁用时跳过此组件及其子节点；父节点禁用时，子节点也不执行。
            </small>
          </div>
          <div className="field">
            <label>组件类型</label>
            <div className="static-value">{labels[node.kind]}</div>
          </div>
        </div>
      </div>
      {node.kind !== "http_defaults" && (
        <div className="form-section">
          <h3>{node.kind === "plan" ? "测试计划配置" : "组件配置"}</h3>
          {node.kind === "jdbc_connection_configuration" && (
            <p className="field-hint">
              配置可放在测试计划、线程组或控制器下，供所在作用域及其后代的 JDBC
              采样器按“连接变量名”引用。
              配置顺序不影响引用；子作用域的同名配置覆盖外层，同层不允许重名。
            </p>
          )}
          {isJavaScriptProcessor(node.kind) && (
            <p className="field-hint">
              {node.kind === "javascript_preprocessor"
                ? "在父采样器展开参数前执行，可用 vars.put 设置本次请求变量。多个前置处理器按树内顺序执行。"
                : "在父采样器完成后、断言前执行。prev.body / getResponseDataAsString() 读取响应，prev.responseCode / getResponseCode() 读取状态码，prev.success / isSuccessful() 读取采样状态；prev 为只读快照，响应不可用时 body 为 null。"}{" "}
              ctx.getThreadNum()、ctx.getVariables()、vars.getIteration()、sampler.getName()
              和 Label 可用。 log
              日志在父采样器结果详情中查看。处理器失败会使父采样失败，并停止同阶段后续处理器；前置失败时不执行采样器及后置处理器。
            </p>
          )}
          {isExtractor(node.kind) && (
            <p className="field-hint">
              提取父 HTTP 采样器的完整 UTF-8
              响应正文，在断言前按树内顺序执行。结果写入当前用户变量，可供后续
              JavaScript
              或采样器使用。每次执行清理旧值；无匹配使用默认值，格式错误、超时或容量超限使父采样失败。默认值缺省或
              null 表示不设置基础变量，空字符串表示空默认值。
            </p>
          )}
          {isTimer(node.kind) && (
            <p className="field-hint">
              在作用域内每次采样的前置处理器之后、采样开始之前暂停当前用户；多个定时器的延迟累加。放在采样器下仅影响该采样器。等待不计入响应耗时，不生成采样结果，停止可中断等待。支持
              $&#123;变量名&#125; 和 $&#123;__Random(1,100,delay)&#125;
              等函数表达式。
            </p>
          )}
          <div className="form-grid">
            {isExtractor(node.kind) && (
              <>
                {render({
                  path: "variable_name",
                  label: "变量名",
                  required: true,
                  hint: "例如 token；通过 ${token} 访问；token_matchNr 为匹配总数。全部匹配时使用 token_1、token_2……。",
                })}
                {render({
                  path: "expression",
                  label: "提取表达式",
                  type: "code",
                  required: true,
                  hint:
                    node.kind === "xpath2_extractor"
                      ? "XPath 2.0 语法，例如 for $x in //item return upper-case(string($x))。使用 XPath 3.1 引擎，无外部文档/环境变量访问。"
                      : node.kind === "xpath_extractor"
                        ? "XPath 1.0，返回节点字符串值或标量；XML 需格式正确，不支持 HTML 容错。"
                        : node.kind === "jsonpath_extractor"
                          ? "例如 $.items[*].id；字符串原样保存，其他值保存为 JSON 文本。"
                          : node.kind === "jmespath_extractor"
                            ? "例如 items[?active].id；数组结果按元素匹配，null 表示无匹配。"
                            : "Rust 正则表达式；支持捕获组和内联标志，不支持回溯引用或环视。",
                })}
                {render({
                  path: "match_number",
                  label: "匹配序号",
                  type: "integer",
                  hint: "默认 1；正数取第 N 项，0 随机一项，-1 保存全部匹配。",
                })}
                {render({
                  path: "default_value",
                  label: "默认值",
                  hint: "无匹配时使用；重置表示不设置。",
                })}
                {node.kind === "regex_extractor" &&
                  render({
                    path: "template",
                    label: "结果模板",
                    required: true,
                    hint: "$1$ 为第一个捕获组，$0$ 为整个匹配；例如 ID=$1$。分组同时存入 变量_g0、变量_g1……。",
                  })}
                {(node.kind === "xpath_extractor" ||
                  node.kind === "xpath2_extractor") &&
                  render({
                    path: "namespaces",
                    label: "命名空间（JSON）",
                    type: "json",
                    hint: '例如 {"ns":"urn:example"}；表达式中使用 //ns:item。XPath2 可用空前缀指定默认命名空间。',
                  })}
                {render({
                  path: "timeout_ms",
                  label: "提取超时（ms）",
                  type: "number",
                  hint: "默认 1000；范围 1–60000",
                })}
                {render({
                  path: "max_matches",
                  label: "最大匹配数量",
                  type: "number",
                  hint: "默认 1000；超过限制时失败，不保存部分结果。",
                })}
                {render({
                  path: "max_variable_bytes",
                  label: "变量容量（bytes）",
                  type: "number",
                  hint: "默认 1048576；包括当前用户已有变量。",
                })}
              </>
            )}
            {(
              specificFields[
                isJavaScriptProcessor(node.kind) ? "javascript" : node.kind
              ] ?? []
            ).map(render)}
            {node.kind === "plan" && (
              <Pairs {...props} path="variables" label="用户变量" variables />
            )}
            {(node.kind === "if" || node.kind === "while") && (
              <>
                <div className="field">
                  <label htmlFor="condition-mode">条件类型</label>
                  <select
                    id="condition-mode"
                    value={conditionMode}
                    onChange={(e) => {
                      props.setDraft(`${node.id}:condition`);
                      onChange(
                        setValue(
                          node.data,
                          "condition",
                          e.target.value === "boolean"
                            ? true
                            : e.target.value === "json"
                              ? { type: "variable_bool", name: "enabled" }
                              : "${enabled}",
                        ),
                      );
                    }}
                  >
                    <option value="text">变量表达式</option>
                    <option value="boolean">布尔值</option>
                    <option value="json">结构化 JSON 条件</option>
                  </select>
                </div>
                {render({
                  path: "condition",
                  label: "条件",
                  type:
                    conditionMode === "boolean"
                      ? "boolean"
                      : conditionMode === "json"
                        ? "json"
                        : "text",
                  required: true,
                  hint:
                    node.kind === "if"
                      ? "IF：变量和函数表达式展开为 true 时执行，例如 ${__changeCase(TRUE,lower)}。"
                      : "While：空值或 LAST 使用库的采样状态语义；变量和函数表达式展开为 false 时退出。",
                })}
              </>
            )}
            {node.kind === "http_request" && (
              <>
                {render({
                  path: "method",
                  label: "请求方法",
                  options: [
                    "GET",
                    "POST",
                    "PUT",
                    "PATCH",
                    "DELETE",
                    "HEAD",
                    "OPTIONS",
                    "TRACE",
                    "CONNECT",
                  ].map((x) => [x, x]),
                })}
                {render({
                  path: "url",
                  label: "完整 URL",
                  hint: "完整 URL 优先于默认配置中的地址；留空时使用当前作用域继承的协议、主机、端口与路径，并允许下方分项覆盖。",
                })}
              </>
            )}
          </div>
        </div>
      )}
      {node.kind === "http_defaults" && (
        <p className="form-section field-hint">
          作用于所在层级及后代的 HTTP 采样器，不受配置节点放置在采样器前后影响。
          同层多个默认配置按树顺序合并，后者覆盖前者；内层配置与采样器显式设置优先。
          采样器显式设置的请求头、查询参数整组覆盖默认列表，未设置的字段继续继承。
          此组件不发送请求，也不产生采样结果。
        </p>
      )}
      {(node.kind === "plan" ||
        node.kind === "http_request" ||
        node.kind === "http_defaults") && (
        <details className="form-section" open={node.kind !== "plan"}>
          <summary>
            {node.kind === "plan"
              ? "全局 HTTP 默认配置"
              : node.kind === "http_defaults"
                ? "HTTP 默认配置"
                : "地址与请求设置"}
          </summary>
          <div className="form-grid">
            {httpFields.map((f) =>
              render({ ...f, path: `${prefix}.${f.path}` }),
            )}
            <Pairs {...props} path={`${prefix}.headers`} label="请求头" />
            <Pairs {...props} path={`${prefix}.query`} label="查询参数" />
          </div>
        </details>
      )}
      {node.kind === "http_request" && (
        <div className="form-section">
          <h3>请求体</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="body-mode">类型</label>
              <select
                id="body-mode"
                value={String(body.type)}
                onChange={(e) => {
                  props.setDraft(`${node.id}:body.value`);
                  const type = e.target.value;
                  onChange(
                    setValue(
                      node.data,
                      "body",
                      type === "empty"
                        ? { type }
                        : {
                            type,
                            value:
                              type === "text" ? "" : type === "json" ? {} : [],
                          },
                    ),
                  );
                }}
              >
                {[
                  ["empty", "无"],
                  ["text", "文本"],
                  ["json", "JSON"],
                  ["form", "表单"],
                  ["bytes", "字节数组"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            {body.type === "form" ? (
              <Pairs {...props} path="body.value" label="表单参数" />
            ) : (
              body.type !== "empty" &&
              render({
                path: "body.value",
                label: "请求体内容",
                type: body.type === "text" ? "code" : "json",
                required: true,
              })
            )}
          </div>
        </div>
      )}
      {node.kind === "http_request" && (
        <div className="form-section">
          <h3>后置处理器响应输入</h3>
          <div className="form-grid">
            {render({
              path: "max_post_processor_body_bytes",
              label: "完整响应上限（bytes）",
              type: "number",
              hint: "默认 8388608；独立于响应预览与断言。超限时 prev.body 为 null，并提供 bodyUnavailableReason。",
            })}
          </div>
        </div>
      )}
      {(node.kind === "http_request" || node.kind === "jdbc_request") && (
        <AssertionsForm {...props} />
      )}
    </fieldset>
  );
}
