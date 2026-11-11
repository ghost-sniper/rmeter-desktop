# rmeter Logo

`rmeter-logo.png` 是透明背景的 Logo 原图，由内置 image_gen 工具生成。R 字母结合性能仪表盘，深蓝与浅蓝沿用桌面界面的配色。

修改原图后，在项目根目录运行 `bun run prepare:icons`，统一更新 `src-tauri/icons/` 的桌面图标与 `public/` 中的界面 Logo、favicon。由 Tauri CLI 转换尺寸和平台格式，保留透明度。生成的图标随源码提交，普通构建无需重新生成。

界面左上角使用 256×256 PNG，按 32×32 显示；Windows 使用多尺寸 ICO，macOS 使用 ICNS。组件树和操作按钮保留原有功能图标。

## 生成提示词

```text
Use case: logo-brand. Asset type: production desktop app icon for rmeter, a Rust-based HTTP/JDBC/JavaScript load-testing and performance-testing desktop tool. Create one finished, distinctive minimalist logo, not a presentation or contact sheet. Combine a bold geometric uppercase R monogram with a subtle speedometer needle or request pulse in one coherent simple silhouette. Existing app palette is deep navy #263e5c and cool blue #85bfef: use a deep navy rounded-square tile with a crisp light blue / near-white symbol, restrained flat colors, precise vector-like edges, high contrast, generous internal breathing room, legible at 32px. Centered square composition, tile fills roughly 90% of canvas. Transparent background outside rounded tile. No words, no small lettering, no numbers, no extra badges, no thin lines, no gradients, no 3D, no mockup, no watermark, no shadow outside the tile. Deliver one square high-resolution app icon.
```
