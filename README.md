# rmeter desktop

基于 React、TypeScript 和 Tauri 2 的中文测试脚本编辑器。主界面采用 JMeter 的左侧节点树、右侧属性面板布局，执行核心为公开仓库 [`ghost-sniper/rmeter`](https://github.com/ghost-sniper/rmeter) 的固定提交 **71dacf95889c9cd8a5b252bc36685b615d5e0eac**（基于 v0.1.0，支持 HTTP 采样器列表覆盖、组件命名与禁用、JDBC 整表/按列结果变量、JavaScript 前后置处理器、五种 HTTP 提取器、固定/高斯随机定时器、五种原生函数与 Java 日期格式转换及 Loop/While 每轮超时）。

## 开发与构建

项目 Logo 原图和生成说明见 [assets/branding/README.md](assets/branding/README.md)。运行 `bun run prepare:icons` 可同步生成桌面应用图标、界面 Logo 和浏览器 favicon。

需要 Bun、Rust stable、Windows MSVC C++ 工具链和 WebView2。Windows 为首版验收平台。

```powershell
bun install --frozen-lockfile
bun run tauri dev
# 默认仅生成可执行文件，不生成安装包
bun run tauri build --no-bundle
```

所有前端安装、开发、测试和构建均使用 Bun。Tauri 的 `beforeDevCommand` / `beforeBuildCommand` 自动通过 Bun 准备 JavaScript worker，然后启动 Vite / 构建前端。Rust 与 worker 使用 Cargo 编译，发布构建采用 O3（`opt-level = 3`）。仅在明确需要安装包时使用安装包构建，产物位于 `src-tauri/target/release/bundle/`。

只预览界面：`bun run dev`。浏览器预览可以编辑节点，文件对话框与校验、执行需要桌面宿主，不模拟执行结果。

### 核心 Git 依赖

`src-tauri/Cargo.toml` 使用公开仓库的 HTTPS Git URL、完整 `rev` 和 `default-features = false`；`Cargo.lock` 固定同一提交。项目 `.cargo/config.toml` 启用 Git CLI 拉取，读取依赖无需 GitHub 账号或访问令牌。

### JavaScript worker

```powershell
bun run prepare:worker
# 强制重新构建
bun run prepare:worker --force
```

脚本直接读取 `src-tauri/Cargo.toml` 中的 Git 仓库和 `rev`，从同一提交构建 `rmeter-component` 的 `rmeter-js-worker`，缓存到 `.cache/worker/<rev>/<target>/`，复制到 `src-tauri/binaries/rmeter-js-worker-<target>.exe`，由 Tauri `externalBin` 打包。缓存和二进制不提交版本控制。

worker 成品继续按 `rev` 隔离，Cargo 编译目录使用 `.cache/worker-target/<target>/`，更新核心提交时复用未变化的依赖。旧的按提交划分的编译目录不会自动迁移；首次强制构建会填充共享目录，之后由 Cargo 校验依赖指纹并复用。桌面端仅生成 `rlib` 供主程序使用，不再生成额外的静态库和 DLL；桌面端及 worker 均保持 O3。

GitHub Actions 在推送 `main` 时仅构建可执行文件并预热缓存；版本标签和手动运行保留原有安装包与产物上传流程。CI 分别缓存桌面端 Cargo 依赖、worker 共享编译目录和精确版本的 worker 成品。worker 成品缓存按平台、目标架构、Rust 工具链、核心仓库及提交、构建脚本和 O3 配置区分，不回退到其他版本；编译缓存允许跨核心提交复用。不同标签读取默认分支预热的缓存，首次运行仍需要完整编译。

桌面编译缓存将 Cargo `profile` 配置的哈希放入恢复前缀：相同 profile 仍可跨依赖更新复用，但不同 LTO / codegen-units 配置不会互相恢复、累积无用产物。首次启用或变更 profile 时会重新填充缓存；O3、Thin LTO / 8 保持不变。工具链由 rust-toolchain 安装，不再缓存 Cargo bin 目录。比较 CI 耗时时，应使用新缓存填充后的重复运行，分别记录缓存压缩体积、恢复耗时、构建步骤及整个 job 耗时（不含排队），避免把首次填充与缓存命中混比。

Linux CI 安装系统依赖时使用 `--no-install-recommends`，保留必需依赖，跳过可选推荐包；更新 apt 索引时不下载翻译索引，`rpm` 仅在安装包流程中显式请求。每次仍执行索引更新，并在日志和 job 摘要中分别记录更新、安装耗时；Ubuntu 22.04、Rust 发布参数和应用运行时依赖声明均保持不变。

开发版显式定位上述文件，发行版定位宿主程序旁的 worker，均调用库的 `set_worker_executable`；不从当前目录或 PATH 搜索。worker 缺失时 JavaScript 和提取器的校验与执行报错，未使用这些组件的 HTTP/JDBC 仍可运行。交叉构建使用 `TAURI_ENV_TARGET_TRIPLE`；其他平台需要对应工具链及平台验证。分发无安装包版本时，须将 `rmeter-desktop.exe` 和同版本的 `rmeter-js-worker.exe` 放在同一目录。

### 发布配置基准

以下工具比较 Fat LTO / 1、Thin LTO / 8 和 Thin LTO / 16，三组均为 O3。执行前准备固定版本 worker，并选择一个不存在的新结果目录：

```powershell
bun run prepare:worker
bun scripts/benchmark-build-profiles.ts build .cache/profile-benchmark
bun scripts/benchmark-build-profiles.ts run .cache/profile-benchmark
bun scripts/summarize-build-profiles.ts .cache/profile-benchmark
```

构建阶段串行执行，每组使用独立空 Cargo 编译目录，记录一次冷构建、两次完整 Tauri 重复构建以及主程序大小。只生成可执行文件，worker 固定复用同一 O3 成品；核心依赖需已下载，测量使用离线模式。工具不会修改正式版 profile，也不会清理已有结果目录。

运行阶段使用相同依赖及 profile 编译的 `build-profile-bench` 示例程序，覆盖原生表达式、日期转换、24 节点脚本解析、本机 HTTP 请求及结果序列化、JavaScript worker 调用；每次执行校验结果和成功采样数。默认预热一轮后，按六种顺序交错测量 12 轮。`BENCH_SCALE` 可增加每轮工作量，`BENCH_REPETITIONS` 可调整轮数。此基准不覆盖 WebView 渲染、完整 Tauri IPC、远程网络或 JDBC，也不衡量 worker 自身编译参数的变化。运行测试时避免其他编译或负载，保持同一电源模式。

结果目录保存日志、各组 Cargo timings、`builds.json`、`runtime.json` 和 `summary.json`。汇总给出运行耗时/吞吐中位数及按轮配对的耗时变化 bootstrap 区间；冷构建只有一次观测，应结合重复构建和实际 CI 验证解读。重复执行运行阶段会覆盖 `runtime.json`，复测前请保留旧文件。

2026-11-13 在 Windows 11、Core Ultra 9 185H（22 逻辑处理器）、32 GB 内存、性能电源模式、Rust 1.99.1 / LLVM 23.1.1 上测得：

| 发布参数（均为 O3） | 空编译目录构建 | 重复构建两次 | 主程序大小 |
| --- | ---: | ---: | ---: |
| Fat LTO / 1 | 225.8 秒 | 129.8 / 122.1 秒 | 25.05 MiB |
| Thin LTO / 8 | 133.1 秒 | 38.1 / 37.7 秒 | 26.14 MiB |
| Thin LTO / 16 | 133.6 秒 | 44.3 / 43.2 秒 | 26.15 MiB |

运行测试先进行 12 轮（`BENCH_SCALE=2`），再以四倍工作量复测 6 轮（`BENCH_SCALE=8`），两阶段均交错执行三组并校验全部结果。复测中 Thin / 8 相对基线的按轮配对耗时中位变化：原生表达式 +1.9%、日期转换 +2.1%、解析 +1.1%、HTTP -3.7%、JavaScript -0.5%。HTTP 和 JavaScript 吞吐差异的 bootstrap 区间均包含零，不据此宣称吞吐提升。解析区间较宽（约 -1.8% 至 +16.5%）；24 个 HTTP 节点的解析中位耗时约从 0.208 ms 到 0.215 ms。JavaScript p95 延迟首轮约 +1.2%、复测约 +10.3%，说明该进程启动密集场景的尾延迟尚不能判定等效。

正式配置选择 **Thin LTO / 8 / O3**：以约 2% 的 CPU 微基准耗时增加和约 4.3% 的体积增加，换取本机约 41% 的冷构建提速及约 70% 的重复构建提速。Thin / 16 没有更好的构建收益，日期转换却在两阶段均慢约 6–7%，因此不采用。这是本机 Windows 引擎基准支持的取舍，不是全平台或 GUI、JDBC、尾延迟无回退的保证；worker 参数保持不变。两阶段原始测量和统计见 [基准数据](benchmarks/build-profiles-2026-11-13-windows.json)。

## 使用

- “视图 → 外观”提供 Light、Dark、Cyberpunk 2077、EVA、Death Stranding 和 Black Myth: Wukong 六种外观。主题、界面字体/字号和代码字体/字号在“保存”后立即生效并在本机记忆；取消或 Esc 丢弃草稿。字号为 10–32 整数像素，默认界面 13、代码 12。本机字体离线扫描，等宽字体带标记；不可用字体使用后备字体，读取或存储失败时显示提示。设置不会改动脚本或丢失输入，运行期间也可调整。作品背景内置于应用，无需联网；图片来源和版权说明见 [public/themes/SOURCES.md](public/themes/SOURCES.md)。
- 新建测试计划，选择线程组，通过右键或左下方选择器添加组件。树支持复制、删除、上下移动、移动到合法父节点及方向键导航。
- 右键菜单按“配置元件”（JDBC 连接配置、HTTP 默认配置）、“采样器”（HTTP、JDBC、JavaScript）和“逻辑控制器”（Loop、While、IF）分类，悬停或点击展开子菜单；仅显示当前父节点允许添加的组件，测试计划下仍可直接添加线程组。
- `Ctrl+N` 新建、`Ctrl+O` 打开、`Ctrl+S` 保存、`Ctrl+Shift+S` 另存为；树内 `Ctrl+D` 复制、`Delete` 删除。
- 校验调用核心库，不发送 HTTP 请求或建立数据库连接；JavaScript 编译检查会启动隔离 worker。
- 运行前再次校验。运行期间配置锁定，停止取消活动采样。每次只运行一个计划，关闭应用时处理未保存修改与活动任务。
- 底部查看累计采样、成功和失败数，选择采样查看响应。只保留最近 1000 条详情，每条响应最多预览 64 KiB，总预览缓存 16 MiB；完整采样统计不受预览截断影响。
- `已完成` 表示引擎正常结束，仍需检查失败采样数。`已停止` 与 `运行失败` 单独显示。

### 支持的组件

线程组、While、Loop、IF、HTTP 采样器、HTTP 默认配置、JDBC 采样器、JavaScript 采样器、JDBC 连接配置，以及采样器下的 JavaScript 前后置处理器和 HTTP 下的五种后置提取器。测试计划根节点可编辑变量和顶层全局 HTTP 默认配置。

JDBC 使用 Rust 原生 PostgreSQL 驱动，不加载 JDBC JAR，默认要求 TLS。配置可置于计划根、线程组或控制器，同名池的覆盖和引用语义由核心库处理。密码字段会写入 JSON，也可使用 `password_env` 从宿主环境读取，两者互斥。

JavaScript 支持 `vars.get/put/remove/contains`、`ctx` 和原生 `functions` 函数库，不提供 Node.js、浏览器、异步 I/O 或完整 JSR223 API。IF/While 的字符串条件支持 rmeter 变量和 `${__函数(...)}` 表达式，不执行 JavaScript。

JavaScript 采样器、前置处理器和后置处理器的脚本编辑区支持轻量补全：输入前缀或对象后的 `.` 自动提示，也可按 `Ctrl+Space` 唤出；使用 ↑/↓ 选择、Tab/Enter 插入、Esc 关闭，或点击候选项。提示包含参数签名和说明，覆盖 `vars`、`ctx`、`log`、`sampler`、五种 `functions` 函数以及部分 JavaScript 标准接口和关键字；`prev` 仅在后置处理器中提示。补全会保留已有参数括号，字符串、模板文本、注释和输入法组合输入期间不弹出提示。这是已知接口的静态提示，不提供用户变量类型推断或完整语法检查。

### 文件格式与保护

使用 rmeter `version: 1` 的 UTF-8 JSON（读取支持 BOM），不支持 JMX。所有已支持的节点和三类断言均可设置名称，名称写入原生 `name` 字段并显示在节点树或断言列表中。Loop 和 HTTP 默认配置兼容旧脚本省略名称（或 `null`），缺省时显示组件类型名；显式字符串名称不能仅为空白。节点 ID、选中状态和展开状态不写入文件；不提供备注。已支持字段保留缺省/null 区别、请求头与参数重复键和顺序。

含范围外节点、不支持的断言或处理器类型的文件显示原始内容并只读打开，禁止保存覆盖和运行。格式错误、未知字段以及可能无法无损编辑的数据同样只读保护。库支持的 JDBC 类型别名保存时规范为标准类型名。

可以保存尚未通过执行校验的配置；JSON/数值字段的输入格式错误须先修正。保存采用同目录临时文件与原子替换，失败不清除修改标记。

### 响应断言

在 HTTP 或 JDBC 采样器的节点配置底部添加响应断言，可命名、编辑、上下移动和删除。断言附属于采样器，按原生格式写入 `assertions` 数组，保持声明顺序；JavaScript 采样器不提供该配置。

| 类型                          | 可配置内容                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| JSONPath（`type: "json"`）    | JSONPath、等值 / 正则 / 存在 / 不存在、one / any / all 节点范围；期望值按 JSON 类型保存，包括 null |
| XPath（`type: "xml"`）        | XPath、文本等值 / 正则 / 存在 / 不存在、节点范围、命名空间前缀与 URI 映射                          |
| 正则表达式（`type: "regex"`） | 对完整 UTF-8 响应正文匹配 Rust regex，可反向要求不匹配                                             |

`one`（缺省）要求恰好一个节点，`any` 要求至少一个匹配，`all` 要求非空且全部匹配；存在 / 不存在检查不使用节点范围。XPath 等值使用字符串比较，不自动去除空白。JSONPath 正则只匹配字符串节点。表达式及期望值为字面量，不展开 `${变量}`。兼容省略 `type` 的旧 JSONPath 断言，保存时保留该格式。

校验与运行都调用 rmeter；非法 JSONPath、XPath、未绑定的命名空间前缀及非法 Rust 正则在运行前报错。每项断言都会执行，任一失败会使采样失败，即使 HTTP 状态码为 200，并参与线程组错误策略。无需保存响应预览也可执行断言；HTTP 可独立设置 `max_assertion_body_bytes`，JDBC 使用查询结果容量限制。

运行结果表显示每次采样通过的断言数 / 总断言数；选择采样后可查看断言名称、通过 / 失败状态和核心库返回的失败原因。该计数属于断言，顶部统计仍按采样计数。

## 启用与禁用

节点详情的“启用组件”和右键“启用组件 / 禁用组件”控制执行状态；三类断言也有独立开关。状态写入原生 JSON 的 `enabled` 布尔字段，缺省等同于 `true`。禁用后仍可编辑、复制和保存配置，节点树显示“已禁用”；父节点被禁用时后代显示“随父节点禁用”，各子节点自身的状态保持不变。

核心库在编译执行计划前跳过禁用项：禁用采样器不发送请求、不产生结果；禁用控制器或线程组跳过整个子树；禁用 HTTP/JDBC 配置不参与作用域；禁用断言不参与校验和统计。禁用 JavaScript 不编译脚本或启动 worker。已启用的 JDBC 请求若仅引用了被禁用的连接配置，会报缺少连接。全部禁用或禁用测试计划时，运行正常完成，采样数为 0。

禁用节点的执行配置可以暂未填写完整；重新启用后按正常规则校验。编辑器仍保护不支持的组件和字段，格式错误的表单草稿仍需修正后保存。运行期间及只读文件中不能修改启用状态。

## JavaScript 前置与后置处理器

右键点击 HTTP、JDBC 或 JavaScript 采样器，选择“前置处理器”或“后置处理器”添加。处理器支持名称、脚本、超时、变量容量、禁用、复制、删除、同阶段排序以及移动到其他采样器。运行期间锁定编辑。旧脚本中已有的 JavaScript `post_processors` 可直接打开编辑。

执行顺序参考 [JMeter JSR223 PreProcessor](https://jmeter.apache.org/usermanual/component_reference.html#JSR223_PreProcessor) 和 [PostProcessor](https://jmeter.apache.org/usermanual/component_reference.html#JSR223_PostProcessor)：前置 → 采样器 → 后置 → 断言；每个阶段按树内顺序执行，处理器不额外产生采样结果。前置写入的变量供本次请求/SQL 模板展开使用，后置提取的变量可供后续组件使用，各虚拟用户隔离。

| API                                                 | 用途                                                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vars.get/put/set/remove/contains`                  | 读写字符串变量；`vars.getIteration()` 返回从 1 开始的线程组迭代次数                                                                                                                                                 |
| `ctx.groupName/userIndex/iteration/lastSampleOk`    | 只读上下文；userIndex、iteration 从 0 开始，lastSampleOk 表示上一次采样最终状态                                                                                                                                     |
| `ctx.getThreadNum()` / `ctx.getVariables()`         | 当前用户编号 / vars 对象                                                                                                                                                                                            |
| `log.trace/debug/info/warn/error(message, ...args)` | 写入父采样结果中的“脚本日志”，支持 `{}` 占位符；`isDebugEnabled/isInfoEnabled()` 返回 true                                                                                                                          |
| `Label` / `sampler.getName()`                       | 当前处理器名称 / 父采样器名称（只读）                                                                                                                                                                               |
| `prev`（仅后置）                                    | 本次采样的只读快照：body、responseCode、responseMessage、label、elapsedMs、success、bodyUnavailableReason；提供 getResponseDataAsString/getResponseCode/getResponseMessage/getSampleLabel/getTime/isSuccessful 方法 |

这些是 rmeter 的 JavaScript API，不包含 Java 对象、props、浏览器/Node.js、文件或异步 I/O。前置与独立采样器中不提供 prev；JavaScript 采样器的后置可读取本次执行状态，但响应体为 null。HTTP/JDBC 后置可读取完整响应，即使关闭响应保存；HTTP 默认最多 8 MiB，可在采样器表单调整；超限、非 UTF-8 或不完整响应的 body 为 null，并给出原因。JDBC 响应仍是 columns/rows/row_count/rows_affected 结构。

```javascript
// 前置：供采样器中的 ${item_id} 使用
vars.put("item_id", "42");
log.info("当前用户 {}", ctx.getThreadNum());
```

```javascript
// HTTP 后置：提取业务字段
if (!prev.isSuccessful() || prev.body === null) throw new Error("响应不可用");
vars.put("item_id", String(JSON.parse(prev.getResponseDataAsString()).id));
log.info("提取到 ID {}", vars.get("item_id"));
```

处理器异常/超时使父采样失败并应用线程组错误策略；失败处理器的变量修改回滚，之前成功处理器的修改保留，同阶段后续处理器跳过。前置失败时不执行采样器、后置或断言。父采样器禁用时全部处理器跳过；处理器可单独禁用。停止运行会回收 worker。正常采样耗时不包括前后置；前置失败时记录失败阶段耗时。

日志每条最多 4096 UTF-8 字节，每次采样累计最多 100 条 / 64 KiB，超限明确显示截断；日志与响应预览共用 16 MiB 缓存。脚本异常保留已返回日志；worker 被取消或硬超时终止时，尚未返回的日志丢弃。后置现在先于断言执行，旧脚本不可再用 prev.success 判断断言是否通过。

`examples/javascript-processors.json` 使用本地 Mock 和指定 ipds_dev 的只读 SELECT，验证三类采样器的前后置、禁用、变量传递和日志。2 用户 × 2 迭代，共 12 次成功采样、28 条日志；通过 `bun run test:integration` 一起执行。数据库密码仍从环境变量读取。

## HTTP 后置提取器

HTTP 采样器的“后置处理器”菜单支持 JSONPath、XPath、JMESPath、正则表达式、XPath2 五种提取器。它们与 JavaScript 后置处理器混合排列，按树内顺序在响应完成后、断言前执行，输出变量可供后续处理器和采样器使用。支持命名、禁用、复制、删除、排序及移动到其他 HTTP 采样器；不能放到前置、线程组、控制器、JDBC 或 JavaScript 采样器下。

| 类型       | 表达式示例 / 选项                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSONPath   | `$.items[*].id`；匹配节点中的字符串原样保存，其余保存为 JSON 文本，包括 null                                                                            |
| XPath      | XPath 1.0：`//ns:item/@id`，namespaces 配置 `{"ns":"urn:example"}`；节点输出字符串值，也支持标量                                                        |
| JMESPath   | `items[?active].id`；顶层数组按元素匹配，顶层 null 表示无匹配                                                                                           |
| 正则表达式 | `id=(\d+)`，结果模板 `$1$`；`$0$` 为整体匹配，可组合为 `ID=$1$`；使用 Rust regex，不支持环视或回溯引用                                                  |
| XPath2     | 使用 Xee XPath 3.1 引擎执行 XPath 2.0 语法，如 `for $x in //item return upper-case(string($x))`；支持序列、函数和命名空间，空前缀可指定默认元素命名空间 |

共同配置：变量名、提取表达式、匹配序号（默认 1）、默认值、提取超时（默认 1000 ms）、最大匹配数量（默认 1000）、变量容量（默认 1 MiB，含当前用户已有变量）。变量规则参考 [JMeter 提取器](https://jmeter.apache.org/usermanual/component_reference.html#JSON_Extractor)：

- `1`、`2`……取第 N 项，`0` 随机取一项，结果写入 `${变量名}`。
- `-1` 保存全部结果，使用 `${变量名_1}`、`${变量名_2}`……；`${变量名_matchNr}` 始终记录本次匹配总数。
- 无匹配或第 N 项越界时使用默认值。默认值缺省/null 表示不设置基础变量，显式空字符串表示空默认值；全部匹配模式下基础变量维持默认值。
- 正则还保存 `${变量名_g0}`（整体）、`${变量名_g1}`（第 1 组）等及 `${变量名_g}`（组数）；全部模式对应 `${变量名_1_g1}` 等。
- 每次执行清理本组件的旧结果及编号/分组值，避免上次结果残留；禁用组件不执行也不改动变量。

输入为完整 UTF-8 响应正文，独立于结果预览保存，受 HTTP 的“完整响应上限”限制（默认 8 MiB）。不支持响应头/子采样、HTML 容错或 XML DTD/外部实体。XPath2 不注册外部文档、文件或进程环境变量。格式错误、正文不可用、超时、超过匹配数/容量限制会使父采样失败，停止后续后置处理器并遵循线程组错误策略；无匹配本身正常使用默认值。提取成功会在父采样日志中记录匹配数，不额外增加采样数量。

五种提取器均由核心库通过同版本 worker 执行，使用隔离进程的内存限制、超时与取消回收。使用提取器需要随程序分发的 `rmeter-js-worker.exe`；不使用 JavaScript/提取器的 HTTP/JDBC 功能不受 worker 缺失影响。

原生 JSON 保存在 HTTP 的 `post_processors` 数组中，type 分别为 `jsonpath_extractor`、`xpath_extractor`、`jmespath_extractor`、`regex_extractor`、`xpath2_extractor`；五种类型均使用 `expression` 字段。未知组件或无法无损编辑的数据仍只读保护。

`examples/http-extractors.json` 对接本地 Mock Studio，验证五种提取器、JavaScript 混排、禁用草稿、变量传递和后续 HTTP 请求。2 用户 × 2 迭代，共 12 次成功采样、20 次提取和 4 次 JavaScript 检查；已纳入 `bun run test:integration`。

## 定时器

右键“定时器”菜单提供“固定定时器”和“高斯随机定时器”，支持命名、启用/禁用、复制、移动及保存重开。

| 组件           | 配置                                               | 延迟计算                                            |
| -------------- | -------------------------------------------------- | --------------------------------------------------- |
| 固定定时器     | 线程延迟（ms），默认 300                           | 每次等待指定毫秒数                                  |
| 高斯随机定时器 | 偏差（ms），默认 100；固定延迟偏移（ms），默认 300 | `abs(N(0,1) × 偏差 + 偏移)`，截去小数，每次独立抽样 |

按 [JMeter 定时器规则](https://jmeter.apache.org/usermanual/component_reference.html#Timers)，可放在测试计划、线程组、Loop/IF/While 或任意采样器下。作用域内每个采样器都会等待，同级排列位置不影响作用域；放在采样器下仅影响该采样器。外层、当前层和采样器自身的定时器累加执行，不覆盖；多个用户独立等待。空作用域、未进入的条件分支及禁用组件不等待。

执行顺序为前置处理器 → 定时器 → 采样器 → 后置处理器 → 断言。等待不计入采样响应耗时，也不生成独立结果，但计入线程组最长运行时间；停止、窗口退出和通道断开可取消等待。仅使用定时器的 HTTP/JDBC 脚本不依赖 worker。

延迟和偏移使用非负整数毫秒，偏差允许小数；参数及计算结果上限为 9007199254740991 ms。参数支持 `${变量名}`，读取前置处理器执行后的当前用户变量；支持五种原生函数表达式，不解释 `timer.factor` 属性。静态非法值在执行校验时报告；动态变量缺失或非法时父采样失败，返回 `TimerError`，不发送请求，跳过后续处理并遵循线程组错误策略。

原生类型为 `constant_timer`（`name`、`delay_ms`）和 `gaussian_random_timer`（`name`、`deviation_ms`、`offset_ms`）。测试计划/采样器放在 `timers` 数组，线程组/控制器放在 `children` 数组，均可添加 `enabled`。缺省/空数组、字符串变量表达式、禁用草稿和声明顺序均保留。

`examples/timers.json` 使用本地 Mock HTTP、只读 JDBC 和 JavaScript 验证全局、线程组与采样器定时器，2 用户 × 2 轮共 12 次采样。已纳入 `bun run test:integration`，通过用户内相邻采样时间（扣除响应耗时）检查等待间隔；数据库密码从 `RMETER_INTEGRATION_DB_PASSWORD` 环境变量读取。

## JDBC 结果变量

参考 [JMeter JDBC Request](https://jmeter.apache.org/usermanual/component_reference.html#JDBC_Request)，提供两种可独立或同时使用的方式：

| 配置                   | 保存内容与访问方法                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 整表结果变量：`result` | `result` 为 JSONArray 字符串，例如 `[{"id":1,"name":"张三"}]`；`${result_#}` 为行数；JavaScript 使用 `JSON.parse(vars.get("result"))[0].id` |
| 按列变量名：`id,,name` | 按查询列顺序映射，跳过第 2 列；`${id_1}`、`${id_2}` 读取第 1 列各行，`${name_1}` 读取第 3 列第 1 行；`${id_#}`、`${name_#}` 为行数          |

按列名称在原生 JSON 中保存为 `"variable_names": ["id", "", "name"]`，不足的名称跳过后续列，多余名称只有行数。行号从 1 开始。SQL NULL 在整表 JSON 中保留为 null，在按列模式下不设置对应单元格变量；文本不额外加引号，其他值序列化为字符串。两种方式的输出名称须避免冲突。

零行时整表变量为 `[]`、行数为 `0`。每次采样会清除上一次的行变量，查询变少、失败、超时或取消均不会沿用旧结果；变量隔离在各虚拟用户内。原“行数变量”保留为“额外行数变量”，通常无需填写。保存响应体开关不影响结果变量，变量总字节数也受结果容量限制。

整表变量已从旧版的响应包对象改为 JSONArray。旧脚本里的 `result.rows[0][0]` 需改为 `result[0].列名`；项目联动示例已更新。响应详情与断言仍使用原来的 `columns/rows/row_count/rows_affected` 结构。整表对象遇到同名列时后列覆盖前列，可通过 SQL 别名区分。

## 示例与测试

### 配置组件作用域

已核对所固定核心提交的 `src/script.rs` 与 `rmeter-component/src/component.rs`：HTTP 默认配置是独立 `http_defaults` 组件，JDBC 连接配置是独立 `jdbc_connection_configuration` 组件。二者均不产生采样，配置合并、引用及作用域由库编译器处理。

| 配置               | 可放置位置                           | 生效规则                                                                                           |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| HTTP 默认配置      | 线程组、Loop、IF、While 下           | 影响同层及其后代 HTTP 采样器；同层配置按树顺序合并，后者覆盖前者，内层覆盖外层；采样器显式设置优先 |
| 全局 HTTP 默认配置 | 测试计划详情中的全局配置             | 写入根 `defaults`，作为所有线程组的最外层默认值                                                    |
| JDBC 连接配置      | 测试计划、线程组、Loop、IF、While 下 | 同层及后代 JDBC 采样器按连接变量名引用；子作用域同名覆盖，同层重名校验报错                         |

配置作用于整个所在层级，放在采样器之后也生效。内层覆盖不会影响外层兄弟节点或其他线程组。计划下的 JDBC 配置保存为根 `jdbc_connections` 数组，条目不带 `type`；其他位置保存为带 `type` 的组件。

按原生结构，HTTP/JDBC/JavaScript 采样器可添加前置、后置处理器子节点，不能添加配置子节点；处理器在原生 JSON 中保存为 `pre_processors` / `post_processors`，不使用 `children`。HTTP 默认配置包含 `type`、`settings` 和可选的 `name`，名称仅用于编辑器展示，不影响配置作用域。新增 HTTP 采样器不再预填完整 URL，以便继承作用域中的地址；显式填写完整 URL 时，其地址优先于默认配置中的协议、主机、端口和路径。

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

验收入口先读取只读 mock 目录快照，准备同一固定提交的 JavaScript worker，再通过桌面实际使用的任务适配器执行。测试默认忽略，普通 `cargo test` 不访问此远程数据库。目录快照及本次采样响应保存在已忽略的 `.cache/integration/`；密码不写入脚本、报告或 Git。

2026-11-11 实测通过（catalog generation 1）：

| 验收项             | 结果                                                          |
| ------------------ | ------------------------------------------------------------- |
| 线程组             | 2 个用户，各 1 次迭代；每用户独立完成 28 次采样               |
| JDBC 配置 / 采样器 | 连接池配置生效；6 次参数化 SELECT，验证数据库、用户和返回值   |
| JavaScript         | 6 次采样；验证 JDBC 结果，写入 HTTP 路径变量及 While 计数变量 |
| IF                 | 真分支执行，While 结束后假分支跳过                            |
| Loop               | 每用户重复 2 次完整 mock 请求集合                             |
| While              | 每用户执行 2 轮参数查询和变量递增，然后退出                   |
| HTTP               | 44 次请求；全部 10 个路由、11 条规则的状态码和正文逐一匹配    |
| 原生响应断言       | 96 项通过，覆盖 JSONPath、XPath、正文正则，以及 JDBC 查询结果 |
| 任务生命周期       | 单一正常终态，runId 一致，结束后释放活动任务                  |
| 合计               | **56 成功 / 0 失败**                                          |

HTTP 覆盖 `/hello/test` 模板、`/order` 成功及 UnionPay 分支、`/query/42` XML 匹配，以及 `/examples/` 下的 JSONPath、XPath、query、items/42、regex、JSON/XML 模板。UnionPay 规则的 HTTP 状态为 200、业务码为 400，脚本明确断言该预期业务拒绝。HTTP 每次执行 2 项原生断言，JDBC 初始化每次 2 项、While 查询每次 1 项，共 96 项；验收代码同时核对采样正文与断言结果。示例不使用后置处理器。前端测试另行验证此脚本包含全部组件且可无损打开保存。

## 代码边界

`src/model.ts` 管理原生 JSON 与编辑树；`NodeForm.tsx` 提供组件表单；`results.ts` 限制展示缓存；`App.tsx` 负责桌面交互。

`src-tauri/src/bridge.rs` 仅提供文件命令、库调用、任务生命周期和 IPC。解析、组件编译、线程调度、变量、条件、HTTP/JDBC/JavaScript 采样均由 rmeter 提供。接口为 `read_script`、`write_script`、`validate_script`、`start_run`、`stop_run`、`worker_status`、`list_system_fonts`；运行结果带独立 `run_id`，使用 Tauri Channel 批量发送。

## 原生函数与日期格式转换

通过菜单“工具 → 函数生成”打开函数生成器。选择函数后填写参数表格，点击“生成”即可得到函数表达式和 JavaScript 调用语法；各结果旁的复制按钮可复制到系统剪贴板。生成器支持以下全部五种函数，仅生成调用语法，不执行函数或修改测试计划。输入按字面文本自动转义；JavaScript 整数参数以字符串表示，保留 64 位精度。日期格式、地区及日期范围由核心在实际执行时校验。

三类 JavaScript 组件共享只读 `functions` 对象，返回值均为字符串：

```javascript
functions.RandomString(16, 'abcdef0123456789', 'requestId');
functions.changeCase('hello', 'UPPER', 'message');
functions.dateTimeConvert('2024-02-29 12:30:45', 'yyyy-MM-dd HH:mm:ss', 'dd/MM/yyyy', 'day');
functions.Random('9223372036854775807', '9223372036854775807');
functions.RandomDate('', '2024-02-29', '2024-03-01', 'zh_CN', 'randomDay');
```

最后的可选变量名将结果写入当前用户，遵循现有变量容量和脚本失败回滚规则。`Random` 两端包含，支持有符号 64 位整数；超出 JavaScript 安全整数范围时必须传十进制字符串。`RandomString` 长度按 UTF-16 计数，省略字符集可产生控制字符，业务标识建议显式给出字符集。

HTTP、JDBC、连接配置、定时器和 IF/While 中原来支持变量展开的位置，现在也支持 `${__Random(1,100,number)}`、`${__dateTimeConvert(${createdAt},yyyy-MM-dd HH:mm:ss,yyyyMMdd,day)}` 等五种函数。支持嵌套、空参数与参数转义，按从左到右顺序求值；每个字符串展开失败时回滚该字符串的变量写入。JavaScript 源码使用 `functions` 调用，不进行表达式替换。

日期采用 JDK 21 `DateTimeFormatter.ofPattern` 的 ISO/SMART 规则，支持地区文字、周历年、可选段、纳秒和时区。SMART 可能将二月 30 日调整为当月最后一天，这是 Java 的既定行为。源格式为空时输入为 Unix 毫秒时间戳。`RandomDate` 默认格式为 `yyyy-MM-dd`，空起始日期为今天，结束日期不包含且必须晚于起始日期。系统时区和语言在运行开始时固定；普通运行和安装包无需 Java。

非法函数、参数或不可解析日期明确报错，遵循所在组件的错误处理。表达式、参数及结果最大 1 MiB，嵌套最多 32 层，随机字符串最多 262,144 个 UTF-16 单元，日期模式最多 4,096 字节。

打开 `examples/functions.json` 可直接验证全部函数、前后置处理器、条件和定时器：无需 HTTP 或数据库，2 用户 × 2 迭代，预期 4 次成功采样。

## Loop / While 每轮超时

两种控制器均支持 `timeout_ms`，单位毫秒，省略或 `0` 为不限时，只接受非负安全整数（不接受 null、小数和表达式）。JSON 仍为 `version: 1`，旧脚本无需迁移。

每轮开始重新计时，累计嵌套子节点、定时器、前后置处理器和采样器的完整执行时间，结果上报等待不计入预算。到期取消当前节点并退出整个控制器，记录一条名为控制器名称的 `ControllerTimeout` 失败；已完成采样与变量保留，被中断采样不重复计数。嵌套时最早截止者优先，同一截止时间外层优先。遵循线程组“采样错误后”策略，“继续”从该控制器之后继续。

[离线示例](examples/loop-timeouts.json) 无需 HTTP 或数据库；预期 4 条记录，2 条成功、2 条控制器超时失败。需要同版本 JavaScript worker。
