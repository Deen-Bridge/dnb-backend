import { SUPPORTED_CURRENCIES, isSupportedCurrency } from '../config/currencies.js';
import { SupportedCurrency, FormatCurrencyOptions } from '../types/currency.js';

/**
 * Format a numeric amount into a locale-aware currency string.
 */
export function formatCurrency(amount: number, options: FormatCurrencyOptions = {}):
  string {
  const currencyCode: SupportedCurrency = options.currency && isSupportedCurrency(options.currency)
    ? options.currency
    : 'USD';

  const config = SUPPORTED_CURRENCIES[currencyCode];
  const locale = options.locale || config.defaultLocale;

  const minDigits = options.minimumFractionDigits !== undefined
    ? options.minimumFractionDigits
    : config.decimals;

  const maxDigits = options.maximumFractionDigits !== undefined
    ? options.maximumFractionDigits
    : config.decimals;

  let formattedNumber: string;
  try {
    formattedNumber = new Intl.NumberFormat(locale, {
      style: 'decimal',
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    }).format(amount);
  } catch {
    formattedNumber = amount.toFixed(config.decimals);
  }

  const showSymbol = options.showSymbol !== false;
  if (!showSymbol) {
    return formattedNumber;
  }

  const symbol = config.symbol;
  const position = options.symbolPosition && options.symbolPosition !== 'auto'
    ? options.symbolPosition
    : config.symbolPosition;

  if (position === 'suffix') {
    return `${formattedNumber} ${symbol}`;
  }

  return `${symbol}${formattedNumber}`;
}
