import {
  extractBits,
  replaceBits,
  toggleBit,
  getBit,
  toSigned,
  toUnsigned,
  clampToWidth,
} from "./bitwise";

// ---------------------------------------------------------------------------
// extractBits
// ---------------------------------------------------------------------------
describe("extractBits", () => {
  it("extracts single bit at position 0 from 0b1", () => {
    expect(extractBits(0b1n, 0, 0)).toBe(1n);
  });

  it("extracts single bit at position 0 from 0b0", () => {
    expect(extractBits(0b0n, 0, 0)).toBe(0n);
  });

  it("extracts bits [7:4] from 0xDEADBEEF", () => {
    expect(extractBits(0xdeadbeefn, 7, 4)).toBe(0xen);
  });

  it("extracts full 32-bit value [31:0]", () => {
    expect(extractBits(0xdeadbeefn, 31, 0)).toBe(0xdeadbeefn);
  });

  it("extracts LSB only [0:0] from a large value", () => {
    expect(extractBits(0xfffffffen, 0, 0)).toBe(0n);
    expect(extractBits(0xffffffffn, 0, 0)).toBe(1n);
  });

  it("extracts high bits [63:32] from a 64-bit value (BigInt precision)", () => {
    const val = 0x123456789abcdef0n;
    expect(extractBits(val, 63, 32)).toBe(0x12345678n);
  });

  it("returns 0n when extracting any range from zero", () => {
    expect(extractBits(0n, 7, 4)).toBe(0n);
    expect(extractBits(0n, 31, 0)).toBe(0n);
    expect(extractBits(0n, 63, 32)).toBe(0n);
  });

  it("extracts single MSB bit 31 from 0x80000000", () => {
    expect(extractBits(0x80000000n, 31, 31)).toBe(1n);
    expect(extractBits(0x7fffffffn, 31, 31)).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// replaceBits
// ---------------------------------------------------------------------------
describe("replaceBits", () => {
  it("sets single bit [0:0] to 1 in a zero register", () => {
    expect(replaceBits(0n, 0, 0, 1n)).toBe(1n);
  });

  it("replaces bits [7:4] in 0xFF with 0x5, surrounding bits untouched", () => {
    // 0xFF = 1111_1111  -> bits [7:4] become 0101 -> 0101_1111 = 0x5F
    const result = replaceBits(0xffn, 7, 4, 0x5n);
    expect(result).toBe(0x5fn);
    // Verify surrounding low nibble is still 0xF
    expect(extractBits(result, 3, 0)).toBe(0xfn);
  });

  it("replaces full [31:0] range", () => {
    expect(replaceBits(0xffffffffn, 31, 0, 0x12345678n)).toBe(0x12345678n);
  });

  it("masks fieldValue wider than the field width", () => {
    // Field is [3:0] (4 bits), but fieldValue is 0xFF (8 bits) -> only low nibble kept
    expect(replaceBits(0n, 3, 0, 0xffn)).toBe(0xfn);
  });

  it("replaces bits [63:56] in a 64-bit value", () => {
    const val = 0x00ffffffffffffffn;
    const result = replaceBits(val, 63, 56, 0xabn);
    expect(extractBits(result, 63, 56)).toBe(0xabn);
    // Lower 56 bits should be preserved
    expect(extractBits(result, 55, 0)).toBe(0xffffffffffffffn);
  });

  it("preserves other bits when replacing in the middle of a non-zero register", () => {
    const original = 0xdeadbeefn;
    const result = replaceBits(original, 15, 8, 0x42n);
    // Bits [31:16] and [7:0] should be unchanged
    expect(extractBits(result, 31, 16)).toBe(extractBits(original, 31, 16));
    expect(extractBits(result, 7, 0)).toBe(extractBits(original, 7, 0));
    // Replaced field should match
    expect(extractBits(result, 15, 8)).toBe(0x42n);
  });

  it("round-trips: extractBits(replaceBits(v, msb, lsb, x), msb, lsb) === x & mask", () => {
    const v = 0xdeadbeefcafebaben;
    const msb = 23;
    const lsb = 8;
    const x = 0xabcdn;
    const width = msb - lsb + 1;
    const mask = (1n << BigInt(width)) - 1n;
    const result = extractBits(replaceBits(v, msb, lsb, x), msb, lsb);
    expect(result).toBe(x & mask);
  });
});

// ---------------------------------------------------------------------------
// toggleBit
// ---------------------------------------------------------------------------
describe("toggleBit", () => {
  it("toggles bit 0 from 0 to 1", () => {
    expect(toggleBit(0n, 0)).toBe(1n);
  });

  it("toggles bit 0 from 1 to 0", () => {
    expect(toggleBit(1n, 0)).toBe(0n);
  });

  it("toggles bit 31 in a 32-bit value", () => {
    // Toggle on
    expect(toggleBit(0n, 31)).toBe(0x80000000n);
    // Toggle off
    expect(toggleBit(0x80000000n, 31)).toBe(0n);
  });

  it("toggles bit 63 in a 64-bit value", () => {
    const bit63 = 1n << 63n;
    expect(toggleBit(0n, 63)).toBe(bit63);
    expect(toggleBit(bit63, 63)).toBe(0n);
  });

  it("leaves other bits untouched", () => {
    const original = 0xdeadbeefn;
    const toggled = toggleBit(original, 4);
    // Only bit 4 should differ
    expect(toggled ^ original).toBe(1n << 4n);
  });
});

// ---------------------------------------------------------------------------
// getBit
// ---------------------------------------------------------------------------
describe("getBit", () => {
  it("returns 1 for bit 0 of 0b1", () => {
    expect(getBit(0b1n, 0)).toBe(1);
  });

  it("returns 0 for bit 0 of 0b0", () => {
    expect(getBit(0b0n, 0)).toBe(0);
  });

  it("returns 1 for bit 31 of 0x80000000", () => {
    expect(getBit(0x80000000n, 31)).toBe(1);
  });

  it("returns 0 for bit 1 of 0b01", () => {
    expect(getBit(0b01n, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toSigned
// ---------------------------------------------------------------------------
describe("toSigned", () => {
  it("keeps positive value (MSB clear) unchanged — 8-bit 127", () => {
    expect(toSigned(127n, 8)).toBe(127n);
  });

  it("converts negative value (MSB set) — 8-bit 128 to -128", () => {
    expect(toSigned(128n, 8)).toBe(-128n);
  });

  it("converts all ones 8-bit (255) to -1", () => {
    expect(toSigned(255n, 8)).toBe(-1n);
  });

  it("keeps zero as zero", () => {
    expect(toSigned(0n, 8)).toBe(0n);
    expect(toSigned(0n, 16)).toBe(0n);
  });

  it("handles 1-bit width: 1n becomes -1n", () => {
    expect(toSigned(1n, 1)).toBe(-1n);
  });

  it("converts 16-bit 0x8000 to -32768", () => {
    expect(toSigned(0x8000n, 16)).toBe(-32768n);
  });
});

// ---------------------------------------------------------------------------
// toUnsigned
// ---------------------------------------------------------------------------
describe("toUnsigned", () => {
  it("keeps positive value the same — 127 in 8 bits", () => {
    expect(toUnsigned(127n, 8)).toBe(127n);
  });

  it("converts -1 in 8 bits to 255", () => {
    expect(toUnsigned(-1n, 8)).toBe(255n);
  });

  it("converts -128 in 8 bits to 128", () => {
    expect(toUnsigned(-128n, 8)).toBe(128n);
  });

  it("round-trips: toUnsigned(toSigned(raw, w), w) === raw for all 8-bit values", () => {
    for (let raw = 0n; raw < 256n; raw++) {
      expect(toUnsigned(toSigned(raw, 8), 8)).toBe(raw);
    }
  });
});

// ---------------------------------------------------------------------------
// clampToWidth
// ---------------------------------------------------------------------------
describe("clampToWidth", () => {
  it("leaves value within range unchanged — 0xFF with width 8", () => {
    expect(clampToWidth(0xffn, 8)).toBe(0xffn);
  });

  it("masks value exceeding range — 0x1FF with width 8 becomes 0xFF", () => {
    expect(clampToWidth(0x1ffn, 8)).toBe(0xffn);
  });

  it("clamps width 1 with value 3 to 1", () => {
    expect(clampToWidth(3n, 1)).toBe(1n);
  });

  it("clamps correctly at 64-bit width", () => {
    const max64 = (1n << 64n) - 1n;
    // Value within 64 bits is unchanged
    expect(clampToWidth(max64, 64)).toBe(max64);
    // Value exceeding 64 bits is masked
    expect(clampToWidth(max64 + 1n, 64)).toBe(0n);
    expect(clampToWidth(max64 + 2n, 64)).toBe(1n);
  });
});
