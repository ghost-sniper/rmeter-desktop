import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ThemePicker from "./ThemePicker";
import { applyTheme, readTheme, themeStorageKey, themes } from "./themes";

const setTheme = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTheme }),
}));

beforeEach(() => {
  window.localStorage.clear();
  applyTheme("light");
  setTheme.mockClear();
});

it("switches all six themes, persists the selection, and themes the native window", () => {
  const view = render(<ThemePicker />);
  for (const theme of themes) {
    fireEvent.click(screen.getByRole("button", { name: /切换主题/ }));
    fireEvent.click(screen.getByRole("button", { name: theme.name }));
    expect(document.documentElement.dataset.theme).toBe(theme.id);
    expect(document.documentElement.style.colorScheme).toBe(theme.mode);
    expect(window.localStorage.getItem(themeStorageKey)).toBe(theme.id);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(setTheme).toHaveBeenLastCalledWith(theme.mode);
  }
  view.unmount();
  render(<ThemePicker />);
  expect(
    screen.getByRole("button", { name: /当前：Black Myth: Wukong/ }),
  ).toBeInTheDocument();
});

it("dismisses the picker with Escape or an outside pointer and restores keyboard focus", () => {
  render(<ThemePicker />);
  const trigger = screen.getByRole("button", { name: /切换主题/ });
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("falls back to light for invalid preferences and still switches if storage is blocked", () => {
  window.localStorage.setItem(themeStorageKey, "unknown-theme");
  expect(readTheme()).toBe("light");
  const read = vi
    .spyOn(window.Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });
  const write = vi
    .spyOn(window.Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });
  try {
    render(<ThemePicker />);
    fireEvent.click(screen.getByRole("button", { name: /切换主题/ }));
    fireEvent.click(screen.getByRole("button", { name: "Dark · 深色" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});
