use rmeter::{
    Engine,
    report::{ReportEvent, RunSummary},
};
use serde::Serialize;
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::ipc::Channel;
use tokio::sync::{mpsc, watch};

const PREVIEW_BYTES: usize = 64 * 1024;
#[cfg(test)]
mod integration_tests;

static NEXT_RUN: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct Active {
    id: String,
    cancel: watch::Sender<bool>,
    done: watch::Receiver<bool>,
}
#[derive(Default, Clone)]
pub struct RunManager(Arc<Mutex<Option<Active>>>);
impl RunManager {
    pub fn cancel(&self) {
        if let Ok(guard) = self.0.lock()
            && let Some(active) = guard.as_ref()
        {
            let _ = active.cancel.send(true);
        }
    }
    fn register(&self) -> Result<(String, watch::Receiver<bool>, watch::Sender<bool>), String> {
        let mut guard = self.0.lock().map_err(|_| "运行状态不可用")?;
        if guard.is_some() {
            return Err("已有测试正在运行或停止中".into());
        }
        let id = NEXT_RUN.fetch_add(1, Ordering::Relaxed).to_string();
        let (cancel, receiver) = watch::channel(false);
        let (done, completed) = watch::channel(false);
        *guard = Some(Active {
            id: id.clone(),
            cancel,
            done: completed,
        });
        Ok((id, receiver, done))
    }
    fn clear(&self, id: &str) {
        if let Ok(mut guard) = self.0.lock()
            && guard.as_ref().is_some_and(|active| active.id == id)
        {
            *guard = None;
        }
    }
    async fn stop(&self, id: &str) -> Result<(), String> {
        let active = self
            .0
            .lock()
            .map_err(|_| "运行状态不可用")?
            .as_ref()
            .filter(|a| a.id == id)
            .cloned();
        if let Some(mut active) = active {
            let _ = active.cancel.send(true);
            if !*active.done.borrow() {
                let _ = active.done.changed().await;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
pub struct Preview {
    event: ReportEvent,
    body_truncated: bool,
}
impl Preview {
    fn from_event(event: rmeter::RunEvent) -> Self {
        let mut event = ReportEvent::from(event);
        let mut body_truncated = false;
        if let ReportEvent::SampleCompleted {
            response_body: Some(body),
            ..
        } = &mut event
        {
            body_truncated = body.len() > PREVIEW_BYTES;
            body.truncate(PREVIEW_BYTES);
        }
        Self {
            event,
            body_truncated,
        }
    }
}
#[derive(Clone, Serialize)]
pub struct RunMessage {
    run_id: String,
    status: &'static str,
    events: Vec<Preview>,
    summary: RunSummary,
    error: Option<String>,
}
fn message(
    id: &str,
    status: &'static str,
    events: &mut Vec<Preview>,
    summary: &RunSummary,
    error: Option<String>,
) -> RunMessage {
    RunMessage {
        run_id: id.into(),
        status,
        events: std::mem::take(events),
        summary: summary.clone(),
        error,
    }
}

async fn execute(
    source: String,
    id: &str,
    cancel: &mut watch::Receiver<bool>,
    send: &mut (impl FnMut(RunMessage) -> bool + Send),
    summary: &mut RunSummary,
    pending: &mut Vec<Preview>,
) -> (&'static str, Option<String>) {
    if !send(message(id, "running", pending, summary, None)) {
        return ("cancelled", None);
    }
    // Compilation can start an isolated JS worker; keep it off Tauri's runtime.
    // A stop during compilation is honoured before any engine is created.
    let parsed = tokio::task::spawn_blocking(move || rmeter::parse_script(&source)).await;
    if *cancel.borrow() {
        return ("cancelled", None);
    }
    let plan = match parsed {
        Ok(Ok(plan)) => plan,
        Ok(Err(error)) => return ("failed", Some(error.to_string())),
        Err(error) => return ("failed", Some(format!("脚本校验任务失败：{error}"))),
    };
    let engine = Engine::new(plan);
    let (sender, mut receiver) = mpsc::channel(256);
    let mut execution = Box::pin(engine.run(sender));
    let mut timer = tokio::time::interval(Duration::from_millis(50));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut stream_open = true;
    let result = loop {
        tokio::select! {
            biased;
            _ = cancel.changed() => break ("cancelled", None),
            result = &mut execution => break match result {
                Ok(()) => ("completed", None),
                Err(error) => ("failed", Some(error.to_string())),
            },
            event = receiver.recv(), if stream_open => {
                if let Some(event) = event {
                    summary.observe(&event);
                    pending.push(Preview::from_event(event));
                    if pending.len() >= 100 && !send(message(id, "running", pending, summary, None)) { break ("cancelled", None); }
                } else { stream_open = false; }
            },
            _ = timer.tick() => {
                if !send(message(id, "running", pending, summary, None)) { break ("cancelled", None); }
            }
        }
    };
    drop(execution); // rmeter aborts its users and in-flight samplers on drop.
    while let Ok(event) = receiver.try_recv() {
        summary.observe(&event);
        pending.push(Preview::from_event(event));
        if pending.len() >= 100 {
            let _ = send(message(id, "running", pending, summary, None));
        }
    }
    result
}

#[tauri::command]
pub async fn start_run(
    source: String,
    channel: Channel<RunMessage>,
    state: tauri::State<'_, RunManager>,
) -> Result<String, String> {
    launch_run(source, state.inner().clone(), move |event| {
        channel.send(event).is_ok()
    })
}

fn launch_run(
    source: String,
    manager: RunManager,
    mut send: impl FnMut(RunMessage) -> bool + Send + 'static,
) -> Result<String, String> {
    let (id, mut cancel, done) = manager.register()?;
    let run_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let mut summary = RunSummary::default();
        let mut events = Vec::new();
        let (status, error) = execute(
            source,
            &run_id,
            &mut cancel,
            &mut send,
            &mut summary,
            &mut events,
        )
        .await;
        manager.clear(&run_id);
        let _ = send(message(&run_id, status, &mut events, &summary, error));
        let _ = done.send(true);
    });
    Ok(id)
}
#[tauri::command]
pub async fn stop_run(run_id: String, state: tauri::State<'_, RunManager>) -> Result<(), String> {
    state.stop(&run_id).await
}
#[tauri::command]
pub async fn validate_script(source: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        rmeter::parse_script(&source)
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_script(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("读取失败：{e}"))
}
fn atomic_write(path: &Path, source: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(source.as_bytes())
        .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path)
        .map_err(|e| format!("保存失败，原文件未替换：{}", e.error))?;
    Ok(())
}
#[tauri::command]
pub async fn write_script(path: String, source: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || atomic_write(Path::new(&path), &source))
        .await
        .map_err(|e| e.to_string())?
}
pub fn configure_worker() -> Result<(), String> {
    let name = format!("rmeter-js-worker{}", std::env::consts::EXE_SUFFIX);
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let sibling = executable.with_file_name(&name);
    let path: PathBuf = if sibling.is_file() {
        sibling
    } else if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!(
                "rmeter-js-worker-{}{}",
                env!("RMETER_TARGET"),
                std::env::consts::EXE_SUFFIX
            ))
    } else {
        sibling
    };
    rmeter::component::javascript::set_worker_executable(path).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn worker_status() -> Result<(), String> {
    configure_worker()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    struct HttpFixture {
        url: String,
        requests: Arc<AtomicU64>,
        task: tokio::task::JoinHandle<()>,
    }
    impl Drop for HttpFixture {
        fn drop(&mut self) {
            self.task.abort();
        }
    }
    async fn http_fixture(status: u16, body: Vec<u8>) -> HttpFixture {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/test", listener.local_addr().unwrap());
        let requests = Arc::new(AtomicU64::new(0));
        let count = requests.clone();
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let mut request = [0; 8192];
                if socket.read(&mut request).await.is_err() {
                    continue;
                }
                count.fetch_add(1, Ordering::Relaxed);
                let header = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(header.as_bytes()).await;
                let _ = socket.write_all(&body).await;
            }
        });
        HttpFixture {
            url,
            requests,
            task,
        }
    }
    fn plan(children: Value) -> Value {
        json!({"version":1,"name":"adapter test","groups":[{"name":"users","children":children}]})
    }
    fn request(url: &str) -> Value {
        json!({"type":"http_request","name":"HTTP","url":url,"settings":{"use_system_proxy":false,"save_response_body":true}})
    }
    pub(super) async fn collect(source: Value) -> (String, RunSummary, Vec<Preview>) {
        let (_stop, mut cancel) = watch::channel(false);
        let mut summary = RunSummary::default();
        let mut pending = Vec::new();
        let mut events = Vec::new();
        let result = tokio::time::timeout(
            Duration::from_secs(20),
            execute(
                source.to_string(),
                "test",
                &mut cancel,
                &mut |batch| {
                    events.extend(batch.events);
                    true
                },
                &mut summary,
                &mut pending,
            ),
        )
        .await
        .unwrap();
        assert!(result.1.is_none(), "{:?}", result.1);
        events.extend(pending);
        (result.0.into(), summary, events)
    }
    #[test]
    fn atomic_replace_and_failed_save_preserve_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.json");
        atomic_write(&path, "first").unwrap();
        atomic_write(&path, "second").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");
        assert!(atomic_write(&dir.path().join("missing/plan.json"), "bad").is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "second");
    }
    #[tokio::test]
    async fn disabled_components_skip_execution_and_empty_plans_complete() {
        let fixture = http_fixture(200, b"ok".to_vec()).await;
        let mut active = request(&fixture.url);
        active["assertions"] = json!([{"type":"regex","enabled":false,"pattern":"["}]);
        let mut source = plan(json!([
            {"type":"loop","enabled":false,"count":"infinite","children":[active.clone()]},
            {"type":"javascript","enabled":false,"script":"invalid syntax ("},
            {"type":"http_defaults","enabled":false,"settings":{"host":"wrong.test"}},
            active
        ]));
        source["jdbc_connections"] = json!([{"enabled":false,"url":"invalid"}]);
        let (status, summary, events) = collect(source.clone()).await;
        assert_eq!(status, "completed");
        assert_eq!(summary.samples, 1);
        assert_eq!(summary.passed, 1);
        for preview in events {
            if let ReportEvent::SampleCompleted { assertions, .. } = preview.event {
                assert!(assertions.is_empty());
            }
        }
        source["groups"][0]["enabled"] = json!(false);
        let (status, summary, _) = collect(source.clone()).await;
        assert_eq!(status, "completed");
        assert_eq!(summary.samples, 0);
        assert!(summary.finished);
        source["enabled"] = json!(false);
        source["groups"] = json!("inactive configuration");
        let (status, summary, _) = collect(source).await;
        assert_eq!(status, "completed");
        assert_eq!(summary.samples, 0);
        assert_eq!(fixture.requests.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn native_http_sampler_lists_replace_defaults_or_inherit_when_unset() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for _ in 0..6 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut chunk = [0; 1024];
                    let count = socket.read(&mut chunk).await.unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&chunk[..count]);
                    if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                    assert!(bytes.len() < 8192);
                }
                requests.push(String::from_utf8(bytes).unwrap().to_ascii_lowercase());
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                    )
                    .await
                    .unwrap();
            }
            requests
        });
        let headers = json!([["X-Own", "one"], ["X-Own", "two"]]);
        let query = json!([["own", "one"], ["own", "two"]]);
        let settings = [
            json!({}),
            json!({"headers":null,"query":null}),
            json!({"headers":[],"query":[]}),
            json!({"headers":headers}),
            json!({"query":query}),
            json!({"headers":headers,"query":query,"path":"/own","request_timeout_ms":null}),
        ];
        let mut children: Vec<Value> = settings.into_iter().enumerate().map(|(index, settings)| {
            json!({"type":"http_request","name":format!("case {index}"),"settings":settings})
        }).collect();
        children.push(
            json!({"type":"http_defaults","name":"内层 HTTP 默认配置","settings":{
                "path":"/scope","headers":[["X-Scope","scope"]],"query":[["scope","scope"]]
            }}),
        );
        let source = json!({"version":1,"name":"list replacement","defaults":{
            "host":"127.0.0.1","port":port,"path":"/root","save_response_body":true,
            "headers":[["X-Root","root"]],"query":[["root","root"]]
        },"groups":[{"name":"group","children":[{"type":"loop","name":"带名称的循环","count":1,"children":children}]}]});
        let (status, summary, events) = collect(source).await;
        assert_eq!(status, "completed");
        assert_eq!(summary.samples, 6);
        assert_eq!(summary.passed, 6);
        for preview in events {
            if let ReportEvent::SampleCompleted { response_body, .. } = preview.event {
                assert_eq!(response_body.as_deref(), Some(b"ok".as_slice()));
            }
        }
        let requests = tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
        for (index, request) in requests.iter().enumerate() {
            let target = match index {
                0 | 1 | 3 => "/scope?root=root&scope=scope",
                2 => "/scope",
                4 => "/scope?own=one&own=two",
                5 => "/own?own=one&own=two",
                _ => unreachable!(),
            };
            assert!(
                request.starts_with(&format!("get {target} http/1.1\r\n")),
                "{request}"
            );
            let inherits_headers = matches!(index, 0 | 1 | 4);
            assert_eq!(
                request.contains("\r\nx-root: root\r\n"),
                inherits_headers,
                "{request}"
            );
            assert_eq!(
                request.contains("\r\nx-scope: scope\r\n"),
                inherits_headers,
                "{request}"
            );
            assert_eq!(
                request.matches("\r\nx-own:").count(),
                if matches!(index, 3 | 5) { 2 } else { 0 }
            );
        }
    }
    #[tokio::test]
    async fn jdbc_same_scope_duplicates_are_rejected_but_nested_overrides_are_valid() {
        let connection = json!({"type":"jdbc_connection_configuration", "name":"pool", "variable_name":"db", "url":"postgresql://127.0.0.1/test"});
        let source = plan(json!([connection.clone(), connection.clone()]));
        assert!(
            validate_script(source.to_string())
                .await
                .unwrap_err()
                .contains("duplicate JDBC connection")
        );
        let mut global = connection.clone();
        global.as_object_mut().unwrap().remove("type");
        let mut source = plan(json!([]));
        source["jdbc_connections"] = json!([global.clone(), global.clone()]);
        assert!(
            validate_script(source.to_string())
                .await
                .unwrap_err()
                .contains("duplicate JDBC connection")
        );
        source["jdbc_connections"] = json!([global]);
        source["groups"][0]["children"] =
            json!([connection.clone(), {"type":"loop","count":1,"children":[connection]}]);
        validate_script(source.to_string()).await.unwrap();
    }
    #[tokio::test]
    async fn manager_rejects_duplicate_and_ignores_stale_stop() {
        let state = RunManager::default();
        let (id, receiver, done) = state.register().unwrap();
        assert!(state.register().is_err());
        state.stop("stale").await.unwrap();
        assert!(!*receiver.borrow());
        state.cancel();
        assert!(*receiver.borrow());
        state.clear(&id);
        let _ = done.send(true);
        state.stop(&id).await.unwrap();
        assert!(state.register().is_ok());
    }
    #[tokio::test]
    async fn invalid_script_and_pre_cancelled_parse_have_terminal_status() {
        let (stop, mut cancel) = watch::channel(false);
        let mut summary = RunSummary::default();
        let mut pending = Vec::new();
        let result = execute(
            "{}".into(),
            "1",
            &mut cancel,
            &mut |_| true,
            &mut summary,
            &mut pending,
        )
        .await;
        assert_eq!(result.0, "failed");
        stop.send(true).unwrap();
        let result = execute(
            "{}".into(),
            "2",
            &mut cancel,
            &mut |_| true,
            &mut summary,
            &mut pending,
        )
        .await;
        assert_eq!(result.0, "cancelled");
    }
    #[tokio::test]
    async fn closed_frontend_cancels_before_execution() {
        let (_stop, mut cancel) = watch::channel(false);
        let result = execute(
            "{}".into(),
            "1",
            &mut cancel,
            &mut |_| false,
            &mut RunSummary::default(),
            &mut Vec::new(),
        )
        .await;
        assert_eq!(result.0, "cancelled");
    }
    #[tokio::test]
    async fn stop_during_startup_emits_one_terminal_and_releases_manager() {
        configure_worker().unwrap();
        let state = RunManager::default();
        let messages = Arc::new(Mutex::new(Vec::new()));
        let output = messages.clone();
        let script = plan(
            json!([{"type":"javascript","name":"compile","script":"while (true) {}", "timeout_ms":1000}]),
        );
        let id = launch_run(script.to_string(), state.clone(), move |m| {
            output.lock().unwrap().push(m);
            true
        })
        .unwrap();
        assert!(state.register().is_err());
        tokio::time::timeout(Duration::from_secs(5), state.stop(&id))
            .await
            .unwrap()
            .unwrap();
        state.stop(&id).await.unwrap();
        let messages = messages.lock().unwrap();
        assert_eq!(messages.iter().filter(|m| m.status != "running").count(), 1);
        assert_eq!(messages.last().unwrap().status, "cancelled");
        assert!(state.0.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn live_javascript_cancellation_reclaims_worker() {
        configure_worker().unwrap();
        let state = RunManager::default();
        let messages = Arc::new(Mutex::new(Vec::new()));
        let output = messages.clone();
        let script = plan(
            json!([{"type":"javascript","name":"slow","script":"while (true) {}", "timeout_ms":60000}]),
        );
        let id = launch_run(script.to_string(), state.clone(), move |m| {
            output.lock().unwrap().push(m);
            true
        })
        .unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        tokio::time::timeout(Duration::from_secs(3), state.stop(&id))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(messages.lock().unwrap().last().unwrap().status, "cancelled");
        // A fresh sampler must still obtain a worker slot after cancellation.
        let (_, summary, _) = collect(plan(
            json!([{"type":"javascript","name":"next","script":"vars.put('ok', 'true');"}]),
        ))
        .await;
        assert_eq!(summary.passed, 1);
    }
    #[tokio::test]
    async fn http_loop_if_thread_iterations_and_preview_limits() {
        let server = http_fixture(200, vec![65; PREVIEW_BYTES + 500]).await;
        let mut script = plan(json!([
            {"type":"loop","count":2,"children":[request(&server.url)]},
            {"type":"if","name":"skip","condition":false,"children":[request(&server.url)]}
        ]));
        script["groups"][0]["users"] = json!(2);
        script["groups"][0]["iterations"] = json!(2);
        let (status, summary, events) = collect(script).await;
        assert_eq!(status, "completed");
        assert!(summary.finished);
        assert_eq!(summary.samples, 8);
        assert_eq!(summary.passed, 8);
        assert_eq!(server.requests.load(Ordering::Relaxed), 8);
        for preview in events {
            if let ReportEvent::SampleCompleted { response_body, .. } = preview.event {
                assert!(preview.body_truncated);
                assert_eq!(response_body.unwrap().len(), PREVIEW_BYTES);
            }
        }
    }
    #[tokio::test]
    async fn http_failure_obeys_stop_user_policy() {
        let server = http_fixture(500, b"failure".to_vec()).await;
        let mut script = plan(json!([request(&server.url), request(&server.url)]));
        script["groups"][0]["on_error"] = json!("stop_user");
        let (_, summary, _) = collect(script).await;
        assert_eq!(summary.samples, 1);
        assert_eq!(summary.failed, 1);
    }
    #[tokio::test]
    async fn http_defaults_apply_to_siblings_and_descendants_without_scope_leaks() {
        let global = http_fixture(200, b"global".to_vec()).await;
        let group = http_fixture(200, b"group".to_vec()).await;
        let inner = http_fixture(200, b"inner".to_vec()).await;
        let explicit = http_fixture(200, b"explicit".to_vec()).await;
        let port = |server: &HttpFixture| {
            server
                .url
                .strip_prefix("http://127.0.0.1:")
                .unwrap()
                .split('/')
                .next()
                .unwrap()
                .parse::<u16>()
                .unwrap()
        };
        let sample = |name: &str| json!({"type":"http_request","name":name});
        let config =
            |server: &HttpFixture| json!({"type":"http_defaults","settings":{"port":port(server)}});
        let mut source = plan(json!([
            sample("before"),
            {"type":"if","name":"inherit","condition":true,"children":[sample("descendant")]},
            {"type":"loop","count":1,"children":[sample("inner"), config(&inner)]},
            sample("after"),
            {"type":"http_request","name":"settings override","settings":{"port":port(&explicit)}},
            {"type":"http_request","name":"URL override","url":explicit.url},
            config(&global), config(&group)
        ]));
        source["defaults"] = json!({"protocol":"http","host":"127.0.0.1","port":port(&global),"path":"/test","save_response_body":true,"use_system_proxy":false});
        source["groups"]
            .as_array_mut()
            .unwrap()
            .push(json!({"name":"other group","children":[sample("global")]}));
        let (_, summary, events) = collect(source).await;
        assert_eq!(summary.samples, 7);
        assert_eq!(summary.passed, 7);
        let mut actual = std::collections::BTreeMap::new();
        for preview in events {
            if let ReportEvent::SampleCompleted {
                label,
                response_body,
                ..
            } = preview.event
            {
                actual.insert(label, String::from_utf8(response_body.unwrap()).unwrap());
            }
        }
        for (label, body) in [
            ("before", "group"),
            ("descendant", "group"),
            ("inner", "inner"),
            ("after", "group"),
            ("settings override", "explicit"),
            ("URL override", "explicit"),
            ("global", "global"),
        ] {
            assert_eq!(actual.get(label).map(String::as_str), Some(body), "{label}");
        }
        assert_eq!(global.requests.load(Ordering::Relaxed), 1);
        assert_eq!(group.requests.load(Ordering::Relaxed), 3);
        assert_eq!(inner.requests.load(Ordering::Relaxed), 1);
        assert_eq!(explicit.requests.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn http_sampler_children_are_rejected_by_native_format() {
        let mut sampler = request("http://127.0.0.1:1/never-called");
        sampler["children"] = json!([{"type":"http_defaults","settings":{"host":"127.0.0.1"}}]);
        assert!(
            validate_script(plan(json!([sampler])).to_string())
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn response_assertions_are_evaluated_by_core_and_forwarded_in_order() {
        let json_server = http_fixture(
            200,
            br#"{"code":200,"value":null,"items":["ready","ready"]}"#.to_vec(),
        )
        .await;
        let xml_server = http_fixture(
            200,
            br#"<o:order xmlns:o="urn:orders"><o:status>paid</o:status></o:order>"#.to_vec(),
        )
        .await;
        let mut json_request = request(&json_server.url);
        json_request["settings"]["save_response_body"] = json!(false);
        json_request["assertions"] = json!([
            {"type":"json","name":"typed equality","path":"$.code","matcher":{"type":"equals","expected":200}},
            {"name":"legacy null","path":"$.value","matcher":{"type":"equals","expected":null}},
            {"type":"json","name":"all","path":"$.items[*]","selection":"all","matcher":{"type":"regex","pattern":"^ready$"}},
            {"type":"json","name":"any","path":"$.items[*]","selection":"any","matcher":{"type":"equals","expected":"ready"}},
            {"type":"json","name":"missing","path":"$.missing","matcher":{"type":"not_exists"}},
            {"type":"regex","name":"no errors","pattern":"ERROR","invert":true}
        ]);
        let mut xml_request = request(&xml_server.url);
        xml_request["assertions"] = json!([
            {"type":"xml","name":"namespaced XPath","xpath":"/o:order/o:status/text()","namespaces":{"o":"urn:orders"},"matcher":{"type":"equals","expected":"paid"}},
            {"type":"xml","name":"exists","xpath":"/*","matcher":{"type":"exists"}},
            {"type":"xml","name":"XPath regex","xpath":"string(/*)","matcher":{"type":"regex","pattern":"^paid$"}},
            {"type":"regex","name":"XML body regex","pattern":"<o:status>paid</o:status>"}
        ]);
        let (_, summary, events) =
            collect(plan(json!([json_request.clone(), xml_request.clone()]))).await;
        assert_eq!(summary.passed, 2);
        let samples: Vec<_> = events
            .iter()
            .filter_map(|p| match &p.event {
                ReportEvent::SampleCompleted {
                    assertions,
                    response_body,
                    ..
                } => Some((assertions, response_body)),
                _ => None,
            })
            .collect();
        assert_eq!(
            samples[0]
                .0
                .iter()
                .map(|a| a.name.as_str())
                .collect::<Vec<_>>(),
            [
                "typed equality",
                "legacy null",
                "all",
                "any",
                "missing",
                "no errors"
            ]
        );
        assert!(
            samples[0].1.is_none(),
            "assertions must work without saving response previews"
        );
        assert_eq!(samples[1].0.len(), 4);
        assert!(
            samples
                .iter()
                .flat_map(|(a, _)| a.iter())
                .all(|a| a.success)
        );

        json_request["assertions"][0]["matcher"]["expected"] = json!("200");
        json_request["assertions"][5]["pattern"] = json!("ready");
        xml_request["assertions"][0]["matcher"]["expected"] = json!("unpaid");
        let (_, summary, events) = collect(plan(json!([json_request.clone(), xml_request]))).await;
        assert_eq!(summary.failed, 2);
        let failures: Vec<_> = events
            .iter()
            .flat_map(|p| match &p.event {
                ReportEvent::SampleCompleted { assertions, .. } => {
                    assertions.iter().filter(|a| !a.success).collect::<Vec<_>>()
                }
                _ => vec![],
            })
            .collect();
        assert_eq!(failures.len(), 3);
        assert!(
            failures
                .iter()
                .all(|a| a.message.as_ref().is_some_and(|m| !m.is_empty()))
        );
        let mut stop_plan = plan(json!([json_request, request(&json_server.url)]));
        stop_plan["groups"][0]["on_error"] = json!("stop_user");
        let (_, summary, _) = collect(stop_plan).await;
        assert_eq!(
            summary.samples, 1,
            "assertion failure must trigger the engine error policy"
        );
        assert_eq!(summary.failed, 1);
    }

    #[tokio::test]
    async fn invalid_assertion_expressions_fail_validation_before_running() {
        for assertion in [
            json!({"type":"json","name":"bad path","path":"$[","matcher":{"type":"exists"}}),
            json!({"type":"xml","name":"bad XPath","xpath":"//*[","matcher":{"type":"exists"}}),
            json!({"type":"xml","name":"missing namespace","xpath":"/o:order","matcher":{"type":"exists"}}),
            json!({"type":"regex","name":"bad regex","pattern":"["}),
        ] {
            let mut sampler = request("http://127.0.0.1:1/never-called");
            sampler["assertions"] = json!([assertion]);
            assert!(
                validate_script(plan(json!([sampler])).to_string())
                    .await
                    .is_err()
            );
        }
    }
    #[tokio::test]
    async fn cancellation_stops_infinite_loop_and_allows_future_runs() {
        let server = http_fixture(200, vec![]).await;
        let script =
            plan(json!([{"type":"loop","count":"infinite","children":[request(&server.url)]}]));
        let (stop, mut cancel) = watch::channel(false);
        let mut summary = RunSummary::default();
        let mut pending = Vec::new();
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            execute(
                script.to_string(),
                "infinite",
                &mut cancel,
                &mut |batch| {
                    if batch.summary.samples >= 2 {
                        let _ = stop.send(true);
                    }
                    true
                },
                &mut summary,
                &mut pending,
            ),
        )
        .await
        .unwrap();
        assert_eq!(result.0, "cancelled");
        assert!(!summary.finished);
        let count = server.requests.load(Ordering::Relaxed);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(server.requests.load(Ordering::Relaxed) <= count + 1);
        assert_eq!(
            collect(plan(json!([request(&server.url)]))).await.1.passed,
            1
        );
    }
    #[tokio::test]
    async fn javascript_variables_drive_while_and_if_and_surface_errors() {
        configure_worker().unwrap();
        let server = http_fixture(200, b"ok".to_vec()).await;
        let script = plan(json!([
            {"type":"javascript","name":"init","script":"vars.put('again', 'true');"},
            {"type":"while","name":"once","condition":"${again}","children":[
                {"type":"if","name":"enabled","condition":"${again}","children":[request(&server.url)]},
                {"type":"javascript","name":"end","script":"vars.put('again', 'false');"}
            ]},
            {"type":"javascript","name":"error","script":"throw new Error('expected error');"},
            {"type":"javascript","name":"timeout","script":"while (true) {}","timeout_ms":10}
        ]));
        let (_, summary, events) = collect(script).await;
        assert_eq!(summary.samples, 5);
        assert_eq!(summary.passed, 3);
        assert_eq!(summary.failed, 2);
        assert_eq!(server.requests.load(Ordering::Relaxed), 1);
        assert!(events.iter().any(|p| matches!(&p.event, ReportEvent::SampleCompleted { response_code: Some(code), .. } if code == "Timeout")));
    }
    #[test]
    fn missing_worker_probe() {
        if std::env::var_os("RMETER_MISSING_WORKER_PROBE").is_none() {
            return;
        }
        let script =
            plan(json!([{"type":"javascript","name":"js","script":"vars.put('x', '1');"}]));
        assert!(rmeter::parse_script(&script.to_string()).is_err());
        assert!(rmeter::parse_script(&plan(json!([])).to_string()).is_ok());
    }
    #[test]
    fn absent_worker_is_reported_without_disabling_other_components() {
        let missing = tempfile::tempdir().unwrap();
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "bridge::tests::missing_worker_probe",
                "--nocapture",
            ])
            .env("RMETER_MISSING_WORKER_PROBE", "1")
            .env(
                "RMETER_JS_WORKER",
                missing.path().join("missing-worker.exe"),
            )
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stdout)
        );
    }
    #[tokio::test]
    #[ignore = "requires an isolated PostgreSQL database in RMETER_TEST_POSTGRES_URL"]
    async fn jdbc_parameters_updates_scopes_errors_and_cancellation() {
        let url = std::env::var("RMETER_TEST_POSTGRES_URL").expect("use a dedicated test database");
        let connection = json!({"type":"jdbc_connection_configuration","name":"local","variable_name":"db","url":url});
        let select = json!({"type":"jdbc_request","name":"select","connection":"db","sql":"SELECT $1::integer AS answer","parameters":[42]});
        let update = json!({"type":"jdbc_request","name":"update","connection":"db","query_type":"update","sql":"DO $$ BEGIN PERFORM 1; END $$"});
        let (_, summary, events) = collect(plan(json!([connection.clone(),select.clone(),update,
            {"type":"loop","count":1,"children":[connection.clone(),select]},
            {"type":"jdbc_request","name":"error","connection":"db","sql":"SELECT * FROM rmeter_nonexistent_table"}
        ]))).await;
        assert_eq!(summary.passed, 3);
        assert_eq!(summary.failed, 1);
        assert!(events.iter().any(|p| matches!(&p.event, ReportEvent::SampleCompleted { response_body: Some(body), .. } if String::from_utf8_lossy(body).contains("42"))));
        let (stop, mut cancel) = watch::channel(false);
        let mut summary = RunSummary::default();
        let mut pending = Vec::new();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let _ = stop.send(true);
        });
        let result = tokio::time::timeout(Duration::from_secs(3), execute(plan(json!([connection,{"type":"jdbc_request","name":"slow","connection":"db","sql":"SELECT pg_sleep(10)"}])).to_string(), "jdbc", &mut cancel, &mut |_| true, &mut summary, &mut pending)).await.unwrap();
        assert_eq!(result.0, "cancelled");
    }
}
