import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import JavaScriptEditor from "./JavaScriptEditor";

function Harness({
  initial = "",
  disabled = false,
}: {
  initial?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="script">代码</label>
      <JavaScriptEditor
        id="script"
        value={value}
        onChange={setValue}
        kind="javascript"
        disabled={disabled}
      />
    </>
  );
}

it("filters, navigates and accepts suggestions while keeping the caret in arguments", () => {
  render(<Harness />);
  const input = screen.getByRole("textbox", {
    name: "代码",
  }) as HTMLTextAreaElement;
  input.focus();
  fireEvent.change(input, { target: { value: "vars." } });
  expect(
    screen.getByRole("listbox", { name: "JavaScript 补全建议" }),
  ).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
    "put",
  );
  fireEvent.keyDown(input, { key: "Tab" });
  expect(input).toHaveValue("vars.put()");
  expect(input.selectionStart).toBe(9);
  expect(input).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("supports explicit completion, mouse insertion and Escape without changing code", () => {
  render(<Harness />);
  const input = screen.getByRole("textbox");
  fireEvent.keyDown(input, { key: " ", code: "Space", ctrlKey: true });
  const option = screen.getByRole("option", { name: /^functions/ });
  fireEvent.mouseDown(option);
  fireEvent.click(option);
  expect(input).toHaveValue("functions.");
  fireEvent.keyDown(input, { key: " ", code: "Space", ctrlKey: true });
  expect(screen.getAllByRole("option")).toHaveLength(5);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue("functions.");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("does not intercept composition Enter or show suggestions inside strings", () => {
  render(<Harness />);
  const input = screen.getByRole("textbox");
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "vars.p" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
  expect(input).toHaveValue("vars.p");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  fireEvent.compositionEnd(input);
  fireEvent.change(input, { target: { value: "'vars.p" } });
  fireEvent.keyDown(input, { key: " ", code: "Space", ctrlKey: true });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("dismisses on caret movement, blur, scroll, disabled state and external value changes", () => {
  const view = render(
    <JavaScriptEditor
      id="script"
      value="vars."
      onChange={() => {}}
      kind="javascript"
      disabled={false}
    />,
  );
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  const open = () => {
    input.setSelectionRange(5, 5);
    fireEvent.keyDown(input, { key: " ", code: "Space", ctrlKey: true });
  };
  open();
  fireEvent.keyDown(input, { key: "ArrowLeft" });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  open();
  fireEvent.blur(input);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  open();
  fireEvent.scroll(window);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  open();
  view.rerender(
    <JavaScriptEditor
      id="script"
      value="vars."
      onChange={() => {}}
      kind="javascript"
      disabled
    />,
  );
  expect(input).toBeDisabled();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  view.rerender(
    <JavaScriptEditor
      id="script"
      value="other"
      onChange={() => {}}
      kind="javascript"
      disabled={false}
    />,
  );
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("replaces a partial identifier in the middle without duplicating parentheses", () => {
  render(<Harness initial={'vars.get("key");'} />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  input.setSelectionRange(7, 7);
  fireEvent.keyDown(input, { key: " ", code: "Space", ctrlKey: true });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue('vars.get("key");');
  expect(input.selectionStart).toBe(8);
});
