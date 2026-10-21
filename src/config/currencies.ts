import { SupportedCurrency, CurrencyConfig } from '../types/currency.js';

export const SUPPORTED_CURRENCIES: Record<SupportedCurrency, CurrencyConfig> = {
  USD: {
    code: 'USD',
    symbol: '$',
    name: 'US Dollar',
    decimals: 2,
    symbolPosition: 'prefix',
    defaultLocale: 'en-US',
  },
  EUR: {
    code: 'EUR',
    symbol: '€',
    name: 'Euro',
    decimals: 2,
    symbolPosition: 'prefix',
    defaultLocale: 'de-DE',
  },
  MYR: {
    code: 'MYR',
    symbol: 'RM',
    name: 'Malaysian Ringgit',
    decimals: 2,
    symbolPosition: 'prefix',
    defaultLocale: 'ms-MY',
  },
  AED: {
    code: 'AED',
    symbol: 'AED',
    name: 'UAE Dirham',
    decimals: 2,
    symbolPosition: 'prefix',
    defaultLocale: 'ar-AE',
  },
  PKR: {
    code: 'PKR',
    symbol: 'Rs',
    name: 'Pakistani Rupee',
    decimals: 2,
    symbolPosition: 'prefix',
    defaultLocale: 'ur-PK',
  },
};

export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_CURRENCIES, code);
}
