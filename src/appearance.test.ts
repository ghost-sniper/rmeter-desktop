import { beforeEach, expect, it, vi } from "vitest";
import {
  appearanceStorageKey,
  applyAppearance,
  defaultAppearance,
  isAppearance,
  readAppearance,
  saveAppearance,
} from "./appearance";
import { themeStorageKey } from "./themes";
beforeEach(() => localStorage.clear());
it("migrates legacy themes and reads versioned settings", () => {
  localStorage.setItem(themeStorageKey, "eva");
  expect(readAppearance()).toEqual({ ...defaultAppearance, theme: "eva" });
  const settings = {
    ...defaultAppearance,
    uiSize: 32,
    codeFont: "Consolas",
    codeSize: 10,
  };
  expect(saveAppearance(settings)).toBe(true);
  expect(readAppearance()).toEqual(settings);
});
it("rejects malformed versions, fonts and integer sizes", () => {
  for (const invalid of [
    { version: 2 },
    { theme: "bad" },
    { uiSize: 9 },
    { codeSize: 33 },
    { uiSize: 12.5 },
    { uiFont: null },
  ]) {
    const settings = { ...defaultAppearance, ...invalid };
    expect(isAppearance(settings)).toBe(false);
    localStorage.setItem(appearanceStorageKey, JSON.stringify(settings));
    expect(readAppearance()).toEqual(defaultAppearance);
  }
  localStorage.setItem(appearanceStorageKey, "{");
  expect(readAppearance()).toEqual(defaultAppearance);
});
it("applies fonts and native color scheme even if persistence fails", () => {
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  const settings = {
    ...defaultAppearance,
    theme: "dark" as const,
    uiFont: "Missing Font",
    uiSize: 32,
    codeSize: 32,
  };
  try {
    expect(saveAppearance(settings)).toBe(false);
    applyAppearance(settings);
    expect(
      document.documentElement.style.getPropertyValue("--ui-font"),
    ).toContain('"Missing Font", "Segoe UI"');
    expect(document.documentElement.style.getPropertyValue("--code-size")).toBe(
      "32px",
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
  } finally {
    spy.mockRestore();
  }
});
