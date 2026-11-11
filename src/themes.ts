export const themes = [
  { id: "light", name: "Light · 浅色", caption: "明亮、简洁", mode: "light" },
  { id: "dark", name: "Dark · 深色", caption: "低光环境", mode: "dark" },
  {
    id: "cyberpunk",
    name: "Cyberpunk 2077",
    caption: "夜之城 · 霓虹黄蓝",
    mode: "dark",
    image: "/themes/cyberpunk.jpg",
  },
  {
    id: "eva",
    name: "EVA",
    caption: "初号机 · 紫绿",
    mode: "dark",
    image: "/themes/eva.jpg",
  },
  {
    id: "death-stranding",
    name: "Death Stranding",
    caption: "Sam 与 BB · 冷灰蓝",
    mode: "dark",
    image: "/themes/death-stranding.jpg",
  },
  {
    id: "wukong",
    name: "Black Myth: Wukong",
    caption: "天命人 · 水墨金",
    mode: "dark",
    image: "/themes/wukong.jpg",
  },
] as const;

export type ThemeId = (typeof themes)[number]["id"];
export const themeStorageKey = "rmeter.desktop.theme";

export function isTheme(value: unknown): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

export function readTheme(): ThemeId {
  try {
    const saved = window.localStorage.getItem(themeStorageKey);
    return isTheme(saved) ? saved : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  document.documentElement.dataset.artwork = String(
    id !== "light" && id !== "dark",
  );
  document.documentElement.style.colorScheme =
    id === "light" ? "light" : "dark";
}

export function saveTheme(id: ThemeId) {
  try {
    window.localStorage.setItem(themeStorageKey, id);
  } catch {
    // Storage may be unavailable; switching the current window still works.
  }
}
