const NAL_TYPE_MASK = 0x1f;
const NAL_SPS = 7;
const SPS_MIN_BYTES = 4;

/** NAL units of an Annex-B buffer (3- or 4-byte start codes), without their start codes. */
export function nalUnits(data: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i + 3);
      i += 2;
    }
  }
  return starts.map((start, n) => {
    let end = n + 1 < starts.length ? starts[n + 1] - 3 : data.length;
    if (end > start && data[end - 1] === 0) end--;
    return data.subarray(start, end);
  });
}

export function findSps(annexB: Uint8Array): Uint8Array | undefined {
  return nalUnits(annexB).find((nal) => nal.length >= SPS_MIN_BYTES && (nal[0] & NAL_TYPE_MASK) === NAL_SPS);
}

const hex = (byte: number) => byte.toString(16).padStart(2, "0");

/** "avc1.PPCCLL": profile_idc, constraint flags and level_idc follow the SPS NAL header. */
export function avcCodec(sps: Uint8Array): string {
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}
