export interface AccountDetails {
  timeZone: string;
  contentDirection: 'ltr' | 'rtl';
  language: string;
}

export interface AccountDetailsRequest {
  timeZone: string;
  contentDirection: 'ltr' | 'rtl';
  language: string;
}

export interface AccountDetailsResponse {
  message: string;
  accountDetails: {
    id: number;
    timeZone: string;
    contentDirection: string;
    language: string;
    businessName?: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

export interface AccountDetailsError {
  error: string;
  message?: string;
  required?: string[];
}

// Common timezone options
export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland'
] as const;

// Common language options
export const COMMON_LANGUAGES = [
  'en',
  'en-US',
  'en-GB',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'ru',
  'zh',
  'ja',
  'ko',
  'ar',
  'hi',
  'bn'
] as const;

// Content direction options
export const CONTENT_DIRECTIONS = ['ltr', 'rtl'] as const;
