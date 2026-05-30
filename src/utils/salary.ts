export interface SalaryRange {
  min: number | null;
  max: number | null;
}

/**
 * Extract salary range from any free-form text string.
 * Handles: $80k–$120k, $80,000-$120,000, $50/hr, 80000 USD, etc.
 */
export function extractSalary(text: string | null): SalaryRange {
  if (!text) return { min: null, max: null };

  // Hourly rate → annualise (2 080 hrs/yr)
  const hr = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*hr|per\s+hour)/i);
  if (hr) {
    const annual = Math.round(parseFloat(hr[1]) * 2_080);
    if (annual > 20_000) return { min: annual, max: null };
  }

  // Range: $80k - $120k  |  $80,000 – $120,000  |  80,000 to 120,000
  const range = text.match(
    /\$\s*(\d[\d,]*\.?\d*)\s*k?\s*[-–—to]+\s*\$?\s*(\d[\d,]*\.?\d*)\s*k?/i,
  );
  if (range) {
    let lo = parseFloat(range[1].replace(/,/g, ''));
    let hi = parseFloat(range[2].replace(/,/g, ''));
    if (lo < 1_000) lo *= 1_000;
    if (hi < 1_000) hi *= 1_000;
    if (lo > 15_000 && hi > 15_000 && hi < 700_000) return { min: lo, max: hi };
  }

  // Single value: $95,000  |  $95k  |  95000 USD
  const single = text.match(/\$\s*(\d[\d,]*\.?\d*)\s*k?\b/i);
  if (single) {
    let v = parseFloat(single[1].replace(/,/g, ''));
    if (v < 1_000) v *= 1_000;
    if (v > 20_000 && v < 500_000) return { min: v, max: null };
  }

  return { min: null, max: null };
}

export function fmtSalary(min: number | null, max: number | null): string | null {
  if (!min && !max) return null;
  const k = (n: number) => `$${Math.round(n / 1_000)}k`;
  if (min && max) return `${k(min)} – ${k(max)} / yr`;
  if (min)        return `${k(min)}+ / yr`;
  return null;
}
