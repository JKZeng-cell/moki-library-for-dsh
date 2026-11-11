// @extend-ai/react-pptx 0.1.2 packs these pairs of u32 limits into i64 constants.
// Remove byte-policy ceilings, retain archive/XML guards and Wasm32 bounds.
const PATCHES = [
  { from: [0x80, 0x80, 0x80, 0xb2, 0x80, 0xc4, 0x13], to: [0xff, 0xff, 0xff, 0xff, 0x8f, 0xc4, 0x13] },
  { from: [0x80, 0x80, 0x80, 0xa0, 0x80, 0x80, 0x80, 0x80, 0x20], to: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f] },
];
export function patchPowerPointWasmPreviewLimits(source: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(source.slice(0));
  for (const patch of PATCHES) {
    let matchAt = -1, matchCount = 0;
    for (let offset = 0; offset <= bytes.length - patch.from.length; offset++) {
      if (patch.from.every((value, index) => bytes[offset + index] === value)) { matchAt = offset; matchCount++; }
    }
    if (matchCount !== 1) throw new Error('PowerPoint 解析器版本不匹配，无法初始化完整预览');
    bytes.set(patch.to, matchAt);
  }
  return bytes.buffer;
}
