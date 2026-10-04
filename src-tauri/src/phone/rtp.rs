//! H.264 over RTP (RFC 6184) back to Annex-B access units, for UxPlay's `-vrtp` output.

const RTP_HEADER: usize = 12;
const RTP_VERSION: u8 = 2;
const NAL_TYPE_MASK: u8 = 0x1F;
const NAL_HEADER_HIGH_BITS: u8 = 0xE0;
const NAL_IDR: u8 = 5;
const NAL_STAP_A: u8 = 24;
const NAL_FU_A: u8 = 28;
const FU_START: u8 = 0x80;
const START_CODE: [u8; 4] = [0, 0, 0, 1];
/// Far above any mirrored-screen frame; a unit that never ends (lost marker, junk on the port) is dropped.
const MAX_ACCESS_UNIT: usize = 4 * 1024 * 1024;

pub struct AccessUnit {
    pub data: Vec<u8>,
    pub key: bool,
}

pub struct Depacketizer {
    current: Vec<u8>,
    key: bool,
    in_fragment: bool,
    broken: bool,
    need_key: bool,
    last_seq: Option<u16>,
}

struct Packet<'a> {
    seq: u16,
    marker: bool,
    payload: &'a [u8],
}

fn parse(packet: &[u8]) -> Option<Packet<'_>> {
    if packet.len() <= RTP_HEADER || packet[0] >> 6 != RTP_VERSION {
        return None;
    }
    let csrc = usize::from(packet[0] & 0x0F) * 4;
    let mut start = RTP_HEADER + csrc;
    if packet[0] & 0x10 != 0 {
        let words = usize::from(u16::from_be_bytes([*packet.get(start + 2)?, *packet.get(start + 3)?]));
        start += 4 + words * 4;
    }
    let padding = if packet[0] & 0x20 != 0 { usize::from(*packet.last()?) } else { 0 };
    let end = packet.len().checked_sub(padding)?;
    let payload = packet.get(start..end).filter(|p| !p.is_empty())?;
    Some(Packet { seq: u16::from_be_bytes([packet[2], packet[3]]), marker: packet[1] & 0x80 != 0, payload })
}

impl Depacketizer {
    pub fn new() -> Self {
        Self { current: Vec::new(), key: false, in_fragment: false, broken: false, need_key: true, last_seq: None }
    }

    pub fn push(&mut self, packet: &[u8]) -> Option<AccessUnit> {
        let packet = parse(packet)?;
        if self.last_seq.is_some_and(|last| last.wrapping_add(1) != packet.seq) {
            self.broken = true;
            self.need_key = true;
        }
        self.last_seq = Some(packet.seq);
        self.take_payload(packet.payload);
        if self.current.len() > MAX_ACCESS_UNIT {
            self.current.clear();
            self.broken = true;
            self.need_key = true;
        }
        if packet.marker { self.finish() } else { None }
    }

    fn nal(&mut self, nal: &[u8]) {
        if nal.first().is_some_and(|h| h & NAL_TYPE_MASK == NAL_IDR) {
            self.key = true;
        }
        self.current.extend_from_slice(&START_CODE);
        self.current.extend_from_slice(nal);
    }

    fn take_payload(&mut self, payload: &[u8]) {
        match payload[0] & NAL_TYPE_MASK {
            NAL_STAP_A => self.stap_a(&payload[1..]),
            NAL_FU_A => self.fu_a(payload),
            _ => self.nal(payload),
        }
    }

    fn stap_a(&mut self, mut rest: &[u8]) {
        while rest.len() > 2 {
            let size = usize::from(u16::from_be_bytes([rest[0], rest[1]]));
            let Some(nal) = rest.get(2..2 + size) else {
                self.broken = true;
                return;
            };
            self.nal(nal);
            rest = &rest[2 + size..];
        }
    }

    fn fu_a(&mut self, payload: &[u8]) {
        let (Some(&indicator), Some(&header)) = (payload.first(), payload.get(1)) else {
            self.broken = true;
            return;
        };
        if header & FU_START != 0 {
            self.nal(&[(indicator & NAL_HEADER_HIGH_BITS) | (header & NAL_TYPE_MASK)]);
            self.in_fragment = true;
        } else if !self.in_fragment {
            self.broken = true;
            return;
        }
        self.current.extend_from_slice(&payload[2..]);
    }

    fn finish(&mut self) -> Option<AccessUnit> {
        let data = std::mem::take(&mut self.current);
        let (key, broken) = (self.key, self.broken);
        self.key = false;
        self.broken = false;
        self.in_fragment = false;
        if broken || data.is_empty() || (self.need_key && !key) {
            return None;
        }
        self.need_key = false;
        Some(AccessUnit { data, key })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rtp(seq: u16, marker: bool, payload: &[u8]) -> Vec<u8> {
        let mut p = vec![0x80, if marker { 0xE0 } else { 0x60 }];
        p.extend_from_slice(&seq.to_be_bytes());
        p.extend_from_slice(&[0, 0, 0, 1, 0, 0, 0, 2]);
        p.extend_from_slice(payload);
        p
    }

    #[test]
    fn single_nal_keyframe_becomes_an_annex_b_access_unit() {
        let mut d = Depacketizer::new();
        let au = d.push(&rtp(1, true, &[0x65, 0xAA])).expect("access unit");
        assert!(au.key);
        assert_eq!(au.data, [0, 0, 0, 1, 0x65, 0xAA]);
    }

    #[test]
    fn reassembles_fu_a_fragments() {
        let mut d = Depacketizer::new();
        assert!(d.push(&rtp(1, false, &[0x7C, 0x85, 1, 2])).is_none());
        assert!(d.push(&rtp(2, false, &[0x7C, 0x05, 3])).is_none());
        let au = d.push(&rtp(3, true, &[0x7C, 0x45, 4])).expect("access unit");
        assert_eq!(au.data, [0, 0, 0, 1, 0x65, 1, 2, 3, 4]);
    }

    #[test]
    fn unpacks_stap_a() {
        let mut d = Depacketizer::new();
        let payload = [0x18, 0, 2, 0x67, 0x42, 0, 2, 0x68, 0xCE, 0, 2, 0x65, 0x88];
        let au = d.push(&rtp(1, true, &payload)).expect("access unit");
        assert_eq!(au.data, [0, 0, 0, 1, 0x67, 0x42, 0, 0, 0, 1, 0x68, 0xCE, 0, 0, 0, 1, 0x65, 0x88]);
    }

    #[test]
    fn drops_until_the_next_keyframe_after_loss_or_on_a_delta_start() {
        let mut d = Depacketizer::new();
        assert!(d.push(&rtp(1, true, &[0x41, 1])).is_none(), "delta before any keyframe");
        assert!(d.push(&rtp(2, true, &[0x65, 1])).is_some());
        assert!(d.push(&rtp(4, true, &[0x41, 2])).is_none(), "sequence gap");
        assert!(d.push(&rtp(5, true, &[0x41, 3])).is_none(), "still waiting for a keyframe");
        assert!(d.push(&rtp(6, true, &[0x65, 2])).is_some());
    }

    #[test]
    fn drops_an_access_unit_that_never_ends_instead_of_growing_forever() {
        let mut d = Depacketizer::new();
        let chunk = vec![0x41; 60_000];
        let packets = MAX_ACCESS_UNIT / chunk.len() + 2;
        for seq in 1..=packets as u16 {
            assert!(d.push(&rtp(seq, false, &chunk)).is_none());
        }
        assert!(d.current.len() <= MAX_ACCESS_UNIT);
        assert!(d.push(&rtp(packets as u16 + 1, true, &[0x65, 1])).is_none(), "the oversized unit is discarded");
        assert!(d.push(&rtp(packets as u16 + 2, true, &[0x65, 2])).is_some(), "the next keyframe recovers");
    }

    #[test]
    fn ignores_malformed_packets() {
        let mut d = Depacketizer::new();
        assert!(d.push(&[0x80, 0x60]).is_none());
    }
}
