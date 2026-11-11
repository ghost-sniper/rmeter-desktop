import { describe, expect, it } from "vitest";
import allComponents from "../examples/mock-jdbc-all-components.json";
import jdbcScopes from "../examples/jdbc-scopes.json";
import httpScopes from "../examples/http-defaults-scopes.json";
import {
  allowed,
  cloneNode,
  createNode,
  flatten,
  moveNode,
  newDocument,
  parseDocument,
  reorderNode,
  serializeNode,
  setValue,
  stringify,
  title,
} from "./model";

describe("native script model", () => {
  it("preserves enabled flags, disabled subtrees and assertions across save and copy", () => {
    const source = structuredClone(httpScopes);
    const root = parseDocument(JSON.stringify(source)).root;
    for (const [index, node] of flatten(root).entries())
      node.data.enabled = index % 2 === 0;
    const request = flatten(root).find((node) => node.kind === "http_request")!;
    (request.data.assertions as { enabled?: boolean }[])[0].enabled = false;
    const saved = stringify(root);
    const reopened = parseDocument(saved);
    expect(reopened.issues).toEqual([]);
    expect(stringify(reopened.root)).toBe(saved);
    expect(stringify(cloneNode(reopened.root))).toBe(saved);
    for (const invalid of [null, 0, "false"]) {
      root.data.enabled = invalid;
      expect(parseDocument(stringify(root)).issues.join()).toContain("enabled");
    }
  });
  it("round trips JDBC result mappings and protects malformed column lists", () => {
    const root = newDocument().root;
    const node = createNode("jdbc_request");
    Object.assign(node.data, {
      result_variable: "rows",
      variable_names: ["id", "", "name", ""],
      row_count_variable: "count",
    });
    root.children[0].children.push(node);
    const source = stringify(root);
    const reopened = parseDocument(source);
    expect(reopened.issues).toEqual([]);
    expect(stringify(reopened.root)).toBe(source);
    for (const invalid of ["id,name", [1], null]) {
      node.data.variable_names = invalid;
      expect(parseDocument(stringify(root)).issues.join()).toContain(
        "variable_names",
      );
    }
  });
  it("preserves optional Loop and HTTP defaults names across save, reopen and copy", () => {
    for (const kind of ["loop", "http_defaults"] as const) {
      for (const name of [undefined, null, "订单 / 自定义名称"]) {
        const root = newDocument().root;
        const node = createNode(kind);
        if (name === undefined) delete node.data.name;
        else node.data.name = name;
        root.children[0].children.push(node);
        const source = stringify(root);
        const reopened = parseDocument(source);
        expect(reopened.issues).toEqual([]);
        expect(stringify(reopened.root)).toBe(source);
        const restored = reopened.root.children[0].children[0];
        expect(title(restored)).toBe(
          name ?? (kind === "loop" ? "Loop 循环" : "HTTP 默认配置"),
        );
        expect(serializeNode(cloneNode(restored))).toEqual(
          serializeNode(restored),
        );
      }
    }
  });
  it("round trips standalone HTTP defaults without inventing sampler children", () => {
    const document = parseDocument(JSON.stringify(httpScopes));
    expect(document.issues).toEqual([]);
    expect(JSON.parse(stringify(document.root))).toEqual(httpScopes);
    const config = createNode("http_defaults");
    expect(config.data).toEqual({
      type: "http_defaults",
      name: "HTTP 默认配置",
      settings: {},
    });
    for (const kind of ["group", "loop", "if", "while"] as const)
      expect(allowed(kind, "http_defaults")).toBe(true);
    expect(allowed("http_request", "http_defaults")).toBe(false);
    expect(allowed("plan", "http_defaults")).toBe(false);
    expect(createNode("http_request").data).not.toHaveProperty("url");
    const source = structuredClone(httpScopes);
    Object.assign(source.groups[0].children[0], { children: [config.data] });
    expect(parseDocument(JSON.stringify(source)).issues.join()).toContain(
      "children",
    );
  });
  it("round trips JDBC scopes and accepts configurations only in supported parents", () => {
    const document = parseDocument(JSON.stringify(jdbcScopes));
    expect(document.issues).toEqual([]);
    expect(JSON.parse(stringify(document.root))).toEqual(jdbcScopes);
    for (const parent of ["plan", "group", "loop", "if", "while"] as const)
      expect(allowed(parent, "jdbc_connection_configuration")).toBe(true);
    for (const parent of [
      "http_request",
      "jdbc_request",
      "javascript",
      "jdbc_connection_configuration",
    ] as const)
      expect(allowed(parent, "jdbc_connection_configuration")).toBe(false);
  });
  it("opens and losslessly saves the real mock/JDBC acceptance script with all eight components", () => {
    const document = parseDocument(JSON.stringify(allComponents));
    expect(document.issues).toEqual([]);
    expect(JSON.parse(stringify(document.root))).toEqual(allComponents);
    expect(new Set(flatten(document.root).map((node) => node.kind))).toEqual(
      new Set([
        "plan",
        "group",
        "loop",
        "if",
        "while",
        "http_request",
        "jdbc_request",
        "javascript",
        "jdbc_connection_configuration",
      ]),
    );
    expect(stringify(document.root)).not.toContain('"password":');
  });
  it("protects unsafe numbers, malformed pair rows, and unknown nested settings", () => {
    const make = (settings: unknown) =>
      parseDocument(
        JSON.stringify({
          version: 1,
          name: "t",
          groups: [
            {
              name: "g",
              children: [{ type: "http_request", name: "h", settings }],
            },
          ],
        }),
      );
    expect(
      make({ headers: [["X", "a", "unexpected"]] }).issues.length,
    ).toBeGreaterThan(0);
    expect(make({ custom: true }).issues.length).toBeGreaterThan(0);
    expect(
      make({ max_redirects: 9007199254740992 }).issues.length,
    ).toBeGreaterThan(0);
    expect(
      parseDocument(
        '{"version":1,"name":"t","groups":[{"name":"g","children":[{"type":"constructor"}]}]}',
      ).issues.length,
    ).toBeGreaterThan(0);
  });
  it("round trips nested components, optional nulls and duplicate headers without editor metadata", () => {
    const script = {
      version: 1,
      name: "示例",
      defaults: { connect_timeout_ms: null },
      variables: { enabled: "true" },
      jdbc_connections: [
        {
          name: "全局数据库",
          variable_name: "db",
          url: "postgresql://localhost/test",
        },
      ],
      groups: [
        {
          name: "用户",
          children: [
            {
              type: "loop",
              count: 2,
              children: [
                {
                  type: "http_request",
                  name: "请求",
                  url: "http://localhost",
                  settings: {
                    headers: [
                      ["X-A", "1"],
                      ["X-A", "2"],
                    ],
                    request_timeout_ms: 5000,
                  },
                  body: { type: "json", value: { id: 42 } },
                },
              ],
            },
          ],
        },
      ],
    };
    const doc = parseDocument(JSON.stringify(script));
    expect(doc.issues).toEqual([]);
    expect(JSON.parse(stringify(doc.root))).toEqual(script);
    expect(stringify(doc.root)).not.toContain('"id": "');
  });
  it("does not convert absent fields into null or defaults", () => {
    const doc = parseDocument('{"version":1,"name":"test","groups":[]}');
    expect(serializeNode(doc.root)).toEqual({
      version: 1,
      name: "test",
      groups: [],
    });
    const data = setValue(
      { settings: { connect_timeout_ms: null } },
      "settings.request_timeout_ms",
      42,
    );
    expect(data).toEqual({
      settings: { connect_timeout_ms: null, request_timeout_ms: 42 },
    });
    expect(setValue(data, "settings.request_timeout_ms", undefined)).toEqual({
      settings: { connect_timeout_ms: null },
    });
  });
  it.each(["sequence", "controller", "other"])(
    "opens unsupported %s read-only",
    (type) => {
      const source = JSON.stringify({
        version: 1,
        name: "test",
        groups: [{ name: "g", children: [{ type }] }],
      });
      const doc = parseDocument(source);
      expect(doc.issues.length).toBeGreaterThan(0);
      expect(doc.source).toBe(source);
    },
  );
  it("protects unsupported assertions and post processors, allows empty arrays", () => {
    const make = (assertions: unknown[], post_processors: unknown[]) =>
      parseDocument(
        JSON.stringify({
          version: 1,
          name: "t",
          groups: [
            {
              name: "g",
              children: [
                {
                  type: "http_request",
                  name: "h",
                  assertions,
                  post_processors,
                },
              ],
            },
          ],
        }),
      );
    expect(make([], []).issues).toEqual([]);
    expect(make([{ type: "json" }], []).issues.join()).toContain("assertions");
    expect(make([], [{ type: "javascript" }]).issues.join()).toContain(
      "post_processors",
    );
  });
  it("round trips all supported assertions, legacy JSON and null expectations", () => {
    const assertions = [
      {
        type: "json",
        name: "null",
        path: "$.value",
        matcher: { type: "equals", expected: null },
      },
      {
        name: "legacy",
        path: "$.items[*]",
        selection: "any",
        matcher: { type: "regex", pattern: "ready" },
      },
      {
        type: "xml",
        name: "xml",
        xpath: "/o:order",
        namespaces: { o: "urn:orders" },
        selection: "all",
        matcher: { type: "exists" },
      },
      { type: "regex", name: "no errors", pattern: "ERROR", invert: true },
    ];
    const source = {
      version: 1,
      name: "test",
      groups: [
        {
          name: "g",
          children: [
            {
              type: "http_request",
              name: "http",
              url: "http://localhost",
              assertions,
            },
            {
              type: "jdbc_request",
              name: "db",
              connection: "db",
              sql: "SELECT 1",
              assertions,
            },
          ],
        },
      ],
    };
    const document = parseDocument(JSON.stringify(source));
    expect(document.issues).toEqual([]);
    expect(JSON.parse(stringify(document.root))).toEqual(source);
    for (const invalid of [
      { ...assertions[0], extra: true },
      { ...assertions[0], matcher: { type: "future" } },
      { ...assertions[0], matcher: { type: ["exists"] } },
      { ...assertions[0], selection: ["one"] },
      {
        ...assertions[0],
        matcher: { type: "equals", expected: 1, extra: true },
      },
      { ...assertions[2], namespaces: [] },
      { ...assertions[2], matcher: { type: "equals", expected: 42 } },
      { ...assertions[3], invert: null },
      { ...assertions[3], type: "javascript" },
    ]) {
      const script = structuredClone(source);
      script.groups[0].children[0].assertions = [invalid] as typeof assertions;
      expect(
        parseDocument(JSON.stringify(script)).issues.length,
      ).toBeGreaterThan(0);
    }
  });
  it("treats malformed and future documents as read-only", () => {
    expect(parseDocument("{oops").issues.length).toBeGreaterThan(0);
    expect(
      parseDocument('{"version":2,"groups":[]}').issues.length,
    ).toBeGreaterThan(0);
    expect(
      parseDocument('{"version":1,"groups":null}').issues.length,
    ).toBeGreaterThan(0);
  });
  it("copies subtrees with new ids and rejects cycles and invalid parents", () => {
    const root = newDocument().root,
      group = root.children[0],
      loop = createNode("loop"),
      request = createNode("http_request");
    loop.children.push(request);
    group.children.push(loop);
    const copy = cloneNode(loop);
    expect(copy.id).not.toBe(loop.id);
    expect(copy.children[0].id).not.toBe(request.id);
    expect(moveNode(root, loop.id, request.id)).toBe(root);
    expect(moveNode(root, group.id, loop.id)).toBe(root);
    expect(moveNode(root, request.id, root.id)).toBe(root);
    const moved = moveNode(root, request.id, group.id);
    expect(moved.children[0].children.map((n) => n.id)).toEqual([
      loop.id,
      request.id,
    ]);
    expect(moved.children[0].children[0].children).toHaveLength(0);
    expect(flatten(root)).toHaveLength(4);
    expect(reorderNode(moved, request.id, -1).children[0].children[0].id).toBe(
      request.id,
    );
    expect(allowed("plan", "jdbc_connection_configuration")).toBe(true);
    expect(allowed("http_request", "loop")).toBe(false);
  });
});
