//! Opt-in acceptance against the user's Mock Studio and PostgreSQL endpoints.
use super::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[tokio::test]
#[ignore = "requires Mock Studio on :9080 and RMETER_INTEGRATION_DB_PASSWORD for ipds_dev"]
async fn mock_jdbc_all_components() {
    let password = std::env::var("RMETER_INTEGRATION_DB_PASSWORD")
        .expect("set RMETER_INTEGRATION_DB_PASSWORD in the process environment");
    assert!(!password.is_empty(), "database password is empty");
    configure_worker().unwrap();
    let source = include_str!("../../../examples/mock-jdbc-all-components.json");
    let manager = RunManager::default();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let run_id = launch_run(source.into(), manager.clone(), move |batch| {
        sender.send(batch).is_ok()
    })
    .unwrap();
    let messages = tokio::time::timeout(Duration::from_secs(40), async {
        let mut messages = Vec::new();
        while let Some(message) = receiver.recv().await {
            messages.push(message);
        }
        messages
    })
    .await;
    if messages.is_err() {
        manager.stop(&run_id).await.unwrap();
        panic!("integration run exceeded 40 seconds");
    }
    let messages = messages.unwrap();
    let terminal = messages.last().expect("missing terminal message");
    let events: Vec<_> = messages.iter().flat_map(|m| &m.events).collect();
    // Save only results, never the source or process environment. Redact the
    // credential as an additional safeguard if a dependency includes it in errors.
    if let Ok(path) = std::env::var("RMETER_INTEGRATION_REPORT") {
        let readable_events: Vec<Value> = events
            .iter()
            .map(|preview| {
                let mut item = serde_json::to_value(preview).unwrap();
                if let ReportEvent::SampleCompleted {
                    response_body: Some(body),
                    ..
                } = &preview.event
                {
                    item["event"]["response_body"] = json!(String::from_utf8_lossy(body));
                }
                item
            })
            .collect();
        let report = json!({
            "run_id": run_id, "status": terminal.status, "summary": terminal.summary,
            "error": terminal.error, "events": readable_events
        });
        std::fs::write(
            path,
            serde_json::to_string_pretty(&report)
                .unwrap()
                .replace(&password, "[REDACTED]"),
        )
        .unwrap();
    }
    assert!(messages.iter().all(|m| m.run_id == run_id));
    assert_eq!(messages.iter().filter(|m| m.status != "running").count(), 1);
    assert!(manager.0.lock().unwrap().is_none());
    assert_eq!(terminal.status, "completed");
    assert!(terminal.error.is_none());
    assert!(terminal.summary.finished);
    for preview in &events {
        if let ReportEvent::SampleCompleted {
            label,
            success,
            response_code,
            response_message,
            ..
        } = &preview.event
        {
            assert!(
                success,
                "{} failed: {:?} {}",
                label,
                response_code,
                response_message
                    .as_deref()
                    .unwrap_or("")
                    .replace(&password, "[REDACTED]")
            );
        }
    }
    assert_eq!(terminal.summary.samples, 56);
    assert_eq!(terminal.summary.passed, 56);
    assert_eq!(terminal.summary.failed, 0);

    let mut per_user: BTreeMap<usize, BTreeMap<String, Vec<Value>>> = BTreeMap::new();
    for preview in events {
        if let ReportEvent::SampleCompleted {
            user_index,
            label,
            response_code,
            response_body,
            ..
        } = &preview.event
        {
            assert!(!preview.body_truncated);
            if label.starts_with("HTTP ") {
                assert_eq!(response_code.as_deref(), Some("200"));
            }
            if label.starts_with("JDBC ") {
                assert_eq!(response_code.as_deref(), Some("00000"));
            }
            let text = response_body
                .as_ref()
                .map(|b| String::from_utf8_lossy(b).trim().to_owned())
                .unwrap_or_default();
            let body = serde_json::from_str(&text).unwrap_or(json!(text));
            per_user
                .entry(*user_index)
                .or_default()
                .entry(label.clone())
                .or_default()
                .push(body);
        }
    }
    assert_eq!(per_user.len(), 2, "thread group must run both users");
    for samples in per_user.values() {
        let expected = [
            (
                "HTTP hello",
                json!({"code":200,"message":"rmeter明年这个时候你是21岁"}),
            ),
            (
                "HTTP order success",
                json!({"code":200,"message":"下单成功"}),
            ),
            (
                "HTTP order UnionPay",
                json!({"code":400,"message":"不支持银联支付方式"}),
            ),
            (
                "HTTP XML path",
                json!("<information>\n<id>12</id>\n<message>232432</message>\n</information>"),
            ),
            ("HTTP JSONPath", json!({"matched":"jsonpath"})),
            ("HTTP XPath", json!({"matched":"xpath"})),
            ("HTTP query", json!({"matched":"query"})),
            ("HTTP path", json!({"matched":"path","id":42})),
            ("HTTP regex", json!({"matched":"regex"})),
            ("HTTP JSON template", json!({"message":"Hello, rmeter!"})),
            (
                "HTTP XML template",
                json!("<greeting>Hello, rmeter!</greeting>"),
            ),
        ];
        for (label, body) in expected {
            assert_eq!(
                samples.get(label),
                Some(&vec![body.clone(), body]),
                "mock response or Loop count: {label}"
            );
        }
        assert_eq!(samples["JDBC initialize"].len(), 1);
        assert_eq!(
            samples["JDBC initialize"][0]["rows"],
            json!([["ipds_dev", "postgres", 42]])
        );
        assert_eq!(samples["JavaScript initialize"].len(), 1);
        let steps = &samples["JDBC while parameter"];
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0]["rows"], json!([[0, "rmeter"]]));
        assert_eq!(steps[1]["rows"], json!([[1, "rmeter"]]));
        assert_eq!(samples["JavaScript advance"].len(), 2);
        assert!(
            !samples.contains_key("MUST NOT RUN"),
            "false IF must skip its sampler"
        );
        assert_eq!(samples.values().map(Vec::len).sum::<usize>(), 28);
    }
    println!(
        "All eight components passed: 2 users; 44 HTTP, 6 JDBC, 6 JavaScript samples; all 11 mock rules verified."
    );
}
