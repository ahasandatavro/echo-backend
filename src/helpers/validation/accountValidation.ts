import { Request, Response, NextFunction } from 'express';
import { COMMON_TIMEZONES, COMMON_LANGUAGES, CONTENT_DIRECTIONS } from '../../types/account';

export interface ValidatedAccountDetails {
  timeZone: string;
  contentDirection: 'ltr' | 'rtl';
  language: string;
}

export const validateAccountDetails = (req: Request, res: Response, next: NextFunction) => {
  try {
    const { timeZone, contentDirection, language } = req.body;

    // Check if all required fields are present
    if (!timeZone || !contentDirection || !language) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["timeZone", "contentDirection", "language"],
        received: { timeZone, contentDirection, language }
      });
    }

    // Validate timezone
    if (typeof timeZone !== 'string' || timeZone.trim().length === 0) {
      return res.status(400).json({
        error: "Invalid timezone format",
        message: "Timezone must be a non-empty string"
      });
    }

    // Validate content direction
    if (!CONTENT_DIRECTIONS.includes(contentDirection)) {
      return res.status(400).json({
        error: "Invalid content direction",
        message: `Content direction must be one of: ${CONTENT_DIRECTIONS.join(', ')}`,
        received: contentDirection
      });
    }

    // Validate language
    if (typeof language !== 'string' || language.trim().length === 0) {
      return res.status(400).json({
        error: "Invalid language format",
        message: "Language must be a non-empty string"
      });
    }

    // Optional: Validate against common values (can be removed if you want to allow any values)
    if (!COMMON_TIMEZONES.includes(timeZone as any)) {
      console.warn(`Warning: Uncommon timezone provided: ${timeZone}`);
    }

    if (!COMMON_LANGUAGES.includes(language as any)) {
      console.warn(`Warning: Uncommon language provided: ${language}`);
    }

    // If validation passes, add validated data to request
    (req as any).validatedAccountDetails = {
      timeZone: timeZone.trim(),
      contentDirection,
      language: language.trim()
    };

    next();
  } catch (error) {
    console.error('Account validation error:', error);
    return res.status(500).json({
      error: "Validation error",
      message: "An error occurred during validation"
    });
  }
};

export const validateTimezone = (timezone: string): boolean => {
  try {
    // Basic timezone validation - check if it's a valid IANA timezone
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

export const validateLanguage = (language: string): boolean => {
  // Basic language validation - check if it's a valid BCP 47 language tag
  const languageRegex = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,3})?$/;
  return languageRegex.test(language);
};
