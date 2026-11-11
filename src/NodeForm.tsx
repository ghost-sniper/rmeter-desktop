import { useId } from "react";
import {
  EditorNode,
  Json,
  ObjectValue,
  getValue,
  setValue,
  labels,
  object,
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
  type?: "number" | "text" | "password" | "code" | "json" | "boolean" | "count";
  hint?: string;
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
  loop: [
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
    { path: "result_variable", label: "结果变量" },
    { path: "row_count_variable", label: "行数变量" },
  ],
  javascript: [
    {
      path: "script",
      label: "JavaScript",
      type: "code",
      required: true,
      hint: "vars.get / put / remove / contains；ctx.groupName / userIndex / iteration / lastSampleOk。不提供浏览器、Node.js 或异步 I/O。",
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
    if (!text && !field.required) {
      change(undefined);
      return;
    }
    if (
      field.type === "json" ||
      field.type === "number" ||
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
          (!text.trim() || !Number.isSafeInteger(next) || Number(next) < 0)
        )
          throw Error("请输入非负安全整数");
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
              field.type === "count"
                ? "1 或 infinite"
                : field.nullable
                  ? "默认；null 为禁用/无限"
                  : "未设置"
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
          {node.kind !== "loop" &&
            render({ path: "name", label: "名称", required: true })}
          <div className="field">
            <label>组件类型</label>
            <div className="static-value">{labels[node.kind]}</div>
          </div>
        </div>
      </div>
      <div className="form-section">
        <h3>{node.kind === "plan" ? "测试计划配置" : "组件配置"}</h3>
        <div className="form-grid">
          {(specificFields[node.kind] ?? []).map(render)}
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
                    ? "IF：表达式展开为 true 时执行，不执行 JavaScript / JMeter 函数。"
                    : "While：空值或 LAST 使用库的采样状态语义；其他表达式展开为 false 时退出。",
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
                hint: "设置后使用完整 URL；留空时使用下方分项地址",
              })}
            </>
          )}
        </div>
      </div>
      {(node.kind === "plan" || node.kind === "http_request") && (
        <details className="form-section" open={node.kind === "http_request"}>
          <summary>
            {node.kind === "plan" ? "HTTP 默认配置" : "地址与请求设置"}
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
    </fieldset>
  );
}
