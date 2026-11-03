// Locale prefs — currency conversion + metric/imperial unit toggle.
// Saved per-user in user_prefs (alongside assumptions). The conversion rates
// are intentionally rough rules-of-thumb, not live FX rates — admins can
// tune them in the Settings tab via the LOCALE_FX_RATES_JSON config key.

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'AUD' | 'CAD' | 'JPY' | 'MXN' | 'BRL' | 'INR';
export type UnitSystem = 'imperial' | 'metric';

export interface LocalePrefs {
  currency: CurrencyCode;
  /** Multiplier from 1 USD. e.g. EUR rate = 0.92 means $1M USD = €0.92M. */
  fxRate: number;
  units: UnitSystem;
}

export const DEFAULT_LOCALE: LocalePrefs = {
  currency: 'USD',
  fxRate: 1.0,
  units: 'imperial',
};

/** Default rule-of-thumb FX rates (per 1 USD). Admins can override these
 *  via the `LOCALE_FX_RATES_JSON` config key in the admin Settings tab. */
export const DEFAULT_FX_RATES: Record<CurrencyCode, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.78,
  AUD: 1.50,
  CAD: 1.36,
  JPY: 150,
  MXN: 17,
  BRL: 5.0,
  INR: 83,
};

export const CURRENCY_META: Record<CurrencyCode, { symbol: string; name: string }> = {
  USD: { symbol: '$',   name: 'US Dollar' },
  EUR: { symbol: '€',   name: 'Euro' },
  GBP: { symbol: '£',   name: 'British Pound' },
  AUD: { symbol: 'A$',  name: 'Australian Dollar' },
  CAD: { symbol: 'C$',  name: 'Canadian Dollar' },
  JPY: { symbol: '¥',   name: 'Japanese Yen' },
  MXN: { symbol: 'MX$', name: 'Mexican Peso' },
  BRL: { symbol: 'R$',  name: 'Brazilian Real' },
  INR: { symbol: '₹',   name: 'Indian Rupee' },
};

/** Convert a USD amount to the target currency using the configured rate. */
export function convertCurrency(usdAmount: number, locale: LocalePrefs): number {
  return usdAmount * (locale.fxRate || 1);
}

/** Format a USD-denominated value into the user's preferred currency.
 *  `valueUSD` is the source value (e.g. $M). Output uses the same magnitude. */
export function formatCurrency(valueUSD: number, locale: LocalePrefs, opts?: { suffix?: string }): string {
  const sym = CURRENCY_META[locale.currency]?.symbol || '$';
  const v = convertCurrency(valueUSD, locale);
  // For currencies with very different magnitudes (JPY, INR, MXN), bump the
  // displayed precision up so we don't get "¥0.5M" rounding issues.
  const isHighMagnitude = locale.fxRate >= 50;
  const formatted = isHighMagnitude
    ? Math.round(v).toLocaleString()
    : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
  return `${sym}${formatted}${opts?.suffix || ''}`;
}

/** Convert mile-denominated values to km when metric is selected. Use for
 *  T&D line miles displayed in the Assumptions panel. */
export function milesToKm(mi: number): number {
  return mi * 1.60934;
}
export function kmToMiles(km: number): number {
  return km / 1.60934;
}
export function unitLabel(imperial: string, metric: string, locale: LocalePrefs): string {
  return locale.units === 'metric' ? metric : imperial;
}

/** Given an AssumptionField unit string, return the unit displayed for the
 *  user's selected unit system (e.g. 'mi' → 'km'). Conversion of the *value*
 *  itself is handled by the assumptions-panel renderer. */
export function localizeUnit(unit: string, locale: LocalePrefs): string {
  if (locale.units !== 'metric') return unit;
  if (unit === 'mi') return 'km';
  if (unit === '$/MMBtu') return `${CURRENCY_META[locale.currency].symbol}/GJ`;
  // Currency-symbol substitutions for $-denominated units
  if (unit.startsWith('$')) {
    const rest = unit.slice(1);
    return `${CURRENCY_META[locale.currency].symbol}${rest}`;
  }
  return unit;
}

/** Parse the admin-managed `LOCALE_FX_RATES_JSON` config blob into a rate map.
 *  Falls back to DEFAULT_FX_RATES on parse failure. */
export function parseFxRates(json: string | null | undefined): Record<CurrencyCode, number> {
  if (!json) return { ...DEFAULT_FX_RATES };
  try {
    const obj = JSON.parse(json);
    const out = { ...DEFAULT_FX_RATES };
    for (const [k, v] of Object.entries(obj)) {
      if (k in out && typeof v === 'number' && v > 0) {
        out[k as CurrencyCode] = v;
      }
    }
    return out;
  } catch {
    return { ...DEFAULT_FX_RATES };
  }
}
