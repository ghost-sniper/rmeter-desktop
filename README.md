# rmeter desktop

基于 React、TypeScript 和 Tauri 2 的中文测试脚本编辑器。主界面采用 JMeter 的左侧节点树、右侧属性面板布局，执行核心为私有仓库 `ghost-sniper/rmeter` 的固定提交 **fd6e5773cbeb5387afc0f803007707048d6e5663**（基于 v0.1.0，支持 HTTP 采样器列表覆盖、组件命名与禁用及 JDBC 整表/按列结果变量）。

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

`src-tauri/Cargo.toml` 使用 HTTPS Git URL、完整 `rev` 和 `default-features = false`；`Cargo.lock` 固定同一提交。项目 `.cargo/config.toml` 启用 Git CLI 拉取。

先通过本机 Git Credential Manager 完成拥有仓库读取权限的 GitHub 账号认证，确认以下命令能够返回标签：

```powershell
git ls-remote https://github.com/ghost-sniper/rmeter.git refs/heads/master
```

GitHub 应用连接的权限不会自动成为本机 Git 凭据。不要把 token 写入 URL、Cargo 配置或项目文件。CI 通过其凭据管理配置只读访问。

### JavaScript worker

```powershell
bun run prepare:worker
# 强制重新构建
bun run prepare:worker --force
```

脚本直接读取 `src-tauri/Cargo.toml` 中的 Git 仓库和 `rev`，从同一提交构建 `rmeter-component` 的 `rmeter-js-worker`，缓存到 `.cache/worker/<rev>/<target>/`，复制到 `src-tauri/binaries/rmeter-js-worker-<target>.exe`，由 Tauri `externalBin` 打包。缓存和二进制不提交版本控制。

开发版显式定位上述文件，发行版定位宿主程序旁的 worker，均调用库的 `set_worker_executable`；不从当前目录或 PATH 搜索。worker 缺失时 JavaScript 校验与执行报错，纯 HTTP/JDBC 仍可运行。交叉构建使用 `TAURI_ENV_TARGET_TRIPLE`；其他平台需要对应工具链及平台验证。

## 使用

- 新建测试计划，选择线程组，通过右键或左下方选择器添加组件。树支持复制、删除、上下移动、移动到合法父节点及方向键导航。
- 右键菜单按“配置元件”（JDBC 连接配置、HTTP 默认配置）、“采样器”（HTTP、JDBC、JavaScript）和“逻辑控制器”（Loop、While、IF）分类，悬停或点击展开子菜单；仅显示当前父节点允许添加的组件，测试计划下仍可直接添加线程组。
- `Ctrl+N` 新建、`Ctrl+O` 打开、`Ctrl+S` 保存、`Ctrl+Shift+S` 另存为；树内 `Ctrl+D` 复制、`Delete` 删除。
- 校验调用核心库，不发送 HTTP 请求或建立数据库连接；JavaScript 编译检查会启动隔离 worker。
- 运行前再次校验。运行期间配置锁定，停止取消活动采样。每次只运行一个计划，关闭应用时处理未保存修改与活动任务。
- 底部查看累计采样、成功和失败数，选择采样查看响应。只保留最近 1000 条详情，每条响应最多预览 64 KiB，总预览缓存 16 MiB；完整采样统计不受预览截断影响。
- `已完成` 表示引擎正常结束，仍需检查失败采样数。`已停止` 与 `运行失败` 单独显示。

### 支持的组件

线程组、While、Loop、IF、HTTP 采样器、HTTP 默认配置、JDBC 采样器、JavaScript 采样器、JDBC 连接配置。测试计划根节点可编辑变量和顶层全局 HTTP 默认配置。

JDBC 使用 Rust 原生 PostgreSQL 驱动，不加载 JDBC JAR，默认要求 TLS。配置可置于计划根、线程组或控制器，同名池的覆盖和引用语义由核心库处理。密码字段会写入 JSON，也可使用 `password_env` 从宿主环境读取，两者互斥。

JavaScript 支持 `vars.get/put/remove/contains` 与 `ctx`，不提供 Node.js、浏览器、异步 I/O 或完整 JSR223 API。IF/While 的字符串条件使用 rmeter 变量表达式，不执行 JavaScript 或 JMeter 函数。

### 文件格式与保护

使用 rmeter `version: 1` 的 UTF-8 JSON（读取支持 BOM），不支持 JMX。所有已支持的节点和三类断言均可设置名称，名称写入原生 `name` 字段并显示在节点树或断言列表中。Loop 和 HTTP 默认配置兼容旧脚本省略名称（或 `null`），缺省时显示组件类型名；显式字符串名称不能仅为空白。节点 ID、选中状态和展开状态不写入文件；不提供备注。已支持字段保留缺省/null 区别、请求头与参数重复键和顺序。

含范围外节点、不支持的断言类型或非空后置处理器的文件显示原始内容并只读打开，禁止保存覆盖和运行。格式错误、未知字段以及可能无法无损编辑的数据同样只读保护。库支持的 JDBC 类型别名保存时规范为标准类型名。

可以保存尚未通过执行校验的配置；JSON/数值字段的输入格式错误须先修正。保存采用同目录临时文件与原子替换，失败不清除修改标记。

### 响应断言

在 HTTP 或 JDBC 采样器的节点配置底部添加响应断言，可命名、编辑、上下移动和删除。断言附属于采样器，按原生格式写入 `assertions` 数组，保持声明顺序；JavaScript 采样器不提供该配置。

| 类型 | 可配置内容 |
| --- | --- |
| JSONPath（`type: "json"`） | JSONPath、等值 / 正则 / 存在 / 不存在、one / any / all 节点范围；期望值按 JSON 类型保存，包括 null |
| XPath（`type: "xml"`） | XPath、文本等值 / 正则 / 存在 / 不存在、节点范围、命名空间前缀与 URI 映射 |
| 正则表达式（`type: "regex"`） | 对完整 UTF-8 响应正文匹配 Rust regex，可反向要求不匹配 |

`one`（缺省）要求恰好一个节点，`any` 要求至少一个匹配，`all` 要求非空且全部匹配；存在 / 不存在检查不使用节点范围。XPath 等值使用字符串比较，不自动去除空白。JSONPath 正则只匹配字符串节点。表达式及期望值为字面量，不展开 `${变量}`。兼容省略 `type` 的旧 JSONPath 断言，保存时保留该格式。

校验与运行都调用 rmeter；非法 JSONPath、XPath、未绑定的命名空间前缀及非法 Rust 正则在运行前报错。每项断言都会执行，任一失败会使采样失败，即使 HTTP 状态码为 200，并参与线程组错误策略。无需保存响应预览也可执行断言；HTTP 可独立设置 `max_assertion_body_bytes`，JDBC 使用查询结果容量限制。

运行结果表显示每次采样通过的断言数 / 总断言数；选择采样后可查看断言名称、通过 / 失败状态和核心库返回的失败原因。该计数属于断言，顶部统计仍按采样计数。

## 启用与禁用

节点详情的“启用组件”和右键“启用组件 / 禁用组件”控制执行状态；三类断言也有独立开关。状态写入原生 JSON 的 `enabled` 布尔字段，缺省等同于 `true`。禁用后仍可编辑、复制和保存配置，节点树显示“已禁用”；父节点被禁用时后代显示“随父节点禁用”，各子节点自身的状态保持不变。

核心库在编译执行计划前跳过禁用项：禁用采样器不发送请求、不产生结果；禁用控制器或线程组跳过整个子树；禁用 HTTP/JDBC 配置不参与作用域；禁用断言不参与校验和统计。禁用 JavaScript 不编译脚本或启动 worker。已启用的 JDBC 请求若仅引用了被禁用的连接配置，会报缺少连接。全部禁用或禁用测试计划时，运行正常完成，采样数为 0。

禁用节点的执行配置可以暂未填写完整；重新启用后按正常规则校验。编辑器仍保护不支持的组件和字段，格式错误的表单草稿仍需修正后保存。运行期间及只读文件中不能修改启用状态。

## JDBC 结果变量

参考 [JMeter JDBC Request](https://jmeter.apache.org/usermanual/component_reference.html#JDBC_Request)，提供两种可独立或同时使用的方式：

| 配置 | 保存内容与访问方法 |
| --- | --- |
| 整表结果变量：`result` | `result` 为 JSONArray 字符串，例如 `[{"id":1,"name":"张三"}]`；`${result_#}` 为行数；JavaScript 使用 `JSON.parse(vars.get("result"))[0].id` |
| 按列变量名：`id,,name` | 按查询列顺序映射，跳过第 2 列；`${id_1}`、`${id_2}` 读取第 1 列各行，`${name_1}` 读取第 3 列第 1 行；`${id_#}`、`${name_#}` 为行数 |

按列名称在原生 JSON 中保存为 `"variable_names": ["id", "", "name"]`，不足的名称跳过后续列，多余名称只有行数。行号从 1 开始。SQL NULL 在整表 JSON 中保留为 null，在按列模式下不设置对应单元格变量；文本不额外加引号，其他值序列化为字符串。两种方式的输出名称须避免冲突。

零行时整表变量为 `[]`、行数为 `0`。每次采样会清除上一次的行变量，查询变少、失败、超时或取消均不会沿用旧结果；变量隔离在各虚拟用户内。原“行数变量”保留为“额外行数变量”，通常无需填写。保存响应体开关不影响结果变量，变量总字节数也受结果容量限制。

整表变量已从旧版的响应包对象改为 JSONArray。旧脚本里的 `result.rows[0][0]` 需改为 `result[0].列名`；项目联动示例已更新。响应详情与断言仍使用原来的 `columns/rows/row_count/rows_affected` 结构。整表对象遇到同名列时后列覆盖前列，可通过 SQL 别名区分。

## 示例与测试

### 配置组件作用域

已核对所固定核心提交的 `src/script.rs` 与 `rmeter-component/src/component.rs`：HTTP 默认配置是独立 `http_defaults` 组件，JDBC 连接配置是独立 `jdbc_connection_configuration` 组件。二者均不产生采样，配置合并、引用及作用域由库编译器处理。

| 配置 | 可放置位置 | 生效规则 |
| --- | --- | --- |
| HTTP 默认配置 | 线程组、Loop、IF、While 下 | 影响同层及其后代 HTTP 采样器；同层配置按树顺序合并，后者覆盖前者，内层覆盖外层；采样器显式设置优先 |
| 全局 HTTP 默认配置 | 测试计划详情中的全局配置 | 写入根 `defaults`，作为所有线程组的最外层默认值 |
| JDBC 连接配置 | 测试计划、线程组、Loop、IF、While 下 | 同层及后代 JDBC 采样器按连接变量名引用；子作用域同名覆盖，同层重名校验报错 |

配置作用于整个所在层级，放在采样器之后也生效。内层覆盖不会影响外层兄弟节点或其他线程组。计划下的 JDBC 配置保存为根 `jdbc_connections` 数组，条目不带 `type`；其他位置保存为带 `type` 的组件。

按原生结构，HTTP/JDBC 采样器仍为叶节点，不能添加配置子节点；核心 JSON 格式不接受 HTTP 采样器的 `children`。HTTP 默认配置包含 `type`、`settings` 和可选的 `name`，名称仅用于编辑器展示，不影响配置作用域。新增 HTTP 采样器不再预填完整 URL，以便继承作用域中的地址；显式填写完整 URL 时，其地址优先于默认配置中的协议、主机、端口和路径。

采样器显式设置的字段使用自身值，未设置字段继续继承；请求头与查询参数只要设置数组就整组替换默认列表，保留重复键和顺序。空数组 `[]` 清除对应继承内容，缺省或 `null` 继承默认列表。界面提供“清空并停止继承”和“恢复缺省”，并显示当前状态。默认配置节点之间仍按键合并，内层或同层后置配置覆盖同名项。已有脚本中非空采样器列表不再自动补入默认列表的其他项；需要这些项时应显式添加到采样器，或恢复缺省以继承整个默认列表。

`examples/http-defaults-scopes.json` 使用 Mock Studio 的 `/examples/query` 和 `/examples/items/42` 验证上述 HTTP 规则，预期 7 次成功采样。`examples/jdbc-scopes.json` 使用指定 `ipds_dev` 验证全局、线程组、控制器继承与同名覆盖，预期 8 次成功采样；通过连接启动参数设置会话 `search_path` 并只读查询该值区分作用域，不访问业务表或修改持久数据库配置。这两项验收与八组件联动测试一起由 `bun run test:integration` 执行。

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

### Mock Studio 与指定 ipds_dev 的八组件验收

`examples/mock-jdbc-all-components.json` 是可在桌面直接打开、编辑和运行的原生脚本，覆盖原有八类基础组件及响应断言；独立 HTTP 默认配置由前述作用域示例覆盖。HTTP 使用 `http://127.0.0.1:9080/viewer` 目录中的实际 mock 路由；JDBC 使用 `106.54.164.19:25432/ipds_dev`，用户名 `postgres`，密码仅从 `RMETER_INTEGRATION_DB_PASSWORD` 环境变量读取。该服务器实际不支持 SSL，因此此验收连接明确设置 `sslmode=disable`。所有 SQL 均为只读 SELECT，只查询连接身份、常量及绑定参数，不读取业务表或修改数据。

通过 Bun 运行可复现验收（需先启动已有 Mock Studio 服务）：

```powershell
$dbSecret = Read-Host 'ipds_dev 密码' -AsSecureString
$env:RMETER_INTEGRATION_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $dbSecret).Password
try {
    bun run test:integration
} finally {
    Remove-Item Env:RMETER_INTEGRATION_DB_PASSWORD -ErrorAction SilentlyContinue
    Remove-Variable dbSecret
}
```

若在桌面运行此脚本，需从已设置该环境变量的终端启动桌面程序，让宿主继承变量。独立启动的旧进程不会读取后来设置的环境变量。

验收入口先读取只读 mock 目录快照，准备同 tag 的 JavaScript worker，再通过桌面实际使用的任务适配器执行。测试默认忽略，普通 `cargo test` 不访问此远程数据库。目录快照及本次采样响应保存在已忽略的 `.cache/integration/`；密码不写入脚本、报告或 Git。

2026-11-11 实测通过（catalog generation 1）：

| 验收项 | 结果 |
| --- | --- |
| 线程组 | 2 个用户，各 1 次迭代；每用户独立完成 28 次采样 |
| JDBC 配置 / 采样器 | 连接池配置生效；6 次参数化 SELECT，验证数据库、用户和返回值 |
| JavaScript | 6 次采样；验证 JDBC 结果，写入 HTTP 路径变量及 While 计数变量 |
| IF | 真分支执行，While 结束后假分支跳过 |
| Loop | 每用户重复 2 次完整 mock 请求集合 |
| While | 每用户执行 2 轮参数查询和变量递增，然后退出 |
| HTTP | 44 次请求；全部 10 个路由、11 条规则的状态码和正文逐一匹配 |
| 原生响应断言 | 96 项通过，覆盖 JSONPath、XPath、正文正则，以及 JDBC 查询结果 |
| 任务生命周期 | 单一正常终态，runId 一致，结束后释放活动任务 |
| 合计 | **56 成功 / 0 失败** |

HTTP 覆盖 `/hello/test` 模板、`/order` 成功及 UnionPay 分支、`/query/42` XML 匹配，以及 `/examples/` 下的 JSONPath、XPath、query、items/42、regex、JSON/XML 模板。UnionPay 规则的 HTTP 状态为 200、业务码为 400，脚本明确断言该预期业务拒绝。HTTP 每次执行 2 项原生断言，JDBC 初始化每次 2 项、While 查询每次 1 项，共 96 项；验收代码同时核对采样正文与断言结果。示例不使用后置处理器。前端测试另行验证此脚本包含全部组件且可无损打开保存。

## 代码边界

`src/model.ts` 管理原生 JSON 与编辑树；`NodeForm.tsx` 提供组件表单；`results.ts` 限制展示缓存；`App.tsx` 负责桌面交互。

`src-tauri/src/bridge.rs` 仅提供文件命令、库调用、任务生命周期和 IPC。解析、组件编译、线程调度、变量、条件、HTTP/JDBC/JavaScript 采样均由 rmeter 提供。接口为 `read_script`、`write_script`、`validate_script`、`start_run`、`stop_run`、`worker_status`；运行结果带独立 `run_id`，使用 Tauri Channel 批量发送。
