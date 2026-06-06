/**
 * WalletIdenticon — deterministic, monochrome geometric mark seeded
 * by the wallet address.
 *
 * Renders a 5x5 grid mirrored left-to-right (so cells 3-4 are copies
 * of cells 0-1). The bit pattern is derived from the address's char
 * codes — same address always yields the same identicon, different
 * addresses get visually distinct marks.
 *
 * Uses only `--fg` (filled cell) and `--surface-2` (empty cell) so the
 * mark stays on-brand with the rest of the account dashboard. No
 * external identicon library, no client JS needed past render.
 */

interface WalletIdenticonProps {
  address: string;
  /** Outer size in px. */
  size?: number;
}

const GRID = 5;
const CONTROLLED_COLS = Math.ceil(GRID / 2); // 0,1,2 — mirror 3,4

function bitMask(address: string): boolean[] {
  // 5x5 = 25 cells, but we only need CONTROLLED_COLS * GRID bits.
  const need = CONTROLLED_COLS * GRID;
  const bits: boolean[] = [];
  for (let i = 0; i < need; i++) {
    const ch = address.charCodeAt(i % address.length) ^ (i * 31);
    bits.push((ch & 1) === 1);
  }
  return bits;
}

export function WalletIdenticon({
  address,
  size = 40,
}: WalletIdenticonProps) {
  const bits = bitMask(address);
  const cell = 100 / GRID; // viewBox 100x100
  const cells: Array<{ x: number; y: number; on: boolean }> = [];

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const controlledX = x < CONTROLLED_COLS ? x : GRID - 1 - x;
      const idx = controlledX * GRID + y;
      cells.push({ x, y, on: !!bits[idx] });
    }
  }

  return (
    <span
      aria-hidden
      className="
        inline-block overflow-hidden rounded-xl
        border border-[var(--border)] bg-[var(--surface-2)]
      "
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        shapeRendering="crispEdges"
      >
        {cells.map((c, i) => (
          <rect
            key={i}
            x={c.x * cell}
            y={c.y * cell}
            width={cell}
            height={cell}
            fill={c.on ? 'var(--fg)' : 'transparent'}
          />
        ))}
      </svg>
    </span>
  );
}
