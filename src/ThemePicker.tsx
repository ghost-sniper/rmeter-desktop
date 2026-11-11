import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyTheme, readTheme, saveTheme, themes, ThemeId } from "./themes";
import "./themes.css";

export default function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(readTheme);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = themes.find((item) => item.id === theme)!;

  useLayoutEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (isTauri()) {
      void getCurrentWindow()
        .setTheme(theme === "light" ? "light" : "dark")
        .catch(() => {
          // Web content remains themed if a platform cannot style its title bar.
        });
    }
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div
      className="theme-picker"
      ref={root}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        ref={trigger}
        className="theme-trigger"
        aria-label={`切换主题，当前：${current.name}`}
        aria-expanded={open}
        aria-controls="theme-panel"
        onClick={() => setOpen(!open)}
      >
        <span className="theme-indicator" aria-hidden="true" />
        <span>主题</span>
        <span className="theme-current">{current.name}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <section
          id="theme-panel"
          className="theme-panel"
          role="dialog"
          aria-label="外观主题"
        >
          <div className="theme-panel-heading">
            <strong>外观主题</strong>
            <span>自动保存 · 随时切换</span>
          </div>
          <div className="theme-grid">
            {themes.map((item) => (
              <button
                key={item.id}
                className="theme-option"
                data-preview-theme={item.id}
                aria-label={item.name}
                aria-pressed={theme === item.id}
                onClick={() => {
                  setTheme(item.id);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <span className="theme-thumbnail">
                  {"image" in item ? (
                    <img src={item.image} alt="" loading="lazy" />
                  ) : (
                    <span className="theme-mini-window">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  <span className="theme-swatches" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {theme === item.id && (
                    <span className="theme-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </span>
                <strong>{item.name}</strong>
                <small>{item.caption}</small>
              </button>
            ))}
          </div>
          <p className="theme-note">作品背景随应用提供，离线可用。</p>
        </section>
      )}
    </div>
  );
}
