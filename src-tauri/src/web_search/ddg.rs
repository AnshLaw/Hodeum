//! DuckDuckGo's HTML page (unofficial). Best ranking for help-center pages, but it serves an anomaly
//! (bot-check) page after a few quick calls, so the caller spaces calls out and rests it when blocked.

use scraper::{Html, Selector};

use super::source::{with_params, SourceError, SourceId};
use super::text::{clip, squash};
use super::WebResult;

pub const URL: &str = "https://html.duckduckgo.com/html/";
/// DuckDuckGo answers 202 with a bot check instead of results.
const HTTP_ACCEPTED: u16 = 202;
const ANOMALY_MARKERS: [&str; 2] = ["anomaly-modal", "anomaly.js"];
const SNIPPET_CHARS: usize = 300;
/// Redirect links point here; ads go through `/y.js`.
const REDIRECT_PARAM: &str = "uddg";

fn selector(css: &str) -> Selector {
    Selector::parse(css).expect("built-in selector is valid")
}

/// The real address behind DuckDuckGo's `//duckduckgo.com/l/?uddg=…` redirect.
pub fn target(href: &str) -> Option<String> {
    let absolute = if href.starts_with("//") { format!("https:{href}") } else { href.to_string() };
    let url = reqwest::Url::parse(&absolute).ok()?;
    let real = if url.host_str().is_some_and(|h| h.ends_with("duckduckgo.com")) {
        url.query_pairs().find(|(k, _)| k == REDIRECT_PARAM).map(|(_, v)| v.into_owned())?
    } else {
        absolute
    };
    real.starts_with("https://").then_some(real)
}

pub fn parse(status: u16, html: &str) -> Result<Vec<WebResult>, SourceError> {
    if status == HTTP_ACCEPTED || ANOMALY_MARKERS.iter().any(|m| html.contains(m)) {
        return Err(SourceError::Blocked);
    }
    let document = Html::parse_document(html);
    let (link, snippet) = (selector("a.result__a"), selector(".result__snippet"));
    let results = document
        .select(&selector("div.result"))
        .filter(|r| !r.value().classes().any(|c| c == "result--ad"))
        .filter_map(|r| {
            let anchor = r.select(&link).next()?;
            let url = target(anchor.value().attr("href")?)?;
            let text = r.select(&snippet).next().map(|s| squash(&s.text().collect::<String>())).unwrap_or_default();
            Some(WebResult { title: squash(&anchor.text().collect::<String>()), url, snippet: clip(&text, SNIPPET_CHARS), source: SourceId::DuckDuckGo.label().into(), body: String::new() })
        })
        .collect();
    Ok(results)
}

pub async fn search(client: &reqwest::Client, query: &str) -> Result<Vec<WebResult>, SourceError> {
    let response = client.get(with_params(URL, &[("q", query)])?).header("Accept", "text/html").send().await.map_err(|e| SourceError::from_reqwest(&e))?;
    let status = response.status().as_u16();
    let html = response.text().await.map_err(|e| SourceError::from_reqwest(&e))?;
    if !(200..300).contains(&status) {
        return Err(SourceError::from_status(SourceId::DuckDuckGo, status));
    }
    parse(status, &html)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = include_str!("fixtures/ddg_pin.html");

    #[test]
    fn reads_results_skips_ads_and_unwraps_redirects() {
        let results = parse(200, PAGE).unwrap();
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].title, "How to pin or unpin a chat | WhatsApp Help Center");
        assert_eq!(results[0].url, "https://faq.whatsapp.com/645907560577342/");
        assert!(results[0].snippet.starts_with("Pin chat allows you to pin up to three chats"));
        assert!(results.iter().all(|r| !r.title.contains("Download WhatsApp Tool")));
    }

    #[test]
    fn a_bot_check_is_blocked_not_empty() {
        assert_eq!(parse(202, ""), Err(SourceError::Blocked));
        assert_eq!(parse(200, r#"<form id="challenge-form" action="//duckduckgo.com/anomaly.js?sv=html">"#), Err(SourceError::Blocked));
    }

    #[test]
    fn keeps_only_secure_real_links() {
        assert_eq!(target("//duckduckgo.com/l/?uddg=https%3A%2F%2Fsupport.microsoft.com%2Fx&rut=1"), Some("https://support.microsoft.com/x".into()));
        assert_eq!(target("//duckduckgo.com/l/?uddg=http%3A%2F%2Fexample.com"), None);
        assert_eq!(target("https://duckduckgo.com/y.js?ad_domain=x"), None);
    }
}
