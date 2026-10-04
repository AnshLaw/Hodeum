//! Stack Exchange (Super User): questions with an accepted answer, then those answers' text. Real
//! solution steps for Excel and Windows, not the question excerpts the search endpoint returns.

use std::time::Duration;

use serde_json::Value;

use super::body::{read_capped, MAX_ANSWER_BYTES};
use super::source::{with_params, SourceError, SourceId};
use super::text::{clip, fragment_text, plain, squash};
use super::WebResult;

const SEARCH_URL: &str = "https://api.stackexchange.com/2.3/search/advanced";
const ANSWERS_URL: &str = "https://api.stackexchange.com/2.3/answers";
const SITE: &str = "superuser";
const PAGE_SIZE: &str = "3";
const SNIPPET_CHARS: usize = 300;
/// Below this, say so in the log: keyless use is 300 calls a day per IP.
const LOW_QUOTA: u64 = 30;

#[derive(Debug, PartialEq)]
pub struct Question {
    pub title: String,
    pub link: String,
    pub accepted: u64,
}

/// The API's `backoff` (seconds), which it says clients must honour, and a spent quota.
pub fn rest_asked(json: &Value) -> Option<Duration> {
    if let Some(quota) = json.get("quota_remaining").and_then(Value::as_u64) {
        if quota < LOW_QUOTA {
            eprintln!("Stack Exchange quota is low: {quota} calls left today");
        }
        if quota == 0 {
            return Some(SourceId::StackExchange.cooldown());
        }
    }
    json.get("backoff").and_then(Value::as_u64).map(Duration::from_secs)
}

pub fn parse_questions(json: &Value) -> Vec<Question> {
    let items = json.get("items").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    items
        .iter()
        .filter_map(|q| {
            let link = q.get("link")?.as_str()?.to_string();
            let accepted = q.get("accepted_answer_id")?.as_u64()?;
            link.starts_with("https://").then(|| Question { title: plain(q.get("title").and_then(Value::as_str).unwrap_or_default()), link, accepted })
        })
        .collect()
}

/// Each accepted answer's text under its question's title and link, in question order.
pub fn parse_answers(json: &Value, questions: &[Question]) -> Vec<WebResult> {
    let items = json.get("items").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    questions
        .iter()
        .filter_map(|q| {
            let answer = items.iter().find(|a| a.get("answer_id").and_then(Value::as_u64) == Some(q.accepted))?;
            let body = fragment_text(answer.get("body").and_then(Value::as_str)?);
            Some(WebResult { title: q.title.clone(), url: q.link.clone(), snippet: clip(&squash(&body), SNIPPET_CHARS), source: SourceId::StackExchange.label().into(), body })
        })
        .collect()
}

async fn get(client: &reqwest::Client, url: &str, params: &[(&str, &str)]) -> Result<Value, SourceError> {
    let response = client.get(with_params(url, params)?).header("Accept", "application/json").send().await.map_err(|e| SourceError::from_reqwest(&e))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(SourceError::from_status(SourceId::StackExchange, status));
    }
    let text = read_capped(response, MAX_ANSWER_BYTES).await?;
    serde_json::from_str(&text).map_err(|e| SourceError::Parse(e.to_string()))
}

/// Two calls; a `backoff` from either is passed to `rest` so the next search waits as asked.
pub async fn search(client: &reqwest::Client, query: &str, rest: impl Fn(Duration)) -> Result<Vec<WebResult>, SourceError> {
    let params = [("order", "desc"), ("sort", "relevance"), ("q", query), ("accepted", "True"), ("site", SITE), ("pagesize", PAGE_SIZE)];
    let found = get(client, SEARCH_URL, &params).await?;
    if let Some(wait) = rest_asked(&found) {
        rest(wait);
    }
    let questions = parse_questions(&found);
    if questions.is_empty() {
        return Ok(Vec::new());
    }
    let ids = questions.iter().map(|q| q.accepted.to_string()).collect::<Vec<_>>().join(";");
    let answers = get(client, &format!("{ANSWERS_URL}/{ids}"), &[("site", SITE), ("filter", "withbody")]).await?;
    if let Some(wait) = rest_asked(&answers) {
        rest(wait);
    }
    Ok(parse_answers(&answers, &questions))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pairs_accepted_answers_with_their_questions() {
        let questions = json!({ "items": [
            { "question_id": 492351, "accepted_answer_id": 492357, "link": "https://superuser.com/questions/492351/freeze", "title": "Freeze top row &amp; columns" },
            { "question_id": 1, "link": "https://superuser.com/questions/1/open", "title": "No accepted answer" }
        ], "quota_remaining": 276 });
        let questions = parse_questions(&questions);
        assert_eq!(questions, vec![Question { title: "Freeze top row & columns".into(), link: "https://superuser.com/questions/492351/freeze".into(), accepted: 492357 }]);
        let answers = json!({ "items": [{ "answer_id": 492357, "body": "<p>Go to the <code>View</code> ribbon and click <code>Freeze Panes</code>&hellip;</p>" }] });
        let results = parse_answers(&answers, &questions);
        assert_eq!(results[0].body, "Go to the View ribbon and click Freeze Panes…");
        assert_eq!(results[0].url, "https://superuser.com/questions/492351/freeze");
    }

    #[test]
    fn honours_backoff_and_a_spent_quota() {
        assert_eq!(rest_asked(&json!({ "backoff": 10, "quota_remaining": 200 })), Some(Duration::from_secs(10)));
        assert_eq!(rest_asked(&json!({ "quota_remaining": 0 })), Some(SourceId::StackExchange.cooldown()));
        assert_eq!(rest_asked(&json!({ "quota_remaining": 200 })), None);
    }
}
