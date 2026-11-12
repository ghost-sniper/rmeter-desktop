import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CompletionQuery,
  getCompletions,
  insertCompletion,
  ScriptKind,
} from "./javascriptCompletions";
import "./JavaScriptEditor.css";

// Mirror textarea wrapping to anchor the popup at the caret, including scrolling.
function caretPosition(input: HTMLTextAreaElement) {
  const rect = input.getBoundingClientRect(),
    style = getComputedStyle(input);
  const mirror = document.createElement("div");
  for (const key of [
    "font",
    "letter-spacing",
    "line-height",
    "padding",
    "border-width",
    "box-sizing",
    "tab-size",
    "text-indent",
  ])
    mirror.style.setProperty(key, style.getPropertyValue(key));
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    width: `${input.clientWidth}px`,
  });
  mirror.textContent = input.value.slice(0, input.selectionStart);
  const marker = document.createElement("span");
  marker.textContent = input.value.slice(input.selectionStart) || ".";
  mirror.append(marker);
  document.body.append(mirror);
  const x = rect.left + marker.offsetLeft - input.scrollLeft;
  const y = rect.top + marker.offsetTop - input.scrollTop;
  const line = parseFloat(style.lineHeight) || 20;
  mirror.remove();
  const width = Math.min(560, window.innerWidth - 16);
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y + line + 4, window.innerHeight - 280)),
    width,
  };
}

export default function JavaScriptEditor({
  id,
  value,
  onChange,
  kind,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  kind: ScriptKind;
  disabled: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const composing = useRef(false),
    pendingCaret = useRef<number | undefined>(undefined);
  const listId = useId(),
    hintId = useId();
  const [query, setQuery] = useState<CompletionQuery>();
  const [selected, setSelected] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 560 });
  const visible = !disabled && query?.source === value ? query : undefined;

  useLayoutEffect(() => {
    if (pendingCaret.current !== undefined && input.current) {
      input.current.focus();
      input.current.setSelectionRange(
        pendingCaret.current,
        pendingCaret.current,
      );
      pendingCaret.current = undefined;
    }
  });
  useLayoutEffect(() => {
    if (!visible || !popup.current) return;
    const height = popup.current.getBoundingClientRect().height;
    const top = Math.max(
      8,
      Math.min(position.top, window.innerHeight - height - 8),
    );
    if (top !== position.top) setPosition((current) => ({ ...current, top }));
  }, [visible, selected, position.top]);
  useEffect(() => {
    if (visible)
      document
        .getElementById(`${listId}-${selected}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [visible, selected, listId]);
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (!(
        event.target instanceof Node && popup.current?.contains(event.target)
      ))
        setQuery(undefined);
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("rmeter-appearance-changed", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("rmeter-appearance-changed", dismiss);
    };
  }, []);

  function suggest(element: HTMLTextAreaElement, explicit = false) {
    const next =
      !disabled &&
      !composing.current &&
      element.selectionStart === element.selectionEnd
        ? getCompletions(element.value, element.selectionStart, kind, explicit)
        : undefined;
    setQuery(next);
    setSelected(0);
    if (next) setPosition(caretPosition(element));
  }
  function accept(index: number) {
    if (!visible) return;
    const result = insertCompletion(visible, visible.items[index]);
    pendingCaret.current = result.caret;
    setQuery(undefined);
    onChange(result.value);
  }

  return (
    <div className="javascript-editor">
      <textarea
        ref={input}
        id={id}
        className="code"
        rows={9}
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        value={value}
        aria-autocomplete="list"
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible ? `${listId}-${selected}` : undefined}
        aria-describedby={hintId}
        onChange={(event) => {
          onChange(event.target.value);
          suggest(event.target);
        }}
        onBlur={() => setQuery(undefined)}
        onClick={() => setQuery(undefined)}
        onSelect={(event) => {
          const element = event.currentTarget;
          if (
            query &&
            (element.selectionStart !== query.caret ||
              element.selectionEnd !== query.caret)
          )
            setQuery(undefined);
        }}
        onCompositionStart={() => {
          composing.current = true;
          setQuery(undefined);
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          )
            return;
          if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
            event.preventDefault();
            event.stopPropagation();
            suggest(event.currentTarget, true);
            return;
          }
          if (!visible) return;
          if (
            ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(
              event.key,
            ) &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.shiftKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") setQuery(undefined);
            else if (event.key === "ArrowDown" || event.key === "ArrowUp")
              setSelected(
                (selected +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  visible.items.length) %
                  visible.items.length,
              );
            else accept(selected);
          } else if (
            ["ArrowLeft", "ArrowRight", "Home", "End", "Tab"].includes(
              event.key,
            )
          )
            setQuery(undefined);
        }}
      />
      <small id={hintId}>
        输入前缀或点号自动提示；Ctrl+Space 打开，↑/↓ 选择，Tab/Enter 补全，Esc
        关闭。
      </small>
      {visible &&
        createPortal(
          <div
            ref={popup}
            className="javascript-completions"
            style={position}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div
              id={listId}
              role="listbox"
              aria-label="JavaScript 补全建议"
              className="javascript-completion-list"
            >
              {visible.items.map((item, index) => (
                <div
                  key={item.name}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === selected}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => accept(index)}
                >
                  <strong>{item.name}</strong>
                  <span>{item.signature}</span>
                </div>
              ))}
            </div>
            <div className="javascript-completion-detail">
              <code>{visible.items[selected].signature}</code>
              <p>{visible.items[selected].description}</p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
