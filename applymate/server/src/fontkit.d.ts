declare module "@foliojs-fork/fontkit" {
  import type { Buffer } from "node:buffer";
  export interface Font { hasGlyphForCodePoint(codePoint: number): boolean }
  const fontkit: { create(buffer: Buffer): Font | { fonts: Font[] } };
  export default fontkit;
}
