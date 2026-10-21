# Prayer Time Integration Guide

DeenBridge includes built-in integration with the **Aladhan API** to calculate precise Islamic prayer times based on user coordinates or city names, supporting multiple global calculation methods and Juristic schools.

## Endpoints

### Get Daily Prayer Schedule

`GET /api/prayer-times`

#### Query Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `latitude` | Number | Geographic latitude | `37.7749` |
| `longitude` | Number | Geographic longitude | `-122.4194` |
| `city` | String | City name (alternative to coords) | `London` |
| `country` | String | Country name | `United Kingdom` |
| `date` | String | Specific date in `DD-MM-YYYY` format | `15-05-2024` |
| `method` | Number | Calculation method ID (see below) | `2` |
| `school` | Number | Juristic school (`0` for Shafii/Maliki/Hanbali, `1` for Hanafi) | `0` |
| `calendar` | Boolean | Pass `true` to fetch full month calendar | `true` |
| `month` | Number | Month number (1-12) for calendar | `5` |
| `year` | Number | Year number for calendar | `2024` |

## Calculation Methods

Supported standard calculation methods (`method` parameter):

- `0`: Shia Ithna-Ashari, Leva Institute, Qum
- `1`: University of Islamic Sciences, Karachi
- `2`: Islamic Society of North America (ISNA)
- `3`: Muslim World League (MWL)
- `4`: Umm al-Qura University, Makkah
- `5`: Egyptian General Authority of Survey
- `7`: Institute of Geophysics, University of Tehran
- `8`: Gulf Region
- `9`: Kuwait
- `10`: Qatar
- `11`: Board of Trustees, Faculty of Islamic Studies, Singapore
- `12`: Union Organization islamic de France
- `13`: Diyanet İşleri Başkanlığı, Turkey
- `14`: Spiritual Administration of Muslims of Russia

## Example Usage

### By Coordinates
```bash
curl "https://api.deenbridge.io/api/prayer-times?latitude=40.7128&longitude=-74.0060&method=2"
```

### By City
```bash
curl "https://api.deenbridge.io/api/prayer-times?city=Cairo&country=Egypt&method=5"
```
