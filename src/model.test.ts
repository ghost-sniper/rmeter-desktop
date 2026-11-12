import extractorExample from "../examples/http-extractors.json";
import timersExample from "../examples/timers.json";
import { extractorKinds, isPostProcessor } from "./model";
import processors from "../examples/javascript-processors.json";
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
  it("round-trips the timer integration example", () => {
    const document = parseDocument(JSON.stringify(timersExample));
    expect(document.issues).toEqual([]);
    expect(serializeNode(document.root)).toEqual(timersExample);
  });
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
  it("protects unsupported assertions and processor types, allows supported arrays", () => {
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
    expect(make([], [{ type: "beanshell" }]).issues.join()).toContain(
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

it.each(["http_request", "jdbc_request", "javascript"] as const)(
  "round trips ordered processors under %s without UI types in native JSON",
  (kind) => {
    const parent = createNode(kind);
    const pre = createNode("javascript_preprocessor");
    const post = createNode("javascript_postprocessor");
    pre.data.enabled = false;
    pre.data.script = "vars.put('value','before');";
    post.data.script = "log.info(prev.body);";
    parent.children = [pre, cloneNode(pre), post];
    const doc = newDocument();
    doc.root.children[0].children = [parent];
    const native = JSON.parse(stringify(doc.root));
    const saved = native.groups[0].children[0];
    expect(saved.children).toBeUndefined();
    expect(saved.pre_processors.map((p: { type: string }) => p.type)).toEqual([
      "javascript",
      "javascript",
    ]);
    expect(saved.pre_processors[0].enabled).toBe(false);
    const parsed = parseDocument(JSON.stringify(native));
    expect(parsed.issues).toEqual([]);
    expect(serializeNode(parsed.root)).toEqual(native);
    const children = parsed.root.children[0].children[0].children;
    expect(children.map((n) => n.kind)).toEqual([
      "javascript_preprocessor",
      "javascript_preprocessor",
      "javascript_postprocessor",
    ]);
    expect(allowed(kind, "javascript_preprocessor")).toBe(true);
    expect(allowed("group", "javascript_preprocessor")).toBe(false);
    expect(allowed("javascript_preprocessor", "javascript_postprocessor")).toBe(
      false,
    );
    const moved = moveNode(
      parsed.root,
      children[0].id,
      parsed.root.children[0].id,
    );
    expect(moved).toBe(parsed.root);
    const reordered = reorderNode(parsed.root, children[1].id, -1);
    expect(reordered.children[0].children[0].children[0].id).toBe(
      children[1].id,
    );
  },
);

it("protects malformed or nested processor arrays and preserves absent versus empty arrays", () => {
  for (const value of [
    null,
    {},
    [{ type: "beanshell" }],
    [{ type: "javascript", name: "nested", script: "", pre_processors: [] }],
  ]) {
    const root = newDocument().root;
    const sampler = createNode("javascript");
    const source = serializeNode(root);
    (source.groups as any[])[0].children = [
      { ...sampler.data, pre_processors: value },
    ];
    expect(parseDocument(JSON.stringify(source)).issues.length).toBeGreaterThan(
      0,
    );
  }
  const root = newDocument().root;
  const sampler = createNode("http_request");
  sampler.data.post_processors = [];
  root.children[0].children = [sampler];
  const saved = serializeNode(parseDocument(stringify(root)).root);
  const data = (saved.groups as any[])[0].children[0];
  expect(data.post_processors).toEqual([]);
  expect(data).not.toHaveProperty("pre_processors");
});

it("opens and saves the processor integration example without loss", () => {
  const doc = parseDocument(JSON.stringify(processors));
  expect(doc.issues).toEqual([]);
  expect(serializeNode(doc.root)).toEqual(processors);
});

it("preserves mixed postprocessor order and permits moving extractors only between HTTP samplers", () => {
  const root = newDocument().root;
  const http = createNode("http_request"),
    other = createNode("http_request"),
    jdbc = createNode("jdbc_request");
  root.children[0].children = [http, other, jdbc];
  const pre = createNode("javascript_preprocessor"),
    js = createNode("javascript_postprocessor");
  http.children = [pre, js, ...extractorKinds.map(createNode)];
  http.children[2].data.enabled = false;
  http.children[3].data.namespaces = { n: "urn:test" };
  http.children[4].data.default_value = null;
  const saved = serializeNode(root);
  const parsed = parseDocument(JSON.stringify(saved));
  expect(parsed.issues).toEqual([]);
  expect(serializeNode(parsed.root)).toEqual(saved);
  const reordered = reorderNode(root, http.children[2].id, -1);
  expect(reordered.children[0].children[0].children[1].kind).toBe(
    "jsonpath_extractor",
  );
  expect(reorderNode(root, js.id, -1)).toBe(root);
  const moved = moveNode(root, http.children[2].id, other.id);
  expect(moved.children[0].children[1].children[0].kind).toBe(
    "jsonpath_extractor",
  );
  expect(moveNode(root, http.children[2].id, jdbc.id)).toBe(root);
  for (const kind of extractorKinds) {
    expect(allowed("http_request", kind)).toBe(true);
    expect(allowed("javascript", kind)).toBe(false);
    expect(allowed("group", kind)).toBe(false);
    expect(isPostProcessor(kind)).toBe(true);
  }
});
it("protects malformed extractor data and illegal sampler placement", () => {
  for (const patch of [
    { namespaces: [] },
    { namespaces: { x: 3 } },
    { match_number: "-1" },
    { default_value: 3 },
    { expression: null },
    { unknown: true },
  ]) {
    const root = newDocument().root,
      http = createNode("http_request"),
      extractor = createNode("xpath_extractor");
    Object.assign(extractor.data, patch);
    http.children = [extractor];
    root.children[0].children = [http];
    expect(parseDocument(stringify(root)).issues.length).toBeGreaterThan(0);
  }
  for (const kind of ["jdbc_request", "javascript"] as const) {
    const root = newDocument().root,
      sampler = createNode(kind);
    sampler.data.post_processors = [
      {
        type: "jsonpath_extractor",
        name: "illegal",
        variable_name: "v",
        expression: "$.id",
      },
    ];
    root.children[0].children = [sampler];
    const source = serializeNode(root);
    (source.groups as any[])[0].children[0].post_processors =
      sampler.data.post_processors;
    expect(parseDocument(JSON.stringify(source)).issues.length).toBeGreaterThan(
      0,
    );
  }
});

it("opens and saves all HTTP extractors in the integration example without loss", () => {
  const doc = parseDocument(JSON.stringify(extractorExample));
  expect(doc.issues).toEqual([]);
  expect(serializeNode(doc.root)).toEqual(extractorExample);
});

it("round-trips scoped and sampler timers without changing values or absent arrays", () => {
  const constant = {
    type: "constant_timer",
    name: "固定",
    delay_ms: "${delay}",
  };
  const gaussian = {
    type: "gaussian_random_timer",
    name: "高斯",
    deviation_ms: 12.5,
    offset_ms: 0,
    enabled: false,
  };
  const source = {
    version: 1,
    name: "计划",
    timers: [constant],
    groups: [
      {
        name: "组",
        children: [
          gaussian,
          { type: "loop", name: "循环", count: 2, children: [constant] },
          {
            type: "http_request",
            name: "HTTP",
            url: "http://localhost",
            timers: [gaussian],
            pre_processors: [],
            post_processors: [],
          },
          {
            type: "jdbc_request",
            name: "SQL",
            connection: "db",
            sql: "SELECT 1",
            timers: [constant],
          },
          { type: "javascript", name: "JS", script: "", timers: [] },
        ],
      },
    ],
  };
  const doc = parseDocument(JSON.stringify(source));
  expect(doc.issues).toEqual([]);
  expect(serializeNode(doc.root)).toEqual(source);
  expect(stringify(cloneNode(doc.root))).toBe(stringify(doc.root));
  expect(serializeNode(newDocument().root)).not.toHaveProperty("timers");
});
it("allows timers in scopes and samplers but not under processors or configuration leaves", () => {
  for (const kind of ["constant_timer", "gaussian_random_timer"] as const) {
    for (const parent of [
      "plan",
      "group",
      "loop",
      "if",
      "while",
      "http_request",
      "jdbc_request",
      "javascript",
    ] as const)
      expect(allowed(parent, kind)).toBe(true);
    for (const parent of [
      "http_defaults",
      "jdbc_connection_configuration",
      "javascript_preprocessor",
      "jsonpath_extractor",
      kind,
    ] as const)
      expect(allowed(parent, kind)).toBe(false);
  }
  const root = newDocument().root,
    group = root.children[0];
  const sampler = createNode("http_request"),
    pre = createNode("javascript_preprocessor"),
    timer = createNode("constant_timer"),
    post = createNode("javascript_postprocessor");
  sampler.children = [pre, timer, post];
  group.children = [sampler];
  expect(reorderNode(root, timer.id, -1)).toBe(root);
  expect(reorderNode(root, timer.id, 1)).toBe(root);
  const moved = moveNode(root, timer.id, group.id);
  expect(moved.children[0].children.map((n) => n.kind)).toEqual([
    "http_request",
    "constant_timer",
  ]);
  expect(reorderNode(moved, timer.id, -1).children[0].children[0].kind).toBe(
    "constant_timer",
  );
});
it("protects malformed timer lists and processors misplaced in timer arrays", () => {
  for (const timers of [
    null,
    {},
    [{ type: "javascript", name: "wrong", script: "" }],
    [{ type: "constant_timer", name: "bad", delay_ms: null }],
  ]) {
    const source = {
      version: 1,
      name: "p",
      groups: [
        { name: "g", children: [{ type: "http_request", name: "h", timers }] },
      ],
    };
    expect(parseDocument(JSON.stringify(source)).issues.length).toBeGreaterThan(
      0,
    );
  }
  const source = {
    version: 1,
    name: "p",
    groups: [
      {
        name: "g",
        children: [
          {
            type: "http_request",
            name: "h",
            post_processors: [
              { type: "constant_timer", name: "bad", delay_ms: 0 },
            ],
          },
        ],
      },
    ],
  };
  expect(parseDocument(JSON.stringify(source)).issues.length).toBeGreaterThan(
    0,
  );
});

it("round trips optional per-round timeouts without upgrading version 1", () => {
  for (const kind of ["loop", "while"] as const) {
    const root = newDocument().root;
    const node = createNode(kind);
    root.children[0].children.push(node);
    for (const timeout of [undefined, 0, 1234]) {
      if (timeout === undefined) delete node.data.timeout_ms;
      else node.data.timeout_ms = timeout;
      const source = stringify(root),
        parsed = parseDocument(source);
      expect(parsed.issues).toEqual([]);
      expect(stringify(parsed.root)).toBe(source);
      expect(JSON.parse(source).version).toBe(1);
    }
  }
});

it.each([null, -1, 1.5, 9007199254740992, "${timeout}"])(
  "protects invalid imported timeout %s",
  (timeout) => {
    const root = newDocument().root;
    const node = createNode("loop");
    node.data.timeout_ms = timeout;
    root.children[0].children.push(node);
    expect(parseDocument(stringify(root)).issues.join()).toContain(
      "timeout_ms",
    );
  },
);
