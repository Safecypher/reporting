import {
  computeAlignmentShortSide,
  pctVariance,
} from "@/lib/dashboard/alignment-status";

/**
 * The which-side-is-short delta phrase (Copywriting Contract), lifted out of
 * `alignment-kpi-cards.tsx`'s original `DeltaPhrase` and generalised in
 * exactly one way — a pluggable `formatValue` used to render the absolute
 * difference — so `/alignment`'s four count-based cards, `/alignment`'s
 * Revenue card, and `/revenue`'s TSYS secondary figure all render through
 * this SAME implementation (07-03: two hand-maintained copies would drift).
 * Server Component only — no `"use client"` directive, no function-valued
 * prop crossing a server/client boundary. `formatValue` is always supplied
 * by a caller in the same server module.
 *
 * Preserved, unchanged, from the original `DeltaPhrase`: the exact-match
 * sentence when the two values are equal; `computeAlignmentShortSide` to
 * decide which side is short; `pctVariance` for the percentage, always
 * denominated on the Bit Addict figure; and the zero-denominator branch,
 * which renders an em dash inside a `span` carrying its own `aria-label`
 * stating why the percentage is not applicable, so the reason reaches the
 * accessibility tree unconditionally and never only on hover (D-14).
 */
export function SourceDeltaPhrase({
  tsysValue,
  bitAddictValue,
  formatValue,
}: {
  tsysValue: number;
  bitAddictValue: number;
  formatValue: (n: number) => string;
}) {
  if (tsysValue === bitAddictValue) {
    return <>TSYS and Bit Addict match exactly.</>;
  }

  const shortSide = computeAlignmentShortSide(tsysValue, bitAddictValue);
  const sideLabel = shortSide === "tsys" ? "TSYS" : "Bit Addict";
  const absDelta = formatValue(Math.abs(tsysValue - bitAddictValue));
  const pct = pctVariance(tsysValue, bitAddictValue);

  if (pct === null) {
    return (
      <>
        {`${sideLabel} is short by ${absDelta} (`}
        <span aria-label="Percentage not applicable — Bit Addict recorded zero for this metric">
          —
        </span>
        {`).`}
      </>
    );
  }

  return <>{`${sideLabel} is short by ${absDelta} (${pct}%).`}</>;
}
