# Currency Formatting Guide

DeenBridge provides robust, locale-aware currency formatting supporting major currencies and local decimal/thousand separators.

## Supported Currencies

- **USD** (US Dollar - `$`, e.g., `$1,000.00`)
- **EUR** (Euro - `€`, e.g., `1.000,00 €` or `€1,000.00`)
- **MYR** (Malaysian Ringgit - `RM`, e.g., `RM1,000.00`)
- **AED** (UAE Dirham - `AED`, e.g., `AED 1,000.00`)
- **PKR** (Pakistani Rupee - `Rs`, e.g., `Rs 1,000.00`)

## Usage

```typescript
import { formatCurrency } from '../src/utils/currencyFormatter.js';

// Format with default locale and currency
formatCurrency(1000, { currency: 'USD' }); // "$1,000.00"

// Format with German locale for EUR
formatCurrency(1000.5, { currency: 'EUR', locale: 'de-DE' }); // "€1.000,50"
```
