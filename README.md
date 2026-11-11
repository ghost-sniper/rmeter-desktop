# rmeter desktop

基于 React、TypeScript 和 Tauri 2 的中文测试脚本编辑器。主界面采用 JMeter 的左侧节点树、右侧属性面板布局，执行核心为私有仓库 `ghost-sniper/rmeter` 的 **v0.1.0** tag。

## 开发与构建

需要 Bun、Rust stable、Windows MSVC C++ 工具链和 WebView2。Windows 为首版验收平台。

```powershell
bun install --frozen-lockfile
bun run tauri dev
bun run tauri build
```

所有前端安装、开发、测试和构建均使用 Bun。Tauri 的 `beforeDevCommand` / `beforeBuildCommand` 自动通过 Bun 准备 JavaScript worker，然后启动 Vite / 构建前端。Rust 与 worker 使用 Cargo 编译。Windows 安装包位于 `src-tauri/target/release/bundle/`。

只预览界面：`bun run dev`。浏览器预览可以编辑节点，文件对话框与校验、执行需要桌面宿主，不模拟执行结果。

### 私有 Git 依赖

`src-tauri/Cargo.toml` 固定使用 HTTPS Git URL、`tag = "v0.1.0"` 和 `default-features = false`；`Cargo.lock` 固定实际提交。项目 `.cargo/config.toml` 启用 Git CLI 拉取。

先通过本机 Git Credential Manager 完成拥有仓库读取权限的 GitHub 账号认证，确认以下命令能够返回标签：

```powershell
git ls-remote https://github.com/ghost-sniper/rmeter.git refs/tags/v0.1.0
```

GitHub 应用连接的权限不会自动成为本机 Git 凭据。不要把 token 写入 URL、Cargo 配置或项目文件。CI 通过其凭据管理配置只读访问。

### JavaScript worker

```powershell
bun run prepare:worker
# 强制重新构建
bun run prepare:worker --force
```

脚本从同一仓库和 tag 构建 `rmeter-component` 的 `rmeter-js-worker`，缓存到 `.cache/worker/v0.1.0/<target>/`，复制到 `src-tauri/binaries/rmeter-js-worker-<target>.exe`，由 Tauri `externalBin` 打包。缓存和二进制不提交版本控制。

开发版显式定位上述文件，发行版定位宿主程序旁的 worker，均调用库的 `set_worker_executable`；不从当前目录或 PATH 搜索。worker 缺失时 JavaScript 校验与执行报错，纯 HTTP/JDBC 仍可运行。交叉构建使用 `TAURI_ENV_TARGET_TRIPLE`；其他平台需要对应工具链及平台验证。

## 使用

- 新建测试计划，选择线程组，通过右键或左下方选择器添加组件。树支持复制、删除、上下移动、移动到合法父节点及方向键导航。
- `Ctrl+N` 新建、`Ctrl+O` 打开、`Ctrl+S` 保存、`Ctrl+Shift+S` 另存为；树内 `Ctrl+D` 复制、`Delete` 删除。
- 校验调用核心库，不发送 HTTP 请求或建立数据库连接；JavaScript 编译检查会启动隔离 worker。
- 运行前再次校验。运行期间配置锁定，停止取消活动采样。每次只运行一个计划，关闭应用时处理未保存修改与活动任务。
- 底部查看累计采样、成功和失败数，选择采样查看响应。只保留最近 1000 条详情，每条响应最多预览 64 KiB，总预览缓存 16 MiB；完整采样统计不受预览截断影响。
- `已完成` 表示引擎正常结束，仍需检查失败采样数。`已停止` 与 `运行失败` 单独显示。

### 支持的组件

线程组、While、Loop、IF、HTTP 采样器、JDBC 采样器、JavaScript 采样器、JDBC 配置。测试计划根节点可编辑变量和顶层 HTTP 默认配置。

JDBC 使用 Rust 原生 PostgreSQL 驱动，不加载 JDBC JAR，默认要求 TLS。配置可置于计划根、线程组或控制器，同名池的覆盖和引用语义由核心库处理。密码字段会写入 JSON，也可使用 `password_env` 从宿主环境读取，两者互斥。

JavaScript 支持 `vars.get/put/remove/contains` 与 `ctx`，不提供 Node.js、浏览器、异步 I/O 或完整 JSR223 API。IF/While 的字符串条件使用 rmeter 变量表达式，不执行 JavaScript 或 JMeter 函数。

### 文件格式与保护

使用 rmeter `version: 1` 的 UTF-8 JSON（读取支持 BOM），不支持 JMX。节点 ID、选中状态和展开状态不写入文件；不提供通用禁用、备注及 Loop 自定义名称。已支持字段保留缺省/null 区别、请求头与参数重复键和顺序。

含范围外节点、非空断言或后置处理器的文件显示原始内容并只读打开，禁止保存覆盖和运行。格式错误、未知字段以及可能无法无损编辑的数据同样只读保护。库支持的 JDBC 类型别名保存时规范为标准类型名。

可以保存尚未通过执行校验的配置；JSON/数值字段的输入格式错误须先修正。保存采用同目录临时文件与原子替换，失败不清除修改标记。

## 示例与测试

```powershell
# 本地 HTTP 服务，在独立终端运行
bun scripts/smoke-server.ts
```

在桌面打开 `examples/http-javascript.json` 并运行，预期 4 次成功采样（2 次 HTTP、2 次 JavaScript）。`examples/jdbc.json` 需先修改为隔离 PostgreSQL 测试库连接。

```powershell
bun run test
bun run build
bun run prepare:worker
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

前端测试覆盖模型往返、树编辑、草稿、只读与保存失败、结果缓存。Rust 测试通过本地 HTTP 服务和真实 JavaScript worker 验证循环、条件、错误策略、取消、响应截断和原子保存。

数据库集成测试默认忽略，显式提供隔离测试库后执行：

```powershell
$env:RMETER_TEST_POSTGRES_URL = 'postgresql://postgres@127.0.0.1:5432/rmeter_test?sslmode=disable'
cargo test --manifest-path src-tauri/Cargo.toml jdbc_parameters_updates_scopes_errors_and_cancellation -- --ignored
```

测试覆盖参数化查询、更新、连接作用域、查询错误和取消，不应指向生产数据库。`sslmode=disable` 仅用于本机隔离实例。

## 代码边界

`src/model.ts` 管理原生 JSON 与编辑树；`NodeForm.tsx` 提供组件表单；`results.ts` 限制展示缓存；`App.tsx` 负责桌面交互。

`src-tauri/src/bridge.rs` 仅提供文件命令、库调用、任务生命周期和 IPC。解析、组件编译、线程调度、变量、条件、HTTP/JDBC/JavaScript 采样均由 rmeter 提供。接口为 `read_script`、`write_script`、`validate_script`、`start_run`、`stop_run`、`worker_status`；运行结果带独立 `run_id`，使用 Tauri Channel 批量发送。
