//! Live check against the real services (network, rate limits): run by hand with
//! `cargo test --lib web_search::live -- --ignored --nocapture`. Six queries stays under Exa's free
//! limit (about 9 calls in a few minutes).

use std::time::{Duration, Instant};

use tauri::async_runtime;

use super::{client, search};

const QUERIES: [&str; 6] = [
    "make a pivot table in excel",
    "pin a chat in whatsapp desktop",
    "zip files in file explorer windows 11",
    "turn on dark mode windows 11",
    "open a new tab in brave",
    "calculate a percentage in windows calculator",
];
/// A pause between queries, gentle on the free tiers.
const PAUSE: Duration = Duration::from_secs(3);
const SHOWN_PAGE_CHARS: usize = 240;

/// One call to each fallback source (and the page reader), so a broken parser shows up even while
/// Exa answers everything in the chain.
#[test]
#[ignore = "calls the real web; run by hand"]
fn each_fallback_source_once() {
    let client = client().expect("web client");
    let query = "freeze top row in excel";
    let started = Instant::now();
    let ddg = async_runtime::block_on(super::ddg::search(client, query));
    println!("DuckDuckGo ({} ms): {:?}", started.elapsed().as_millis(), ddg.as_ref().map(|r| r.iter().take(3).map(|x| x.url.clone()).collect::<Vec<_>>()));
    let started = Instant::now();
    let stack = async_runtime::block_on(super::stack::search(client, query, |wait| println!("Stack Exchange asked to wait {wait:?}")));
    println!("Stack Exchange ({} ms): {:?}", started.elapsed().as_millis(), stack.as_ref().map(|r| r.iter().map(|x| x.title.clone()).collect::<Vec<_>>()));
    let page = super::WebResult { title: "Pin a chat".into(), url: "https://faq.whatsapp.com/645907560577342/?cms_platform=windows-desktop".into(), snippet: String::new(), source: String::new(), body: String::new() };
    let started = Instant::now();
    let (pages, failures) = async_runtime::block_on(super::read::read_pages(client, &[page], "pin a chat whatsapp", Duration::from_secs(6)));
    println!("Read WhatsApp FAQ via Jina ({} ms): {:?} {:?}", started.elapsed().as_millis(), pages.first().map(|p| p.text.clone()), failures);
    let highlights = "is a powerful tool to calculate, summarize ... and analyze data ".repeat(8);
    let vendor = super::WebResult { title: "Create a PivotTable".into(), url: "https://support.microsoft.com/en-us/excel/get-started/create-a-pivottable-to-analyze-worksheet-data".into(), snippet: String::new(), source: String::new(), body: highlights };
    let started = Instant::now();
    let (pages, failures) = async_runtime::block_on(super::read::read_pages(client, &[vendor], "make a pivot table in excel", Duration::from_secs(6)));
    println!("Read Microsoft's page over Exa's highlights ({} ms): {:?} {:?}", started.elapsed().as_millis(), pages.first().map(|p| p.text.clone()), failures);
    let brave = super::WebResult { title: "Brave shortcuts".into(), url: "https://support.brave.app/hc/en-us/articles/360032272171-What-keyboard-shortcuts-can-I-use-in-Brave".into(), snippet: String::new(), source: String::new(), body: String::new() };
    let (pages, failures) = async_runtime::block_on(super::read::read_pages(client, &[brave], "open a new tab in brave", Duration::from_secs(6)));
    println!("Read Brave's shortcut table: {:?} {:?}", pages.first().map(|p| p.text.clone()), failures);
}

#[test]
#[ignore = "calls the real web; run by hand"]
fn six_learner_questions() {
    let client = client().expect("web client");
    for query in QUERIES {
        let started = Instant::now();
        let outcome = async_runtime::block_on(search(client, query));
        println!("\n=== {query}  ({} ms)", started.elapsed().as_millis());
        match outcome {
            Ok(found) => {
                println!("source: {}  failures: {:?}", if found.provider.is_empty() { "none" } else { &found.provider }, found.failures);
                for r in found.results.iter().take(3) {
                    println!("  - {} <{}>", r.title, r.url);
                }
                for p in &found.pages {
                    println!("  page {} ({} chars): {}", p.url, p.text.chars().count(), super::text::clip(&p.text.replace('\n', " | "), SHOWN_PAGE_CHARS));
                }
            }
            Err(e) => println!("error: {e}"),
        }
        std::thread::sleep(PAUSE);
    }
}
