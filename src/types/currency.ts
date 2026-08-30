export type SupportedCurrency = 'USD' | 'EUR' | 'MYR' | 'AED' | 'PKR';

export interface CurrencyConfig {
  code: SupportedCurrency;
  symbol: string;
  name: string;
  decimals: number;
  symbolPosition: 'prefix' | 'suffix';
  defaultLocale: string;
}

export interface FormatCurrencyOptions {
  locale?: string;
  currency?: SupportedCurrency;
  showSymbol?: boolean;
  symbolPosition?: 'prefix' | 'suffix' | 'auto';
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}
