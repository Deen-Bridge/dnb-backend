import { Types } from "mongoose";

export type ThemePreference = "light" | "dark" | "system";

export type LanguagePreference = string;

export interface NotificationSettings {
  email: boolean;
  push: boolean;
  inApp: boolean;
  marketing: boolean;
  courseUpdates: boolean;
  prayerReminders: boolean;
  securityAlerts: boolean;
}

export interface PrivacyOptions {
  profileVisibility: "public" | "private" | "followers";
  showActivity: boolean;
  showLearningProgress: boolean;
  allowMessagesFrom: "everyone" | "followers" | "none";
  showInLeaderboards: boolean;
}

export interface IUserPreferences {
  _id?: Types.ObjectId | string;
  user: Types.ObjectId | string;
  theme: ThemePreference;
  language: LanguagePreference;
  notifications: NotificationSettings;
  privacy: PrivacyOptions;
  timezone: string;
  fontSize: "small" | "medium" | "large";
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateUserPreferencesInput {
  theme?: ThemePreference;
  language?: LanguagePreference;
  notifications?: Partial<NotificationSettings>;
  privacy?: Partial<PrivacyOptions>;
  timezone?: string;
  fontSize?: "small" | "medium" | "large";
}

export const DEFAULT_PREFERENCES: Omit<IUserPreferences, "_id" | "user" | "createdAt" | "updatedAt"> = {
  theme: "light",
  language: "en",
  notifications: {
    email: true,
    push: true,
    inApp: true,
    marketing: false,
    courseUpdates: true,
    prayerReminders: true,
    securityAlerts: true,
  },
  privacy: {
    profileVisibility: "public",
    showActivity: true,
    showLearningProgress: true,
    allowMessagesFrom: "everyone",
    showInLeaderboards: true,
  },
  timezone: "UTC",
  fontSize: "medium",
};
