interface Parameter {
  name: string;
  label: string;
  hint: string;
  initial: string;
  options?: string[];
}

interface FunctionDefinition {
  name: string;
  description: string;
  minimumArguments: number;
  parameters: Parameter[];
}

const variable: Parameter = {
  name: "variableName",
  label: "结果变量名",
  hint: "可选；非空时将结果写入当前用户变量。",
  initial: "",
};

export const functionDefinitions: FunctionDefinition[] = [
  {
    name: "RandomString",
    description: "生成指定长度的随机字符串。",
    minimumArguments: 1,
    parameters: [
      {
        name: "length",
        label: "长度",
        hint: "必填；0～262144，按 UTF-16 单元计数。",
        initial: "16",
      },
      {
        name: "chars",
        label: "字符集",
        hint: "可选；留空使用默认字符集，可能包含控制字符。",
        initial: "abcdef0123456789",
      },
      variable,
    ],
  },
  {
    name: "changeCase",
    description: "转换文本大小写；CAPITALIZE 只转换首字符。",
    minimumArguments: 1,
    parameters: [
      {
        name: "text",
        label: "文本",
        hint: "待转换文本，可以为空。",
        initial: "hello",
      },
      {
        name: "mode",
        label: "转换方式",
        hint: "默认 UPPER（大写）；LOWER 为小写。",
        initial: "UPPER",
        options: ["UPPER", "LOWER", "CAPITALIZE"],
      },
      variable,
    ],
  },
  {
    name: "dateTimeConvert",
    description: "使用 Java 日期模式转换格式，例如 yyyy-MM-dd HH:mm:ss。",
    minimumArguments: 3,
    parameters: [
      {
        name: "text",
        label: "日期文本",
        hint: "需要与源格式匹配；源格式为空时填写 Unix 毫秒时间戳。",
        initial: "2026-11-12 14:30:45",
      },
      {
        name: "sourceFormat",
        label: "源格式",
        hint: "留空表示输入为 Unix 毫秒时间戳。",
        initial: "yyyy-MM-dd HH:mm:ss",
      },
      {
        name: "targetFormat",
        label: "目标格式",
        hint: "例如 dd/MM/yyyy；留空时结果为空字符串。",
        initial: "dd/MM/yyyy",
      },
      variable,
    ],
  },
  {
    name: "Random",
    description: "生成包含上下限的随机整数，支持完整有符号 64 位范围。",
    minimumArguments: 2,
    parameters: [
      {
        name: "min",
        label: "最小值",
        hint: "必填；十进制整数，最小为 -9223372036854775808。",
        initial: "1",
      },
      {
        name: "max",
        label: "最大值",
        hint: "必填；不得小于最小值，最大为 9223372036854775807。",
        initial: "100",
      },
      variable,
    ],
  },
  {
    name: "RandomDate",
    description: "按日生成随机日期，包含起始日期，不包含结束日期。",
    minimumArguments: 3,
    parameters: [
      {
        name: "format",
        label: "日期格式",
        hint: "同时用于起止日期和结果；留空默认为 yyyy-MM-dd。",
        initial: "yyyy-MM-dd",
      },
      {
        name: "start",
        label: "起始日期",
        hint: "留空默认为运行当天。",
        initial: "",
      },
      {
        name: "end",
        label: "结束日期",
        hint: "必填；必须晚于起始日期，并与日期格式匹配。",
        initial: "",
      },
      {
        name: "locale",
        label: "地区语言",
        hint: "可选，例如 zh_CN、en_US；留空使用系统语言。",
        initial: "",
      },
      variable,
    ],
  },
];

export interface GeneratedFunction {
  expression: string;
  javascript: string;
}

function integer(value: string, label: string): bigint {
  if (!/^[+-]?\d+$/.test(value.trim()))
    throw Error(`${label}必须是十进制整数。`);
  const number = BigInt(value.trim());
  if (number < -9223372036854775808n || number > 9223372036854775807n)
    throw Error(`${label}超出有符号 64 位整数范围。`);
  return number;
}

export function generateFunction(
  name: string,
  values: string[],
): GeneratedFunction {
  const definition = functionDefinitions.find((item) => item.name === name);
  if (!definition || values.length !== definition.parameters.length)
    throw Error("函数或参数数量无效。");
  const byteLength = (value: string) => new TextEncoder().encode(value).length;
  if (values.some((value) => byteLength(value) > 1048576))
    throw Error("单个参数不能超过 1 MiB。");
  if (name === "RandomString") {
    const length = integer(values[0], "长度");
    if (length < 0n || length > 262144n)
      throw Error("长度必须在 0～262144 之间。");
  }
  if (
    name === "Random" &&
    integer(values[0], "最小值") > integer(values[1], "最大值")
  )
    throw Error("最大值不能小于最小值。");
  if (name === "dateTimeConvert" && values[1] === "")
    integer(values[0], "时间戳");
  if (name === "RandomDate" && !values[2].trim())
    throw Error("请填写结束日期。");
  if (
    name === "changeCase" &&
    !["", "UPPER", "LOWER", "CAPITALIZE"].includes(values[1].toUpperCase())
  )
    throw Error("转换方式必须是 UPPER、LOWER 或 CAPITALIZE。");

  const args = [...values];
  while (
    args.length > definition.minimumArguments &&
    args[args.length - 1] === ""
  )
    args.pop();
  // Match rmeter's argument escaping, including literal ${...} text.
  const escaped = args.map((value) => value.replace(/[\\(),$]/g, "\\$&"));
  const result = {
    expression: `\${__${name}(${escaped.join(",")})}`,
    // Strings preserve the full i64 range and are accepted by every JS binding.
    javascript: `functions.${name}(${args.map((value) => JSON.stringify(value)).join(", ")})`,
  };
  if (byteLength(result.expression) > 1048576)
    throw Error("生成的表达式不能超过 1 MiB。");
  return result;
}
