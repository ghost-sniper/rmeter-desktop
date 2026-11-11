import { describe, expect, it } from "vitest";
import allComponents from "../examples/mock-jdbc-all-components.json";
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
} from "./model";

describe("native script model", () => {
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
  it.each(["http_defaults", "sequence", "controller", "other"])(
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
  it("protects nonempty assertions and post processors, allows empty arrays", () => {
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
