import { fuzzy } from 'fast-fuzzy';
import { MatchType } from '../models/prismaClient';

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

      case 'FUZZY': {
        // 1. Guard against tiny inputs
        if (normalizedText.length < Math.min(3, normalizedKeyword.length)) {
          break;
        }
      
        const tolerance = keyword.fuzzyPercent ?? 20; // percent mistakes allowed
        const threshold = 1 - tolerance / 100;        // required similarity
        
        // Additional validation: check length ratio
        const textLength = normalizedText.length;
        const keywordLength = normalizedKeyword.length;
        const lengthRatio = Math.min(textLength, keywordLength) / Math.max(textLength, keywordLength);
        
        let fuzzyScore = fuzzy(normalizedText, normalizedKeyword);
        
        // Fix: fast-fuzzy returns 1.0 for substring matches (e.g., "check" in "check now")
        // We need to adjust the score based on length ratio for substring cases
        if (fuzzyScore === 1.0 && textLength !== keywordLength) {
          // If one is a substring of the other, use length ratio as the actual similarity
          fuzzyScore = lengthRatio;
        }
        
        // Apply stricter matching based on length ratio and fuzzy score quality
        let adjustedThreshold = threshold;
        
        // For very different lengths, apply conditional strictness
        if (lengthRatio < 0.7) {
          // If fuzzy score is already good (>= 0.6), be more lenient with length mismatches
          // This allows "chk nw" to match "check now" when fuzzy score is reasonable
          if (fuzzyScore >= 0.6) {
            // For good fuzzy scores with length mismatch, require at least 60% similarity
            adjustedThreshold = Math.max(threshold, 0.60);
          } else {
            // For poor fuzzy scores with length mismatch, require at least 90% similarity
            adjustedThreshold = Math.max(threshold, 0.90);
          }
        }
        
        // For poor fuzzy scores, apply minimum quality requirement
        // If fuzzy score is very low (< 0.5), require at least 50% similarity regardless of tolerance
        // This prevents matches like "chknow" vs "contact" (33% similarity) from matching
        if (fuzzyScore < 0.5) {
          adjustedThreshold = Math.max(adjustedThreshold, 0.50);
        }
        
        // For very poor fuzzy scores (< 0.4), require even higher similarity
        if (fuzzyScore < 0.4) {
          adjustedThreshold = Math.max(adjustedThreshold, 0.70);
        }
        
        if (fuzzyScore >= adjustedThreshold) {
          isMatch = true;
          matchScore = fuzzyScore;
        }
        break;
      }

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

      case 'FUZZY': {
        // 1. Guard against tiny inputs
        if (normalizedText.length < Math.min(3, normalizedKeyword.length)) {
          break;
        }
      
        const tolerance = keyword.fuzzyPercent ?? 20; // percent mistakes allowed
        const threshold = 1 - tolerance / 100;        // required similarity
        
        // Additional validation: check length ratio
        const textLength = normalizedText.length;
        const keywordLength = normalizedKeyword.length;
        const lengthRatio = Math.min(textLength, keywordLength) / Math.max(textLength, keywordLength);
        
        let fuzzyScore = fuzzy(normalizedText, normalizedKeyword);
        
        // Fix: fast-fuzzy returns 1.0 for substring matches (e.g., "check" in "check now")
        // We need to adjust the score based on length ratio for substring cases
        if (fuzzyScore === 1.0 && textLength !== keywordLength) {
          // If one is a substring of the other, use length ratio as the actual similarity
          fuzzyScore = lengthRatio;
        }
        
        // Apply stricter matching based on length ratio and fuzzy score quality
        let adjustedThreshold = threshold;
        
        // For very different lengths, apply conditional strictness
        if (lengthRatio < 0.7) {
          // If fuzzy score is already good (>= 0.6), be more lenient with length mismatches
          // This allows "chk nw" to match "check now" when fuzzy score is reasonable
          if (fuzzyScore >= 0.6) {
            // For good fuzzy scores with length mismatch, require at least 60% similarity
            adjustedThreshold = Math.max(threshold, 0.60);
          } else {
            // For poor fuzzy scores with length mismatch, require at least 90% similarity
            adjustedThreshold = Math.max(threshold, 0.90);
          }
        }
        
        // For poor fuzzy scores, apply minimum quality requirement
        // If fuzzy score is very low (< 0.5), require at least 50% similarity regardless of tolerance
        // This prevents matches like "chknow" vs "contact" (33% similarity) from matching
        if (fuzzyScore < 0.5) {
          adjustedThreshold = Math.max(adjustedThreshold, 0.50);
        }
        
        // For very poor fuzzy scores (< 0.4), require even higher similarity
        if (fuzzyScore < 0.4) {
          adjustedThreshold = Math.max(adjustedThreshold, 0.70);
        }
        
        if (fuzzyScore >= adjustedThreshold) {
          isMatch = true;
          matchScore = fuzzyScore;
        }
        break;
      }

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