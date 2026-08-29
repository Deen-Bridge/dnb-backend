export type ProfileFieldCategory =
  | "profile"
  | "personal"
  | "preferences"
  | "security"
  | "wallet";

export type ProfileCompletionLevel =
  | "Beginner"
  | "Intermediate"
  | "Advanced"
  | "Complete";

export interface ProfileFieldDefinition {
  key: string;
  label: string;
  weight: number;
  category: ProfileFieldCategory;
  suggestion: string;
  check: (user: any) => boolean;
}

export interface ProfileFieldResult {
  key: string;
  label: string;
  category: ProfileFieldCategory;
  weight: number;
  completed: boolean;
  pointsAwarded: number;
  suggestion: string;
}

export interface ProfileCompletionResult {
  percentage: number;
  earnedPoints: number;
  totalPossiblePoints: number;
  completedCount: number;
  totalCount: number;
  isComplete: boolean;
  level: ProfileCompletionLevel;
  completedFields: string[];
  missingFields: string[];
  fields: ProfileFieldResult[];
  suggestions: string[];
  nextStep: string | null;
}

export interface UserProfileInput {
  _id?: any;
  name?: string;
  email?: string;
  avatar?: string;
  gender?: "male" | "female" | string;
  age?: number;
  country?: string;
  language?: string;
  interests?: string[];
  bio?: string;
  role?: "student" | "mentor" | "admin" | string;
  stellarWallet?: {
    publicKey?: string;
    connectedAt?: Date;
    network?: string;
  };
  twoFactor?: {
    enabled?: boolean;
    enrolledAt?: Date;
  };
  [key: string]: any;
}
