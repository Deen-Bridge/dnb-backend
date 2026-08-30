# User Moderation Guide

Deen Bridge provides a robust user management and moderation system allowing administrators to enforce terms of service through temporary suspensions, permanent bans, and account reinstatements with full audit logging.

## Authentication & Authorization

All moderation endpoints require:
- Bearer token authentication (`protect` middleware)
- `admin` role with active 2FA verification (`authorizeRoles("admin")`)

## Endpoints

Base path: `/api/admin/users/moderation`

### 1. Suspend User
- **POST** `/suspend`
- **Body**:
  ```json
  {
    "userId": "string",
    "reason": "Violation of community guidelines",
    "durationDays": 7
  }
  ```

### 2. Ban User
- **POST** `/ban`
- **Body**:
  ```json
  {
    "userId": "string",
    "reason": "Severe terms of service breach"
  }
  ```

### 3. Unban User
- **POST** `/unban`
- **Body**:
  ```json
  {
    "userId": "string",
    "reason": "Appeal approved"
  }
  ```

### 4. View Moderation Logs
- **GET** `/logs?page=1&limit=20&targetUser=userId`

## Audit Logging

Every moderation action is recorded in the `ModerationLog` model and pushed to the core security `AuditLog` service for compliance and review.
