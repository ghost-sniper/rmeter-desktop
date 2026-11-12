import { expect, it } from "vitest";
import { getCompletions, insertCompletion } from "./javascriptCompletions";

it("suggests runtime members and includes signatures for all five functions", () => {
  const result = getCompletions("const value = functions.", 24, "javascript")!;
  expect(result.items.map((item) => item.name)).toEqual([
    "RandomString",
    "changeCase",
    "dateTimeConvert",
    "Random",
    "RandomDate",
  ]);
  expect(
    result.items.find((item) => item.name === "dateTimeConvert")?.signature,
  ).toBe("dateTimeConvert(text, sourceFormat, targetFormat, variableName?)");
  expect(
    getCompletions("vars.ge", 7, "javascript")?.items.map((item) => item.name),
  ).toEqual(["get", "getIteration"]);
});

it("offers prev only in postprocessors and never offers browser or Node APIs", () => {
  for (const kind of [
    "javascript",
    "javascript_preprocessor",
    "javascript_postprocessor",
  ] as const) {
    const names = getCompletions("", 0, kind, true)!.items.map(
      (item) => item.name,
    );
    expect(names.includes("prev")).toBe(kind === "javascript_postprocessor");
    expect(!!getCompletions("prev.", 5, kind)).toBe(
      kind === "javascript_postprocessor",
    );
    for (const name of ["console", "window", "document", "fetch", "require"])
      expect(names).not.toContain(name);
  }
});

it.each([
  "'vars.",
  '"vars.',
  "`text ${vars.",
  "// vars.",
  "/* vars.",
  "const pattern = /vars.",
  "return /vars.",
  "object.vars.",
  "unknown.",
  "constructor.",
  "myvars.",
])("does not suggest in non-code or unknown context %s", (text) => {
  expect(getCompletions(text, text.length, "javascript", true)).toBeUndefined();
});

it.each([
  "// comment\nvars.",
  "/* comment */ vars.",
  "'closed'; vars.",
  "const n = 4 / 2; vars.",
  "const pattern = /[a-z/]+/; vars.",
  "ctx?.",
])("resumes after literals and comments: %s", (text) => {
  expect(
    getCompletions(text, text.length, "javascript")?.items.length,
  ).toBeGreaterThan(0);
});

it("replaces the identifier at the caret, preserving existing arguments and following code", () => {
  const source = 'const 名称 = vars.get("key");\nlog.info(名称);';
  const caret = source.indexOf("get") + 2;
  const query = getCompletions(source, caret, "javascript")!;
  const result = insertCompletion(
    query,
    query.items.find((item) => item.name === "get")!,
  );
  expect(result.value).toBe(source);
  expect(result.caret).toBe(source.indexOf("get") + 3);
});

it("places the caret inside method arguments and after parameterless calls", () => {
  const query = getCompletions("vars.p", 6, "javascript")!;
  expect(insertCompletion(query, query.items[0])).toEqual({
    value: "vars.put()",
    caret: 9,
  });
  const empty = getCompletions("ctx.getThread", 13, "javascript")!;
  const result = insertCompletion(empty, empty.items[0]);
  expect(result).toEqual({ value: "ctx.getThreadNum()", caret: 18 });
  const object = getCompletions("fun", 3, "javascript")!;
  expect(insertCompletion(object, object.items[0])).toEqual({
    value: "functions.",
    caret: 10,
  });
});
