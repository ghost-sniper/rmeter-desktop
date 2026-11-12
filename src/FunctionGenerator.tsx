import { useEffect, useRef, useState, type RefObject } from "react";
import {
  functionDefinitions,
  generateFunction,
  GeneratedFunction,
} from "./functionSyntax";
import "./FunctionGenerator.css";

export default function FunctionGenerator({
  onClose,
  returnFocus,
}: {
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(functionDefinitions[0].name);
  const definition = functionDefinitions.find((item) => item.name === name)!;
  const [values, setValues] = useState(() =>
    definition.parameters.map((parameter) => parameter.initial),
  );
  const [result, setResult] = useState<GeneratedFunction>();
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const revision = useRef(0);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      returnFocus.current?.focus();
    };
  }, [returnFocus]);

  function resetResult() {
    revision.current++;
    setResult(undefined);
    setError("");
    setCopyMessage("");
  }

  async function copy(text: string, label: string) {
    const current = ++revision.current;
    try {
      await navigator.clipboard.writeText(text);
      if (current === revision.current) setCopyMessage(`已复制${label}。`);
    } catch {
      if (current === revision.current)
        setCopyMessage("复制失败，请选中下方内容后手动复制。");
    }
  }

  return (
    <dialog
      ref={dialog}
      className="function-generator"
      aria-labelledby="function-generator-title"
      aria-describedby="function-generator-note"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          (event.ctrlKey || event.metaKey) &&
          ["n", "o", "s"].includes(event.key.toLowerCase())
        )
          event.preventDefault();
      }}
    >
      <header className="function-generator-header">
        <h2 id="function-generator-title">函数生成</h2>
        <button type="button" onClick={onClose} aria-label="关闭函数生成">
          关闭
        </button>
      </header>
      <p id="function-generator-note">
        输入参数，生成可直接复制的调用语法。参数按字面文本处理并自动转义；此处不执行函数。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          resetResult();
          try {
            setResult(generateFunction(name, values));
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        }}
      >
        <label className="function-generator-selector">
          函数
          <select
            autoFocus
            value={name}
            onChange={(event) => {
              const next = functionDefinitions.find(
                (item) => item.name === event.target.value,
              )!;
              setName(next.name);
              setValues(next.parameters.map((parameter) => parameter.initial));
              resetResult();
            }}
          >
            {functionDefinitions.map((item) => (
              <option key={item.name}>{item.name}</option>
            ))}
          </select>
        </label>
        <p className="function-generator-description">
          {definition.description}
        </p>
        <table className="function-parameters" aria-label={`${name} 参数`}>
          <thead>
            <tr>
              <th scope="col">参数</th>
              <th scope="col">值</th>
              <th scope="col">说明</th>
            </tr>
          </thead>
          <tbody>
            {definition.parameters.map((parameter, index) => {
              const id = `function-parameter-${parameter.name}`;
              const props = {
                id,
                value: values[index],
                "aria-describedby": `${id}-hint`,
                onChange: (
                  event: React.ChangeEvent<
                    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
                  >,
                ) => {
                  setValues(
                    values.map((value, position) =>
                      position === index ? event.target.value : value,
                    ),
                  );
                  resetResult();
                },
              };
              return (
                <tr key={parameter.name}>
                  <th scope="row">
                    <label htmlFor={id}>
                      {parameter.label}
                      <small>{parameter.name}</small>
                    </label>
                  </th>
                  <td>
                    {parameter.options ? (
                      <select {...props}>
                        {parameter.options.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <textarea {...props} rows={1} spellCheck={false} />
                    )}
                  </td>
                  <td id={`${id}-hint`}>{parameter.hint}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {error && (
          <p className="function-generator-error" role="alert">
            {error}
          </p>
        )}
        <footer className="function-generator-actions">
          <button type="submit" className="primary">
            生成
          </button>
        </footer>
      </form>
      {result && (
        <section className="function-generator-results" aria-label="生成结果">
          {(
            [
              [
                "expression",
                "函数表达式",
                "用于 HTTP、JDBC、定时器及 IF/While 的可展开字段。",
              ],
              [
                "javascript",
                "JavaScript 调用",
                "用于 JavaScript 采样器、前置处理器和后置处理器；整数参数使用字符串保留精度。",
              ],
            ] as const
          ).map(([key, label, hint]) => (
            <section key={key}>
              <header>
                <label htmlFor={`generated-${key}`}>{label}</label>
                <button
                  type="button"
                  onClick={() => void copy(result[key], label)}
                >
                  复制{label}
                </button>
              </header>
              <textarea
                id={`generated-${key}`}
                readOnly
                value={result[key]}
                rows={2}
                spellCheck={false}
              />
              <p>{hint}</p>
            </section>
          ))}
          <p role="status" className="function-copy-status">
            {copyMessage}
          </p>
        </section>
      )}
    </dialog>
  );
}
