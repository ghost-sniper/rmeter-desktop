import { expect, it } from "vitest";
import { generateFunction } from "./functionSyntax";

it.each([
  ["RandomString", ["16", "", ""], "${__RandomString(16)}"],
  [
    "changeCase",
    ["hello", "LOWER", "result"],
    "${__changeCase(hello,LOWER,result)}",
  ],
  [
    "dateTimeConvert",
    ["0", "", "yyyy-MM-dd", ""],
    "${__dateTimeConvert(0,,yyyy-MM-dd)}",
  ],
  [
    "Random",
    ["-9223372036854775808", "9223372036854775807", ""],
    "${__Random(-9223372036854775808,9223372036854775807)}",
  ],
  [
    "RandomDate",
    ["", "", "2030-01-01", "", "day"],
    "${__RandomDate(,,2030-01-01,,day)}",
  ],
])(
  "generates %s with positional empty arguments and exact JS strings",
  (name, values, expression) => {
    const result = generateFunction(name, values);
    expect(result.expression).toBe(expression);
    const actual = new Function("functions", `return ${result.javascript}`)({
      [name]: (...args: string[]) => args,
    });
    const expected = [...values];
    while (expected.length > 1 && expected[expected.length - 1] === "")
      expected.pop();
    expect(actual).toEqual(expected);
  },
);

it("escapes literal delimiters, variables, quotes, newlines and Unicode", () => {
  const text = 'a,b(c)\\${name}"\n你好😀';
  const result = generateFunction("changeCase", [text, "", ""]);
  expect(result.expression).toBe(
    '${__changeCase(a\\,b\\(c\\)\\\\\\${name}"\n你好😀)}',
  );
  expect(
    new Function("functions", `return ${result.javascript}`)({
      changeCase: (value: string) => value,
    }),
  ).toBe(text);
});

it("keeps required empty arguments and optional placeholders", () => {
  expect(
    generateFunction("dateTimeConvert", ["0", "", "", ""]).expression,
  ).toBe("${__dateTimeConvert(0,,)}");
  expect(generateFunction("RandomString", ["0", "", "id"]).javascript).toBe(
    'functions.RandomString("0", "", "id")',
  );
  expect(generateFunction("changeCase", ["", "", ""]).javascript).toBe(
    'functions.changeCase("")',
  );
});

it.each([
  ["Random", ["1", "0", ""]],
  ["Random", ["0", "9223372036854775808", ""]],
  ["Random", ["-9223372036854775809", "0", ""]],
  ["Random", ["1.5", "2", ""]],
  ["RandomString", ["262145", "", ""]],
  ["RandomString", ["-1", "", ""]],
  ["RandomString", ["", "", ""]],
  ["RandomDate", ["", "", "", "", ""]],
  ["dateTimeConvert", ["not a timestamp", "", "yyyy", ""]],
])("rejects invalid %s arguments %j", (name, values) => {
  expect(() => generateFunction(name, values)).toThrow();
});

it("rejects expressions that exceed the runtime limit after escaping", () => {
  expect(() =>
    generateFunction("changeCase", [",".repeat(524288), "", ""]),
  ).toThrow("1 MiB");
});
