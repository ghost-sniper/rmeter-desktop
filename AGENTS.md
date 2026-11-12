# 项目约束

## 构建与交付

- 用户要求“打包”“构建”或“编译”时，默认只生成可直接运行的可执行文件，不生成安装包。
- 只有用户明确要求“安装包”或指定 MSI、NSIS 等安装包格式时，才执行安装包构建。
- 默认使用 `bun run tauri build --no-bundle`；不可将不带 `--no-bundle` 的 `bun run tauri build` 作为默认打包命令。
- 可执行文件交付时，保留运行所需的同版本 `rmeter-js-worker`，并与桌面主程序放在同一目录。无需主动制作 ZIP 等压缩包。
- Rust 发布构建使用 O3（`opt-level = 3`），桌面端和 worker 均遵循该要求。
