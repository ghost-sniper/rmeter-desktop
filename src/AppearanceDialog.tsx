import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import ThemePicker from "./ThemePicker";
import {
  AppearanceSettings,
  SystemFont,
  fontStack,
  validSize,
} from "./appearance";
import "./AppearanceDialog.css";

export default function AppearanceDialog({
  settings,
  onSave,
  onClose,
  returnFocus,
}: {
  settings: AppearanceSettings;
  onSave: (settings: AppearanceSettings) => void;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const [uiSize, setUiSize] = useState(String(settings.uiSize));
  const [codeSize, setCodeSize] = useState(String(settings.codeSize));
  const [fonts, setFonts] = useState<SystemFont[]>([]);
  const [fontStatus, setFontStatus] = useState("正在读取本机字体…");
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      returnFocus.current?.focus();
    };
  }, [returnFocus]);
  useEffect(() => {
    let disposed = false;
    if (!isTauri()) {
      setFontStatus("浏览器预览不能读取本机字体，可使用默认字体。");
      return;
    }
    void invoke<SystemFont[]>("list_system_fonts")
      .then((items) => {
        if (disposed) return;
        if (!Array.isArray(items) || !items.length) {
          setFontStatus("未读取到本机字体，可继续使用默认字体。");
          return;
        }
        setFonts(items);
        setFontStatus("");
      })
      .catch(() => {
        if (!disposed) setFontStatus("本机字体读取失败，可继续使用默认字体。");
      });
    return () => {
      disposed = true;
    };
  }, []);
  function fontField(code: boolean) {
    const key = code ? "codeFont" : "uiFont";
    const available = code
      ? [...fonts].sort(
          (a, b) =>
            Number(b.monospaced) - Number(a.monospaced) ||
            a.family.localeCompare(b.family),
        )
      : fonts;
    return (
      <label>
        {code ? "代码字体" : "界面字体"}
        <select
          value={draft[key]}
          onChange={(event) =>
            setDraft({ ...draft, [key]: event.target.value })
          }
        >
          <option value="">默认字体{code ? "（等宽）" : ""}</option>
          {draft[key] && !fonts.some((font) => font.family === draft[key]) && (
            <option value={draft[key]}>
              {draft[key]}（当前不可用，使用后备字体）
            </option>
          )}
          {available.map((font) => (
            <option key={font.family} value={font.family}>
              {font.family}
              {font.monospaced ? "（等宽）" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <dialog
      ref={dialog}
      className="appearance-dialog"
      aria-labelledby="appearance-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          (event.ctrlKey || event.metaKey) &&
          ["s", "o", "n"].includes(event.key.toLowerCase())
        )
          event.preventDefault();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!validSize(Number(uiSize)) || !validSize(Number(codeSize))) {
            setError("字号必须是 10～32 之间的整数。");
            return;
          }
          onSave({
            ...draft,
            uiSize: Number(uiSize),
            codeSize: Number(codeSize),
          });
        }}
        noValidate
      >
        <h2 id="appearance-title">外观</h2>
        <p>分别设置界面和代码字体，点击“保存”后应用。</p>
        {fontStatus && (
          <p role="status" className="appearance-font-status">
            {fontStatus}
          </p>
        )}
        <div className="appearance-fonts">
          {fontField(false)}
          <label>
            界面字号（px）
            <input
              autoFocus
              type="number"
              min={10}
              max={32}
              step={1}
              value={uiSize}
              onChange={(event) => {
                setUiSize(event.target.value);
                setError("");
              }}
            />
          </label>
          {fontField(true)}
          <label>
            代码字号（px）
            <input
              type="number"
              min={10}
              max={32}
              step={1}
              value={codeSize}
              onChange={(event) => {
                setCodeSize(event.target.value);
                setError("");
              }}
            />
          </label>
        </div>
        <section className="appearance-preview" aria-label="字体预览">
          <p
            style={{
              fontFamily: fontStack(draft.uiFont),
              fontSize: validSize(Number(uiSize)) ? `${uiSize}px` : undefined,
            }}
          >
            测试计划 · 运行结果　Aa 012345
          </p>
          <pre
            style={{
              fontFamily: fontStack(draft.codeFont, true),
              fontSize: validSize(Number(codeSize))
                ? `${codeSize}px`
                : undefined,
            }}
          >
            {'const name = vars.get("name");\nlog.info("你好，{}", name);'}
          </pre>
        </section>
        <h3>主题</h3>
        <ThemePicker
          theme={draft.theme}
          onChange={(theme) => setDraft({ ...draft, theme })}
        />
        {error && (
          <p role="alert" className="appearance-error">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit">保存</button>
        </footer>
      </form>
    </dialog>
  );
}
