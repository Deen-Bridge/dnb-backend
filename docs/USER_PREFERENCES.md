# User Preferences API Guide

This document details the schema, validation rules, API endpoints, and real-time update mechanisms for DeenBridge's User Preferences feature (Issue #267).

---

## 1. Overview & Purpose

User preferences empower users to personalize their app experience across devices. The feature supports:
- **Theme Customization**: Light, Dark, or System mode.
- **Language Selection**: Application language preference (synced to user profile).
- **Notification Settings**: Granular controls for Email, Push, In-App, Marketing, Course Updates, Prayer Reminders, and Security Alerts.
- **Privacy Controls**: Profile visibility, activity sharing, learning progress sharing, messaging permissions, and leaderboard participation.
- **Real-Time Preferences Sync**: Socket.IO room events and in-memory event emitter for instant multi-device state synchronization.

---

## 2. Preference Schema & Defaults

Stored in the `UserPreferences` collection linked to `User` via `user` ObjectId:

| Field | Sub-field | Data Type | Allowed Values / Constraints | Default Value |
| :--- | :--- | :--- | :--- | :--- |
| `theme` | - | `String` | `"light"`, `"dark"`, `"system"` | `"light"` |
| `language` | - | `String` | Non-empty string code (e.g., `"en"`, `"ar"`) | `"en"` |
| `timezone` | - | `String` | Valid timezone string (e.g., `"UTC"`, `"EST"`) | `"UTC"` |
| `fontSize` | - | `String` | `"small"`, `"medium"`, `"large"` | `"medium"` |
| `notifications` | `email` | `Boolean` | `true` / `false` | `true` |
| | `push` | `Boolean` | `true` / `false` | `true` |
| | `inApp` | `Boolean` | `true` / `false` | `true` |
| | `marketing` | `Boolean` | `true` / `false` | `false` |
| | `courseUpdates` | `Boolean` | `true` / `false` | `true` |
| | `prayerReminders` | `Boolean` | `true` / `false` | `true` |
| | `securityAlerts` | `Boolean` | `true` / `false` | `true` |
| `privacy` | `profileVisibility` | `String` | `"public"`, `"private"`, `"followers"` | `"public"` |
| | `showActivity` | `Boolean` | `true` / `false` | `true` |
| | `showLearningProgress` | `Boolean` | `true` / `false` | `true` |
| | `allowMessagesFrom` | `String` | `"everyone"`, `"followers"`, `"none"` | `"everyone"` |
| | `showInLeaderboards` | `Boolean` | `true` / `false` | `true` |

---

## 3. API Endpoints Reference

### 3.1 Get User Preferences

- **Endpoint**: `GET /api/users/me/preferences` (also supported: `GET /api/users/preferences`)
- **Authentication**: Required (`Bearer <JWT>`)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "User preferences retrieved successfully",
  "data": {
    "_id": "64c8f1e29b1d2c001f8a9e10",
    "user": "64c8f1e29b1d2c001f8a9e01",
    "theme": "light",
    "language": "en",
    "timezone": "UTC",
    "fontSize": "medium",
    "notifications": {
      "email": true,
      "push": true,
      "inApp": true,
      "marketing": false,
      "courseUpdates": true,
      "prayerReminders": true,
      "securityAlerts": true
    },
    "privacy": {
      "profileVisibility": "public",
      "showActivity": true,
      "showLearningProgress": true,
      "allowMessagesFrom": "everyone",
      "showInLeaderboards": true
    },
    "createdAt": "2026-08-30T14:30:00.000Z",
    "updatedAt": "2026-08-30T14:30:00.000Z"
  }
}
```

---

### 3.2 Update User Preferences

- **Endpoint**: `PUT /api/users/me/preferences` (also supported: `PUT /api/users/preferences`)
- **Authentication**: Required (`Bearer <JWT>`)

#### Request Body Example
```json
{
  "theme": "dark",
  "language": "ar",
  "notifications": {
    "marketing": true,
    "prayerReminders": false
  },
  "privacy": {
    "profileVisibility": "followers",
    "showInLeaderboards": false
  }
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "User preferences updated successfully",
  "data": {
    "_id": "64c8f1e29b1d2c001f8a9e10",
    "user": "64c8f1e29b1d2c001f8a9e01",
    "theme": "dark",
    "language": "ar",
    "notifications": {
      "email": true,
      "push": true,
      "inApp": true,
      "marketing": true,
      "courseUpdates": true,
      "prayerReminders": false,
      "securityAlerts": true
    },
    "privacy": {
      "profileVisibility": "followers",
      "showActivity": true,
      "showLearningProgress": true,
      "allowMessagesFrom": "everyone",
      "showInLeaderboards": false
    },
    "createdAt": "2026-08-30T14:30:00.000Z",
    "updatedAt": "2026-08-30T14:30:05.000Z"
  }
}
```

#### Validation Error Response (`400 Bad Request`)
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    "Invalid theme 'neon'. Allowed: light, dark, system"
  ],
  "data": null
}
```

---

## 4. Real-Time Preferences Updates

When user preferences are updated via the API:
1. **Socket.IO Namespace**: `/preferences`
2. **Room**: `user_preferences_<userId>`
3. **Event**: `preference_updated`
4. **Payload**:
```json
{
  "userId": "64c8f1e29b1d2c001f8a9e01",
  "preferences": { ... },
  "timestamp": "2026-08-30T14:30:05.000Z"
}
```
5. **In-Process EventEmitter**: `preferenceEvents.on('updated', ({ userId, preferences }) => ...)`
