import { fuzzy } from 'fast-fuzzy';
import { MatchType } from '@prisma/client';

export interface KeywordMatchResult {
  keyword: any;
  matchScore?: number;
  matchType: MatchType;
}

/**
 * Matches a text against a list of keywords based on their match type
 * @param text - The input text to match against
 * @param keywords - Array of keywords with their match types and fuzzy percentages
 * @returns The best matching keyword or null if no match found
 */
export const findMatchingKeyword = (
  text: string,
  keywords: Array<{
    id: number;
    value: string;
    matchType: MatchType;
    fuzzyPercent?: number | null;
    [key: string]: any;
  }>
): KeywordMatchResult | null => {
  if (!text || !keywords || keywords.length === 0) {
    return null;
  }

  const normalizedText = text.toLowerCase().trim();
  let bestMatch: KeywordMatchResult | null = null;
  let bestScore = 0;

  for (const keyword of keywords) {
    const normalizedKeyword = keyword.value.toLowerCase().trim();
    let matchScore = 0;
    let isMatch = false;

    switch (keyword.matchType) {
      case 'EXACT':
        if (normalizedText === normalizedKeyword) {
          isMatch = true;
          matchScore = 1.0;
        }
        break;

      case 'CONTAINS':
        if (normalizedText.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedText)) {
          isMatch = true;
          // Calculate a score based on how much of the keyword is contained
          const textLength = normalizedText.length;
          const keywordLength = normalizedKeyword.length;
          const longerLength = Math.max(textLength, keywordLength);
          const shorterLength = Math.min(textLength, keywordLength);
          matchScore = shorterLength / longerLength;
        }
        break;

      case 'FUZZY':
        const fuzzyScore = fuzzy(normalizedText, normalizedKeyword);
        const threshold = (keyword.fuzzyPercent || 80) / 100; // Default to 80% if not specified
        
        if (fuzzyScore >= threshold) {
          isMatch = true;
          matchScore = fuzzyScore;
        }
        break;

      default:
        // Fallback to exact match for unknown match types
        if (normalizedText === normalizedKeyword) {
          isMatch = true;
          matchScore = 1.0;
        }
        break;
    }

    // Update best match if this is a better match
    if (isMatch && matchScore > bestScore) {
      bestMatch = {
        keyword,
        matchScore,
        matchType: keyword.matchType
      };
      bestScore = matchScore;
    }
  }

  return bestMatch;
};

/**
 * Finds all matching keywords for a given text
 * @param text - The input text to match against
 * @param keywords - Array of keywords with their match types and fuzzy percentages
 * @returns Array of matching keywords sorted by match score (highest first)
 */
export const findAllMatchingKeywords = (
  text: string,
  keywords: Array<{
    id: number;
    value: string;
    matchType: MatchType;
    fuzzyPercent?: number | null;
    [key: string]: any;
  }>
): KeywordMatchResult[] => {
  if (!text || !keywords || keywords.length === 0) {
    return [];
  }

  const matches: KeywordMatchResult[] = [];
  const normalizedText = text.toLowerCase().trim();

  for (const keyword of keywords) {
    const normalizedKeyword = keyword.value.toLowerCase().trim();
    let matchScore = 0;
    let isMatch = false;

    switch (keyword.matchType) {
      case 'EXACT':
        if (normalizedText === normalizedKeyword) {
          isMatch = true;
          matchScore = 1.0;
        }
        break;

      case 'CONTAINS':
        if (normalizedText.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedText)) {
          isMatch = true;
          const textLength = normalizedText.length;
          const keywordLength = normalizedKeyword.length;
          const longerLength = Math.max(textLength, keywordLength);
          const shorterLength = Math.min(textLength, keywordLength);
          matchScore = shorterLength / longerLength;
        }
        break;

      case 'FUZZY':
        const fuzzyScore = fuzzy(normalizedText, normalizedKeyword);
        const threshold = (keyword.fuzzyPercent || 80) / 100;
        
        if (fuzzyScore >= threshold) {
          isMatch = true;
          matchScore = fuzzyScore;
        }
        break;

      default:
        if (normalizedText === normalizedKeyword) {
          isMatch = true;
          matchScore = 1.0;
        }
        break;
    }

    if (isMatch) {
      matches.push({
        keyword,
        matchScore,
        matchType: keyword.matchType
      });
    }
  }

  // Sort by match score (highest first)
  return matches.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
}; 