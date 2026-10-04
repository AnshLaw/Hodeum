//! Asks sources in order and keeps the first that finds something relevant. A slow source doesn't
//! hold up the rest: the next one starts after a short hedge delay, and the whole chain has a budget.

use std::future::Future;
use std::time::Duration;

use tauri::async_runtime::{self, JoinHandle, Sender};
use tokio::time::Instant;

use super::source::{SourceError, SourceId};
use super::WebResult;

pub type Outcome = Result<Vec<WebResult>, SourceError>;

#[derive(Debug, PartialEq)]
pub struct Hit {
    pub id: SourceId,
    pub results: Vec<WebResult>,
}

pub type Failures = Vec<(SourceId, SourceError)>;

/// Sources started so far, and how to start the next.
struct Running<F> {
    ids: Vec<SourceId>,
    next: usize,
    pending: Vec<(SourceId, JoinHandle<()>)>,
    run: F,
    tx: Sender<(SourceId, Outcome)>,
}

impl<F, Fut> Running<F>
where
    F: Fn(SourceId) -> Fut,
    Fut: Future<Output = Outcome> + Send + 'static,
{
    fn has_more(&self) -> bool {
        self.next < self.ids.len()
    }

    fn launch(&mut self) {
        let id = self.ids[self.next];
        self.next += 1;
        let (tx, work) = (self.tx.clone(), (self.run)(id));
        let handle = async_runtime::spawn(async move {
            // The receiver is gone once a winner is chosen; a late answer has nowhere to go.
            let _ = tx.send((id, work.await)).await;
        });
        self.pending.push((id, handle));
    }

    fn stop_all(&mut self) {
        for (_, handle) in self.pending.drain(..) {
            handle.abort();
        }
    }
}

/// The first non-empty result list, and why every source asked before it (or still running at the
/// deadline) didn't answer.
pub async fn first_hit<F, Fut>(ids: &[SourceId], hedge: Duration, budget: Duration, run: F) -> (Option<Hit>, Failures)
where
    F: Fn(SourceId) -> Fut,
    Fut: Future<Output = Outcome> + Send + 'static,
{
    let (tx, mut rx) = async_runtime::channel::<(SourceId, Outcome)>(ids.len().max(1));
    let deadline = Instant::now() + budget;
    let mut state = Running { ids: ids.to_vec(), next: 0, pending: Vec::new(), run, tx };
    let mut failures = Vec::new();
    if state.has_more() {
        state.launch();
    }
    while (!state.pending.is_empty() || state.has_more()) && Instant::now() < deadline {
        let left = deadline - Instant::now();
        let wait = if state.has_more() { hedge.min(left) } else { left };
        let Ok(received) = tokio::time::timeout(wait, rx.recv()).await else {
            // Slow answer: start the next source alongside it.
            if state.has_more() && Instant::now() < deadline {
                state.launch();
            }
            continue;
        };
        let Some((id, outcome)) = received else { break };
        state.pending.retain(|(p, _)| *p != id);
        match outcome {
            Ok(results) if !results.is_empty() => {
                state.stop_all();
                return (Some(Hit { id, results }), failures);
            }
            Ok(_) => failures.push((id, SourceError::NothingRelevant)),
            Err(error) => failures.push((id, error)),
        }
        // A failed source frees its slot: ask the next one now rather than at the hedge.
        if state.has_more() {
            state.launch();
        }
    }
    failures.extend(state.pending.iter().map(|(id, _)| (*id, SourceError::TimedOut)));
    state.stop_all();
    (None, failures)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEDGE: Duration = Duration::from_millis(80);
    const BUDGET: Duration = Duration::from_millis(600);

    fn found(id: SourceId) -> Vec<WebResult> {
        vec![WebResult { title: id.label().into(), url: "https://x".into(), snippet: String::new(), source: id.label().into(), body: String::new() }]
    }

    /// A fake source: answers `outcome` after `ms`.
    fn after(ms: u64, outcome: Outcome) -> impl Future<Output = Outcome> + Send + 'static {
        async move {
            tokio::time::sleep(Duration::from_millis(ms)).await;
            outcome
        }
    }

    #[test]
    fn falls_through_failures_to_the_first_source_that_finds_something() {
        let ids = [SourceId::Exa, SourceId::DuckDuckGo, SourceId::StackExchange];
        let (hit, failures) = async_runtime::block_on(first_hit(&ids, HEDGE, BUDGET, |id| match id {
            SourceId::Exa => after(5, Err(SourceError::RateLimited(Duration::from_secs(900)))),
            SourceId::DuckDuckGo => after(5, Ok(vec![])),
            _ => after(5, Ok(found(id))),
        }));
        assert_eq!(hit.map(|h| h.id), Some(SourceId::StackExchange));
        assert_eq!(failures, vec![(SourceId::Exa, SourceError::RateLimited(Duration::from_secs(900))), (SourceId::DuckDuckGo, SourceError::NothingRelevant)]);
    }

    #[test]
    fn a_slow_source_is_hedged_by_the_next_one() {
        let ids = [SourceId::Exa, SourceId::DuckDuckGo];
        let started = std::time::Instant::now();
        let (hit, failures) = async_runtime::block_on(first_hit(&ids, HEDGE, BUDGET, |id| match id {
            SourceId::Exa => after(500, Ok(found(id))),
            _ => after(10, Ok(found(id))),
        }));
        assert_eq!(hit.map(|h| h.id), Some(SourceId::DuckDuckGo));
        assert!(failures.is_empty());
        assert!(started.elapsed() < Duration::from_millis(400), "{:?}", started.elapsed());
    }

    #[test]
    fn gives_up_at_the_budget_and_says_who_was_still_running() {
        let ids = [SourceId::Exa];
        let (hit, failures) = async_runtime::block_on(first_hit(&ids, HEDGE, BUDGET, |id| after(5_000, Ok(found(id)))));
        assert_eq!(hit, None);
        assert_eq!(failures, vec![(SourceId::Exa, SourceError::TimedOut)]);
    }

    #[test]
    fn every_source_failing_lists_every_reason() {
        let ids = [SourceId::DuckDuckGo, SourceId::StackExchange];
        let (hit, failures) = async_runtime::block_on(first_hit(&ids, HEDGE, BUDGET, |_| after(1, Err(SourceError::Blocked))));
        assert_eq!(hit, None);
        assert_eq!(failures.len(), 2);
    }
}
