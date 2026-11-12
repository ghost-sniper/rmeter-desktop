import { applyTheme, isTheme, readTheme, ThemeId } from "./themes";

export interface AppearanceSettings {
  version: 1;
  theme: ThemeId;
  uiFont: string;
  uiSize: number;
  codeFont: string;
  codeSize: number;
}
export interface SystemFont {
  family: string;
  monospaced: boolean;
}
export const appearanceStorageKey = "rmeter.desktop.appearance";
export const defaultAppearance: AppearanceSettings = {
  version: 1,
  theme: "light",
  uiFont: "",
  uiSize: 13,
  codeFont: "",
  codeSize: 12,
};
export const defaultUiFont = '"Segoe UI", "Microsoft YaHei", sans-serif';
export const defaultCodeFont = '"Cascadia Code", Consolas, monospace';

export function validSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 10 &&
    value <= 32
  );
}
function validFont(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 200 &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
export function isAppearance(value: unknown): value is AppearanceSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<AppearanceSettings>;
  return (
    settings.version === 1 &&
    isTheme(settings.theme) &&
    validFont(settings.uiFont) &&
    validFont(settings.codeFont) &&
    validSize(settings.uiSize) &&
    validSize(settings.codeSize)
  );
}
export function readAppearance(): AppearanceSettings {
  try {
    const saved = localStorage.getItem(appearanceStorageKey);
    if (saved !== null) {
      const value: unknown = JSON.parse(saved);
      return isAppearance(value) ? value : { ...defaultAppearance };
    }
    return { ...defaultAppearance, theme: readTheme() };
  } catch {
    return { ...defaultAppearance };
  }
}
export function fontStack(font: string, code = false) {
  const fallback = code ? defaultCodeFont : defaultUiFont;
  return font ? `${JSON.stringify(font)}, ${fallback}` : fallback;
}
export function applyAppearance(settings: AppearanceSettings) {
  applyTheme(settings.theme);
  const root = document.documentElement;
  root.style.setProperty("--ui-font", fontStack(settings.uiFont));
  root.style.setProperty("--ui-size", `${settings.uiSize}px`);
  root.style.setProperty("--code-font", fontStack(settings.codeFont, true));
  root.style.setProperty("--code-size", `${settings.codeSize}px`);
  root.dataset.customFont = String(!!settings.uiFont);
  window.dispatchEvent(new Event("rmeter-appearance-changed"));
}
/** Applying the current window is independent of storage being available. */
export function saveAppearance(settings: AppearanceSettings): boolean {
  try {
    localStorage.setItem(appearanceStorageKey, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
