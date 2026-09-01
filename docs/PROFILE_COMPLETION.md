# Profile Completion Tracking Guide

This document details the design, weighted scoring system, API endpoints, and integration patterns for DeenBridge's User Profile Completion Tracking feature (Issue #268).

---

## 1. Overview & Purpose

User profiles in DeenBridge power personalized course and book recommendations, peer connections in study spaces, educator verification, and seamless Web3 / Stellar transactions.

The Profile Completion feature provides:
- **Gamified Progress Tracking**: Real-time completion percentages and achievement tiers (`Beginner`, `Intermediate`, `Advanced`, `Complete`).
- **Weighted Scoring**: High-value profile fields (such as avatar, bio, and interests) carry appropriate weight reflecting their importance to the platform experience.
- **Actionable Suggestions**: Prioritized suggestions recommending the next best actions to improve the user's profile.
- **Privacy-Aware Computation**: Protects sensitive security configurations (such as 2FA) when third parties inspect a user's completion status.

---

## 2. Weighted Scoring Matrix

Profile fields are evaluated against a 100-point scale:

| Field Key | Label | Category | Weight (Points) | Description & Acceptance Criteria |
| :--- | :--- | :--- | :---: | :--- |
| `avatar` | Profile Picture | `profile` | **20** | Valid Cloudinary URL or image link. Personalizes the account. |
| `bio` | Bio / About Me | `profile` | **20** | Non-empty biography (up to 500 characters) describing learning goals. |
| `interests` | Interests & Topics | `preferences` | **15** | Array with at least one topic (e.g., Fiqh, Hadith, Arabic, Islamic Finance). Powers recommendations. |
| `country` | Country / Location | `personal` | **10** | Non-empty country/region for local study circle discovery. |
| `language` | Preferred Language | `preferences` | **10** | Primary language selected for UI and course filtering. |
| `stellarWallet` | Stellar Wallet | `wallet` | **10** | Connected Stellar public key (`G...`) for micropayments, gifts, and Sadaqah. |
| `gender` | Gender | `personal` | **5** | Specified gender (`male` or `female`) for curated community spaces. |
| `age` | Age | `personal` | **5** | Valid age (2–120 years) for age-appropriate learning tracks. |
| `twoFactor` | Two-Factor Auth | `security` | **5** | 2FA enabled for account and wallet protection. |
| **Total** | | | **100** | |

---

## 3. Progress Levels & Indicator Tiers

| Level | Percentage Range | Description |
| :--- | :---: | :--- |
| **Beginner** | `0% - 34%` | Account created; basic setup underway. |
| **Intermediate** | `35% - 69%` | Core profile details added; recommendations activated. |
| **Advanced** | `70% - 99%` | Comprehensive profile; eligible for community badges. |
| **Complete** | `100%` | Fully completed profile with wallet and security configured. |

---

## 4. API Endpoints Reference

### 4.1. Get Current User's Profile Completion

**Endpoint**: `GET /api/users/completion` or `GET /api/users/completion/me`  
**Authentication**: Required (`Bearer <JWT>`)

#### Response (`200 OK`)
```json
{
  "success": true,
  "message": "Profile completion fetched successfully",
  "data": {
    "userId": "6a931c3b947eb994a83782a5",
    "percentage": 65,
    "earnedPoints": 65,
    "totalPossiblePoints": 100,
    "completedCount": 5,
    "totalCount": 9,
    "isComplete": false,
    "level": "Intermediate",
    "completedFields": [
      "avatar",
      "bio",
      "country",
      "language",
      "gender"
    ],
    "missingFields": [
      "interests",
      "stellarWallet",
      "age",
      "twoFactor"
    ],
    "fields": [
      {
        "key": "avatar",
        "label": "Profile Picture",
        "category": "profile",
        "weight": 20,
        "completed": true,
        "pointsAwarded": 20,
        "suggestion": "Upload a profile photo to personalize your account and build trust with the community."
      },
      {
        "key": "interests",
        "label": "Interests & Topics",
        "category": "preferences",
        "weight": 15,
        "completed": false,
        "pointsAwarded": 0,
        "suggestion": "Select your areas of interest to receive tailored course, book, and space recommendations."
      }
    ],
    "suggestions": [
      "Select your areas of interest to receive tailored course, book, and space recommendations.",
      "Connect your Stellar wallet to enable digital micropayments, gifts, and Sadaqah donations.",
      "Provide your age to help us curate age-appropriate learning material.",
      "Enable Two-Factor Authentication (2FA) to enhance your account security."
    ],
    "nextStep": "Select your areas of interest to receive tailored course, book, and space recommendations."
  }
}
```

---

### 4.2. Get Profile Completion Scoring Criteria

**Endpoint**: `GET /api/users/completion/criteria`  
**Authentication**: Public / Optional

#### Response (`200 OK`)
```json
{
  "success": true,
  "message": "Profile completion criteria retrieved successfully",
  "data": {
    "totalWeight": 100,
    "fields": [
      {
        "key": "avatar",
        "label": "Profile Picture",
        "weight": 20,
        "category": "profile",
        "suggestion": "Upload a profile photo to personalize your account and build trust with the community."
      },
      {
        "key": "bio",
        "label": "Bio / About Me",
        "weight": 20,
        "category": "profile",
        "suggestion": "Add a bio describing yourself, your learning goals, and Islamic studies interests."
      }
    ],
    "levels": {
      "Beginner": "0-34%",
      "Intermediate": "35-69%",
      "Advanced": "70-99%",
      "Complete": "100%"
    }
  }
}
```

---

### 4.3. Get Specified User's Profile Completion

**Endpoint**: `GET /api/users/completion/:userId` or `GET /api/users/:userId/completion`  
**Authentication**: Required (`Bearer <JWT>`)

#### Response (`200 OK`)
```json
{
  "success": true,
  "message": "User profile completion fetched successfully",
  "data": {
    "userId": "6a931c3e947eb994a83782c3",
    "isSelf": false,
    "percentage": 70,
    "earnedPoints": 65,
    "totalPossiblePoints": 95,
    "completedCount": 5,
    "totalCount": 8,
    "isComplete": false,
    "level": "Advanced",
    "completedFields": ["avatar", "bio", "country", "interests", "language"],
    "missingFields": ["gender", "age", "stellarWallet"],
    "fields": [ ... ],
    "suggestions": [ ... ],
    "nextStep": "Connect your Stellar wallet to enable digital micropayments, gifts, and Sadaqah donations."
  }
}
```

---

## 5. Frontend Integration Best Practices

### Progress Bar & Widget
- Display a circular or linear percentage bar in the learner dashboard and profile overview.
- Use tier colours:
  - `Beginner`: Neutral / Gray (`#94A3B8`)
  - `Intermediate`: Bronze / Amber (`#F59E0B`)
  - `Advanced`: Silver / Indigo (`#6366F1`)
  - `Complete`: Gold / Emerald (`#10B981`)

### Call-to-Action (CTA) Prompt
- Display the `nextStep` recommendation string directly beneath the progress bar.
- Link the CTA button to the appropriate settings tab (e.g., `/settings/profile`, `/settings/wallet`, `/settings/security`).

---

## 6. Architecture & Code Structure

- **Calculation Engine**: [`src/utils/profileCompletion.ts`](file:///home/mceesquare/drips/dnb-backend/src/utils/profileCompletion.ts) & [`src/utils/profileCompletion.js`](file:///home/mceesquare/drips/dnb-backend/src/utils/profileCompletion.js)
- **API Router**: [`src/routes/api/users/completion.ts`](file:///home/mceesquare/drips/dnb-backend/src/routes/api/users/completion.ts) & [`src/routes/api/users/completion.js`](file:///home/mceesquare/drips/dnb-backend/src/routes/api/users/completion.js)
- **Types**: [`src/types/profileCompletion.ts`](file:///home/mceesquare/drips/dnb-backend/src/types/profileCompletion.ts)
- **Test Suite**: [`test/profileCompletion.test.js`](file:///home/mceesquare/drips/dnb-backend/test/profileCompletion.test.js)
