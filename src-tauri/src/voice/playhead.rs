//! Which chunk of an utterance Hodey's speaker is playing, so each one is announced (`tts:segment`) as it
//! starts. Chunks are appended to the player as they're synthesized and play back to back, and the player
//! counts the sounds it still holds: whatever was appended and isn't held any more has played out, and the
//! first one still held is playing.

use std::ops::Range;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;

/// How often the watcher looks at the player: well inside the 50 ms a highlight may trail the voice.
const LOOK_EVERY: Duration = Duration::from_millis(20);
const WATCHER_THREAD: &str = "hodey-segments";

/// How many chunks have started playing: `appended` were handed to the player and it still holds `queued` of
/// them (the first of those is playing). None while it holds more than that: an append not yet heard of.
pub fn started(appended: usize, queued: usize) -> Option<usize> {
    let played_out = appended.checked_sub(queued)?;
    Some(played_out + usize::from(queued > 0))
}

/// The chunks to announce after the first `announced`: each one that started since, in order, so a chunk that
/// played out between two looks is still announced. It never goes back.
pub fn due(announced: usize, appended: usize, queued: usize) -> Range<usize> {
    let started = started(appended, queued).unwrap_or(announced);
    announced..started.max(announced)
}

/// One utterance's chunks, in the order they were handed to the player, and how many were announced.
#[derive(Default)]
pub struct Playhead {
    texts: Vec<String>,
    announced: usize,
}

impl Playhead {
    pub fn appended(&mut self, text: String) {
        self.texts.push(text);
    }

    /// The chunks (index from 0, and text) that started since the last call, given the sounds the player holds.
    pub fn advance(&mut self, queued: usize) -> impl Iterator<Item = (usize, &str)> {
        let due = due(self.announced, self.texts.len(), queued);
        self.announced = due.end;
        let first = due.start;
        let texts = self.texts.get(due).unwrap_or_default();
        texts.iter().enumerate().map(move |(offset, text)| (first + offset, text.as_str()))
    }
}

/// Tells the watcher about each chunk right after it was appended to the player, so the player's count can
/// only be ahead of what the watcher knows: a chunk may be announced a look late, never early.
pub struct Chunks(Option<Sender<String>>);

impl Chunks {
    pub fn appended(&self, text: &str) {
        // None: the watcher couldn't start, which was logged then.
        let Some(watcher) = &self.0 else { return };
        if watcher.send(text.to_string()).is_err() {
            log::error!("Hodey's sentence watcher stopped early; the highlights won't follow the rest of this line");
        }
    }
}

/// Announces each chunk as it starts playing, until `chunks` closes because the utterance is over (played
/// out, stopped or failed). The last look announces any chunk that started since the one before.
fn watch(chunks: Receiver<String>, queued: impl Fn() -> usize, mut announce: impl FnMut(usize, &str)) {
    let mut playhead = Playhead::default();
    loop {
        let over = match chunks.recv_timeout(LOOK_EVERY) {
            Ok(text) => {
                playhead.appended(text);
                false
            }
            Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => true,
        };
        for (index, text) in playhead.advance(queued()) {
            announce(index, text);
        }
        if over {
            return;
        }
    }
}

/// Runs `speak` while a watcher thread announces each chunk it hands over (through `Chunks`) as that chunk
/// starts playing. `queued` is how many sounds the player holds. The watcher ends once `speak` returns.
pub fn watching<T>(queued: impl Fn() -> usize + Send, announce: impl FnMut(usize, &str) + Send, speak: impl FnOnce(&Chunks) -> T) -> T {
    thread::scope(|scope| {
        let (tell, chunks) = mpsc::channel();
        let watcher = thread::Builder::new().name(WATCHER_THREAD.into()).spawn_scoped(scope, move || watch(chunks, queued, announce));
        let told = match watcher {
            Ok(_) => Chunks(Some(tell)),
            Err(e) => {
                log::warn!("couldn't follow which sentence Hodey is saying; the highlights won't follow its voice: {e}");
                Chunks(None)
            }
        };
        // `told` is dropped when `speak` returns, which closes the channel and ends the watcher.
        speak(&told)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::num::NonZero;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::{self, RecvTimeoutError, TryRecvError};
    use std::time::Duration;

    use rodio::buffer::SamplesBuffer;
    use rodio::{ChannelCount, Player, SampleRate};

    const MONO: ChannelCount = NonZero::<u16>::MIN;
    const RATE: SampleRate = NonZero::new(24_000).unwrap();
    /// A tenth of a second of sound at `RATE`.
    const CHUNK: usize = 2_400;
    /// Far longer than the watcher ever takes to notice a change.
    const PATIENCE: Duration = Duration::from_secs(2);
    /// Several of the watcher's looks.
    const A_FEW_LOOKS: Duration = Duration::from_millis(100);

    fn sound(samples: usize) -> SamplesBuffer {
        SamplesBuffer::new(MONO, RATE, vec![0.5; samples])
    }

    /// The audio device pulling `samples` from the player.
    fn play(output: &mut impl Iterator<Item = f32>, samples: usize) {
        output.take(samples).for_each(drop);
    }

    fn announced(playhead: &mut Playhead, queued: usize) -> Vec<(usize, String)> {
        playhead.advance(queued).map(|(index, text)| (index, text.to_string())).collect()
    }

    fn segment(index: usize, text: &str) -> (usize, String) {
        (index, text.to_string())
    }

    #[test]
    fn counts_the_chunk_playing_and_those_played_out_as_started() {
        assert_eq!(started(0, 0), Some(0), "nothing handed over yet");
        assert_eq!(started(1, 1), Some(1), "the first is playing");
        assert_eq!(started(2, 2), Some(1), "the second waits behind it");
        assert_eq!(started(2, 1), Some(2), "the first played out, the second is playing");
        assert_eq!(started(2, 0), Some(2), "both played out; the next isn't synthesized yet");
        assert_eq!(started(1, 2), None, "the player holds an append the watcher hasn't heard of");
    }

    #[test]
    fn announces_each_chunk_once_in_order() {
        assert_eq!(due(0, 0, 0), 0..0);
        assert_eq!(due(0, 1, 1), 0..1);
        assert_eq!(due(1, 2, 2), 1..1, "the first is still playing");
        assert_eq!(due(1, 2, 1), 1..2);
        assert_eq!(due(1, 3, 1), 1..3, "one that played out between two looks is still announced");
        assert_eq!(due(2, 1, 2), 2..2, "a count ahead of the watcher waits for the next look");
        assert_eq!(due(3, 3, 3), 3..3, "never back");
    }

    #[test]
    fn follows_the_chunk_a_real_player_is_playing() {
        let (player, mut output) = Player::new();
        let mut playhead = Playhead::default();
        player.append(sound(CHUNK));
        playhead.appended("Nice work so far,".into());
        assert_eq!(announced(&mut playhead, player.len()), [segment(0, "Nice work so far,")], "it plays as soon as it's appended");
        player.append(sound(CHUNK));
        playhead.appended("now click Insert.".into());
        play(&mut output, CHUNK / 2);
        assert_eq!(announced(&mut playhead, player.len()), [], "the first is still playing");
        play(&mut output, CHUNK);
        assert_eq!(announced(&mut playhead, player.len()), [segment(1, "now click Insert.")]);
        play(&mut output, CHUNK);
        assert_eq!(player.len(), 0, "both played out");
        assert_eq!(announced(&mut playhead, player.len()), []);
    }

    #[test]
    fn the_watcher_announces_each_chunk_as_it_starts_until_the_line_is_over() {
        let queued = AtomicUsize::new(0);
        let (heard, announcements) = mpsc::channel();
        let announce = move |index: usize, text: &str| heard.send(segment(index, text)).expect("the test is listening");
        watching(|| queued.load(Ordering::SeqCst), announce, |chunks| {
            // Appended to the player first, then told: as the speaker does it.
            queued.store(1, Ordering::SeqCst);
            chunks.appended("Nice work so far,");
            assert_eq!(announcements.recv_timeout(PATIENCE), Ok(segment(0, "Nice work so far,")));
            queued.store(2, Ordering::SeqCst);
            chunks.appended("now click Insert.");
            assert_eq!(announcements.recv_timeout(A_FEW_LOOKS), Err(RecvTimeoutError::Timeout), "not while the first plays");
            queued.store(1, Ordering::SeqCst);
            assert_eq!(announcements.recv_timeout(PATIENCE), Ok(segment(1, "now click Insert.")));
        });
        assert_eq!(announcements.try_recv(), Err(TryRecvError::Disconnected), "the watcher ended with the line");
    }

    #[test]
    fn every_chunk_is_announced_by_the_time_the_line_ends() {
        let queued = AtomicUsize::new(0);
        let (heard, announcements) = mpsc::channel();
        let announce = move |index: usize, text: &str| heard.send(segment(index, text)).expect("the test is listening");
        watching(|| queued.load(Ordering::SeqCst), announce, |chunks| {
            queued.store(2, Ordering::SeqCst);
            chunks.appended("Exactly right.");
            chunks.appended("OK.");
            // Both play out, and the line ends, before the watcher looks again.
            queued.store(0, Ordering::SeqCst);
        });
        assert_eq!(announcements.try_iter().collect::<Vec<_>>(), [segment(0, "Exactly right."), segment(1, "OK.")]);
    }
}
