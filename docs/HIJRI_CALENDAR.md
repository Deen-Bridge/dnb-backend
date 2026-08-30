# 🕌 Islamic Calendar (Hijri) Support Guide

Deen Bridge includes native support for the Islamic (Hijri) calendar alongside the Gregorian calendar, enabling accurate date conversions, formatting, and dual-calendar API responses for scheduling and Islamic events.

## Overview

- **Conversion Utilities**: Bidirectional conversion between Gregorian dates and Hijri dates (`src/utils/hijriCalendar.ts`).
- **Islamic Months & Years**: Full support for all 12 Islamic months with English transliterations and Arabic names.
- **Middleware**: Express middleware (`src/middlewares/dateFormatter.ts`) attaching date utils to requests.
- **API Endpoints**: Endpoints returning dates in both Gregorian and Hijri formats.

## Usage Examples

### Converting Dates in Code

```javascript
import { gregorianToHijri, hijriToGregorian, formatDualDate } from '../src/utils/hijriCalendar.ts';

// Convert Gregorian to Hijri
const hijriDate = gregorianToHijri(new Date());
console.log(hijriDate); 
// { day: 15, month: 9, monthName: 'Ramadan', monthNameArabic: 'رمضان', year: 1445 }

// Dual format
const dual = formatDualDate('2024-03-25');
console.log(dual.hijri); // '15 Ramadan 1445 AH'
```

### API Endpoints

GET `/api/v1/dates/convert`

Query parameters:
- `date` (optional): Gregorian date string (YYYY-MM-DD). Defaults to current date.

Response:
```json
{
  "success": true,
  "data": {
    "gregorian": "2024-03-25",
    "hijri": "15 Ramadan 1445 AH",
    "gregorianDetails": {
      "year": 2024,
      "month": 3,
      "day": 25
    },
    "hijriDetails": {
      "day": 15,
      "month": 9,
      "monthName": "Ramadan",
      "monthNameArabic": "رمضان",
      "year": 1445
    }
  }
}
```
