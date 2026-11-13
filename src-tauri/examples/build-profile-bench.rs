//! Release-profile comparison of the real rmeter engine; no external services.
//! Run via scripts/benchmark-build-profiles.ts to keep the worker and server fixed.
use rmeter::{
    Engine, RunEvent,
    function::{Environment, Expression, FunctionContext, Source, date_time_convert},
    report::{ReportEvent, RunSummary},
};
use serde_json::{Value, json};
use std::{collections::HashMap, hint::black_box, time::Instant};

struct FixedSource(u64);
impl Source for FixedSource {
    fn now_millis(&mut self) -> i64 {
        1_709_210_000_000
    }
    fn random_u64(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

fn measurement(name: &str, operations: u64, elapsed: f64) -> Value {
    json!({"name":name, "operations":operations, "seconds":elapsed,
        "operations_per_second":operations as f64 / elapsed})
}

fn native_cases(scale: u64) -> Vec<Value> {
    let environment = Environment {
        timezone: "UTC".into(),
        locale: "en-US".into(),
    };
    let expression = Expression::compile(
        "${__changeCase(${name},upper)}-${__Random(1,100000)}-${__RandomString(24,abcdef0123456789)}"
    ).unwrap();
    let mut variables = HashMap::from([("name".into(), "load-test".into())]);
    let mut source = FixedSource(0x1234_5678_9abc_def0);
    let mut context = FunctionContext {
        variables: &mut variables,
        environment: &environment,
        source: &mut source,
    };
    for _ in 0..1000 {
        black_box(expression.evaluate(&mut context).unwrap());
    }
    let n = 200_000 * scale;
    let start = Instant::now();
    let mut checksum = 0usize;
    for _ in 0..n {
        let value = expression.evaluate(black_box(&mut context)).unwrap();
        assert!(value.starts_with("LOAD-TEST-"));
        checksum += black_box(value).len();
    }
    let mut result = vec![measurement(
        "native_expression",
        n,
        start.elapsed().as_secs_f64(),
    )];
    black_box(checksum);

    let convert = || {
        date_time_convert(
            black_box("2024-02-29 12:30:45"),
            "yyyy-MM-dd HH:mm:ss",
            "dd/MM/yyyy HH:mm:ss",
            &environment,
        )
        .unwrap()
    };
    for _ in 0..1000 {
        black_box(convert());
    }
    let n = 100_000 * scale;
    let start = Instant::now();
    for _ in 0..n {
        assert_eq!(black_box(convert()), "29/02/2024 12:30:45");
    }
    result.push(measurement(
        "date_conversion",
        n,
        start.elapsed().as_secs_f64(),
    ));
    result
}

fn http_node(url: &str) -> Value {
    json!({"type":"http_request", "name":"HTTP ${__changeCase(ok,upper)}", "url":url,
        "assertions":[{"type":"regex", "name":"payload", "pattern":"benchmark-payload"}]})
}

fn plan(children: Vec<Value>, users: usize, iterations: u64) -> String {
    json!({"version":1, "name":"profile benchmark",
        "defaults":{"use_system_proxy":false,"save_response_body":true,"request_timeout_ms":10000},
        "groups":[{"name":"users","users":users,"iterations":iterations,"children":children}]})
    .to_string()
}

fn parse_case(url: &str, scale: u64) -> Value {
    let source = plan((0..24).map(|_| http_node(url)).collect(), 16, 1);
    for _ in 0..3 {
        black_box(rmeter::parse_script(&source).unwrap());
    }
    let n = 200 * scale;
    let start = Instant::now();
    for _ in 0..n {
        let compiled = rmeter::parse_script(black_box(&source)).unwrap();
        assert_eq!(compiled.groups[0].children.len(), 24);
        black_box(compiled);
    }
    measurement("parse_24_http_nodes", n, start.elapsed().as_secs_f64())
}

async fn engine_case(name: &str, source: &str, expected: u64) -> Value {
    // Parsing is measured separately; retain reporting/serialization work during execution.
    let compiled = rmeter::parse_script(source).unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::channel(1024);
    let start = Instant::now();
    let collector = tokio::spawn(async move {
        let mut summary = RunSummary::default();
        let mut latencies = Vec::new();
        let mut serialized_bytes = 0usize;
        while let Some(event) = rx.recv().await {
            summary.observe(&event);
            if let RunEvent::SampleCompleted(sample) = &event {
                assert!(
                    sample.result.success,
                    "{:?}",
                    sample.result.response_message
                );
                latencies.push(sample.result.elapsed.as_secs_f64() * 1000.0);
            }
            serialized_bytes +=
                black_box(serde_json::to_vec(&ReportEvent::from(event)).unwrap()).len();
        }
        (summary, latencies, serialized_bytes)
    });
    tokio::time::timeout(
        std::time::Duration::from_secs(120),
        Engine::new(compiled).run(tx),
    )
    .await
    .unwrap()
    .unwrap();
    let (summary, mut latencies, bytes) = collector.await.unwrap();
    let elapsed = start.elapsed().as_secs_f64();
    assert_eq!(summary.samples, expected);
    assert_eq!(summary.passed, expected);
    assert_eq!(summary.failed, 0);
    assert!(summary.finished);
    latencies.sort_by(f64::total_cmp);
    let mut result = measurement(name, expected, elapsed);
    result["p50_ms"] = json!(latencies[latencies.len() / 2]);
    result["p95_ms"] = json!(latencies[(latencies.len() - 1) * 95 / 100]);
    result["serialized_bytes"] = json!(bytes);
    result
}

fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert!(
        args.len() >= 3,
        "usage: build-profile-bench <loopback-url> <worker-path> [scale]"
    );
    let url = &args[1];
    assert!(
        url.starts_with("http://127.0.0.1:"),
        "only local fixtures are allowed"
    );
    rmeter::component::javascript::set_worker_executable(&args[2]).unwrap();
    let scale: u64 = args.get(3).map(|v| v.parse().unwrap()).unwrap_or(1);
    assert!((1..=20).contains(&scale));
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let mut cases = native_cases(scale);
        cases.push(parse_case(url, scale));
        engine_case("warmup_http", &plan(vec![http_node(url)], 16, 10), 160).await;
        cases.push(engine_case("http_16_users", &plan(vec![http_node(url)], 16, 1000*scale), 16000*scale).await);
        let js = json!({"type":"javascript","name":"JS roundtrip","timeout_ms":5000,
            "script":"let sum = 0; for (let i = 0; i < 10000; i++) sum += i; if (sum !== 49995000) throw Error('sum'); vars.put('sum', String(sum));"});
        engine_case("warmup_js", &plan(vec![js.clone()], 4, 1), 4).await;
        cases.push(engine_case("javascript_4_users", &plan(vec![js], 4, 8*scale), 32*scale).await);
        println!("{}", json!({"cases":cases}));
    });
}
