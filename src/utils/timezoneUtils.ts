/**
 * Timezone utilities for working hours conversion
 * 
 * This module provides timezone-aware working hours functionality for the metaWebhook route.
 * Working hours are stored in UTC in the database but checked against the user's local timezone.
 * 
 * Example usage:
 * - User sets working hours as 9:00 AM - 5:00 PM in their local timezone (e.g., America/New_York)
 * - System converts these hours to UTC for storage (e.g., 2:00 PM - 10:00 PM UTC during EST)
 * - When checking working hours, system converts current UTC time to user's timezone for comparison
 * - This ensures working hours are always checked against the user's local business hours
 */

export interface WorkingHourTime {
  from: string;
  to: string;
}

export interface WorkingHourDay {
  open: boolean;
  times: WorkingHourTime[];
}

export interface WorkingHours {
  [key: string]: WorkingHourDay | undefined;
  Monday?: WorkingHourDay;
  Tuesday?: WorkingHourDay;
  Wednesday?: WorkingHourDay;
  Thursday?: WorkingHourDay;
  Friday?: WorkingHourDay;
  Saturday?: WorkingHourDay;
  Sunday?: WorkingHourDay;
}

/**
 * Example: How timezone-aware working hours work
 * 
 * Scenario: Business in New York (EST/EDT)
 * - User sets working hours: 9:00 AM - 5:00 PM EST
 * - During EST (winter): 9:00 AM EST = 2:00 PM UTC
 * - During EDT (summer): 9:00 AM EDT = 1:00 PM UTC
 * 
 * When customer sends message at 3:00 PM EST:
 * - Server time: 8:00 PM UTC
 * - Convert server time to user timezone: 8:00 PM UTC = 3:00 PM EST ✅
 * - Check if 3:00 PM EST is within 9:00 AM - 5:00 PM EST ✅
 * - Result: Within working hours
 * 
 * When customer sends message at 7:00 PM EST:
 * - Server time: 12:00 AM UTC (next day)
 * - Convert server time to user timezone: 12:00 AM UTC = 7:00 PM EST ❌
 * - Check if 7:00 PM EST is within 9:00 AM - 5:00 PM EST ❌
 * - Result: Outside working hours
 */

/**
 * Convert working hours from user's timezone to UTC for storage
 * @param workingHours - Working hours in user's timezone
 * @param userTimezone - User's timezone (IANA identifier)
 * @returns Working hours converted to UTC
 */
export function convertWorkingHoursToUTC(workingHours: WorkingHours, userTimezone: string): WorkingHours {
  console.log(`🔄 Converting working hours from ${userTimezone} to UTC for storage`);
  console.log(`   - Original working hours:`, JSON.stringify(workingHours, null, 2));
  
  const utcWorkingHours: WorkingHours = {};
  
  for (const [day, dayData] of Object.entries(workingHours)) {
    if (dayData && dayData.open && dayData.times) {
      utcWorkingHours[day as keyof WorkingHours] = {
        open: dayData.open,
        times: dayData.times.map(time => {
          // Convert from user's timezone to UTC
          const fromTime = convertTimeToUTC(time.from, userTimezone);
          const toTime = convertTimeToUTC(time.to, userTimezone);
          
          console.log(`   - ${day} ${time.from}-${time.to} ${userTimezone} → ${fromTime}-${toTime} UTC`);
          
          return {
            from: fromTime,
            to: toTime
          };
        })
      };
    } else {
      utcWorkingHours[day as keyof WorkingHours] = dayData;
    }
  }
  
  console.log(`   - Converted to UTC:`, JSON.stringify(utcWorkingHours, null, 2));
  return utcWorkingHours;
}

/**
 * Convert working hours from UTC back to user's timezone for display
 * @param workingHours - Working hours stored in UTC
 * @param userTimezone - User's timezone (IANA identifier)
 * @returns Working hours converted to user's timezone
 */
export function convertWorkingHoursFromUTC(workingHours: WorkingHours, userTimezone: string): WorkingHours {
  console.log(`🔄 Converting working hours from UTC to ${userTimezone} for display`);
  console.log(`   - UTC working hours:`, JSON.stringify(workingHours, null, 2));
  
  const localWorkingHours: WorkingHours = {};
  
  for (const [day, dayData] of Object.entries(workingHours)) {
    if (dayData && dayData.open && dayData.times) {
      localWorkingHours[day as keyof WorkingHours] = {
        open: dayData.open,
        times: dayData.times.map(time => {
          // Convert from UTC to user's timezone
          const fromTime = convertTimeFromUTC(time.from, userTimezone);
          const toTime = convertTimeFromUTC(time.to, userTimezone);
          
          console.log(`   - ${day} ${time.from}-${time.to} UTC → ${fromTime}-${toTime} ${userTimezone}`);
          
          return {
            from: fromTime,
            to: toTime
          };
        })
      };
    } else {
      localWorkingHours[day as keyof WorkingHours] = dayData;
    }
  }
  
  console.log(`   - Converted to ${userTimezone}:`, JSON.stringify(localWorkingHours, null, 2));
  return localWorkingHours;
}

/**
 * Convert a time from user's timezone to UTC
 * @param timeString - Time in format "HH:MM"
 * @param userTimezone - User's timezone
 * @returns Time in UTC format "HH:MM"
 */
function convertTimeToUTC(timeString: string, userTimezone: string): string {
  try {
    const [hours, minutes] = timeString.split(':').map(Number);
    
    // Get timezone offset in hours
    const offsetHours = getTimezoneOffsetHours(userTimezone);
    
    // Convert to UTC by subtracting the offset
    let utcHours = hours - offsetHours;
    
    // Handle fractional hours (e.g., 5.5 hours = 5 hours 30 minutes)
    let utcHoursInt = Math.floor(utcHours);
    let utcMinutes = minutes;
    
    if (utcHours !== utcHoursInt) {
      // Add the fractional part to minutes
      const fractionalMinutes = Math.round((utcHours - utcHoursInt) * 60);
      utcMinutes += fractionalMinutes;
      
      // Handle minute overflow
      if (utcMinutes >= 60) {
        utcHoursInt += Math.floor(utcMinutes / 60);
        utcMinutes = utcMinutes % 60;
      }
      
      // Handle minute underflow
      if (utcMinutes < 0) {
        utcHoursInt -= Math.ceil(Math.abs(utcMinutes) / 60);
        utcMinutes = 60 + (utcMinutes % 60);
      }
    }
    
    // Handle day wrapping
    if (utcHoursInt >= 24) {
      utcHoursInt -= 24;
    } else if (utcHoursInt < 0) {
      utcHoursInt += 24;
    }
    
    const result = `${utcHoursInt.toString().padStart(2, '0')}:${utcMinutes.toString().padStart(2, '0')}`;
    
    return result;
  } catch (error) {
    console.error(`Error converting time to UTC: ${timeString} in ${userTimezone}`, error);
    return timeString; // Return original time if conversion fails
  }
}

/**
 * Convert a time from UTC to user's timezone
 * @param timeString - Time in format "HH:MM" (UTC)
 * @param userTimezone - User's timezone
 * @returns Time in user's timezone format "HH:MM"
 */
function convertTimeFromUTC(timeString: string, userTimezone: string): string {
  try {
    const [hours, minutes] = timeString.split(':').map(Number);
    
    // Get timezone offset in hours
    const offsetHours = getTimezoneOffsetHours(userTimezone);
    
    // Convert from UTC to user timezone by adding the offset
    let localHours = hours + offsetHours;
    
    // Handle fractional hours (e.g., 5.5 hours = 5 hours 30 minutes)
    let localHoursInt = Math.floor(localHours);
    let localMinutes = minutes;
    
    if (localHours !== localHoursInt) {
      // Add the fractional part to minutes
      const fractionalMinutes = Math.round((localHours - localHoursInt) * 60);
      localMinutes += fractionalMinutes;
      
      // Handle minute overflow
      if (localMinutes >= 60) {
        localHoursInt += Math.floor(localMinutes / 60);
        localMinutes = localMinutes % 60;
      }
      
      // Handle minute underflow
      if (localMinutes < 0) {
        localHoursInt -= Math.ceil(Math.abs(localMinutes) / 60);
        localMinutes = 60 + (localMinutes % 60);
      }
    }
    
    // Handle day wrapping
    if (localHoursInt >= 24) {
      localHoursInt -= 24;
    } else if (localHoursInt < 0) {
      localHoursInt += 24;
    }
    
    const result = `${localHoursInt.toString().padStart(2, '0')}:${localMinutes.toString().padStart(2, '0')}`;
    
    return result;
  } catch (error) {
    console.error(`Error converting time from UTC: ${timeString} to ${userTimezone}`, error);
    return timeString; // Return original time if conversion fails
  }
}

/**
 * Get timezone offset in hours using JavaScript's Intl API
 * This approach is compatible with the frontend's timezone selection
 * @param timezone - IANA timezone identifier
 * @returns Offset in hours (positive for ahead of UTC, negative for behind)
 */
export function getTimezoneOffsetHours(timezone: string): number {
  try {
    // Use JavaScript's Intl API to get the actual timezone offset
    // This is more accurate than hardcoded values and handles DST automatically
    const now = new Date();
    
    // Create a date formatter for the specific timezone
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'longOffset'
    });
    
    // Get the timezone offset by comparing UTC time with timezone time
    const utcTime = new Date(now.toISOString());
    const timeInTimezone = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const timeInUTC = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    
    // Calculate the offset in hours
    const offsetMs = timeInTimezone.getTime() - timeInUTC.getTime();
    const offsetHours = offsetMs / (1000 * 60 * 60);
    
    console.log(`🌍 Timezone ${timezone} offset: ${offsetHours} hours`);
    return offsetHours;
  } catch (error) {
    console.error(`❌ Error getting timezone offset for ${timezone}:`, error);
    
    // Fallback to a comprehensive lookup for common timezones
    // This matches the timezones from your frontend EXTENDED_COMMON_TZS list
    const fallbackOffsets: { [key: string]: number } = {
      // Americas & US/Canada
      'Pacific/Honolulu': -10,
      'America/Anchorage': -9,
      'America/Los_Angeles': -8,
      'America/Phoenix': -7,
      'America/Denver': -7,
      'America/Chicago': -6,
      'America/New_York': -5,
      'America/Toronto': -5,
      'America/Winnipeg': -6,
      'America/Edmonton': -7,
      'America/Vancouver': -8,
      'America/Halifax': -4,
      'America/St_Johns': -3.5,
      'America/Mexico_City': -6,
      'America/Bogota': -5,
      'America/Lima': -5,
      'America/Caracas': -4,
      'America/Santiago': -3,
      'America/Buenos_Aires': -3,
      'America/Sao_Paulo': -3,
      'America/Montevideo': -3,
      
      // Europe (inc. UTC)
      'UTC': 0,
      'Europe/Lisbon': 0,
      'Europe/London': 0,
      'Europe/Dublin': 0,
      'Europe/Madrid': 1,
      'Europe/Paris': 1,
      'Europe/Brussels': 1,
      'Europe/Amsterdam': 1,
      'Europe/Berlin': 1,
      'Europe/Rome': 1,
      'Europe/Zurich': 1,
      'Europe/Stockholm': 1,
      'Europe/Vienna': 1,
      'Europe/Prague': 1,
      'Europe/Warsaw': 1,
      'Europe/Budapest': 1,
      'Europe/Athens': 2,
      'Europe/Istanbul': 3,
      'Europe/Helsinki': 2,
      'Europe/Bucharest': 2,
      'Europe/Moscow': 3,
      
      // Africa
      'Africa/Casablanca': 1,
      'Africa/Algiers': 1,
      'Africa/Lagos': 1,
      'Africa/Accra': 0,
      'Africa/Cairo': 2,
      'Africa/Johannesburg': 2,
      'Africa/Nairobi': 3,
      
      // Middle East
      'Asia/Jerusalem': 2,
      'Asia/Amman': 2,
      'Asia/Beirut': 2,
      'Asia/Baghdad': 3,
      'Asia/Riyadh': 3,
      'Asia/Tehran': 3.5,
      'Asia/Dubai': 4,
      
      // South Asia
      'Asia/Karachi': 5,
      'Asia/Kolkata': 5.5,
      'Asia/Colombo': 5.5,
      'Asia/Kathmandu': 5.75,
      'Asia/Dhaka': 6,
      'Asia/Yangon': 6.5,
      
      // SE Asia & East Asia
      'Asia/Bangkok': 7,
      'Asia/Jakarta': 7,
      'Asia/Kuala_Lumpur': 8,
      'Asia/Singapore': 8,
      'Asia/Manila': 8,
      'Asia/Shanghai': 8,
      'Asia/Taipei': 8,
      'Asia/Tokyo': 9,
      'Asia/Seoul': 9,
      'Australia/Perth': 8,
      
      // Australia & Pacific
      'Australia/Darwin': 9.5,
      'Australia/Adelaide': 9.5,
      'Australia/Brisbane': 10,
      'Australia/Sydney': 10,
      'Australia/Melbourne': 10,
      'Pacific/Guam': 10,
      'Pacific/Port_Moresby': 10,
      'Pacific/Noumea': 11,
      'Pacific/Auckland': 12,
      'Pacific/Fiji': 12,
    };
    
    const offset = fallbackOffsets[timezone] || 0;
    console.log(`🌍 Using fallback offset for ${timezone}: ${offset} hours`);
    return offset;
  }
}

/**
 * Get the user's timezone from their business account
 * @param userId - User ID
 * @returns User's timezone or default to UTC
 */
export async function getUserTimezone(userId: number): Promise<string> {
  console.log(`🌍 Getting timezone for user ID: ${userId}`);
  
  try {
    const { prisma } = await import('../models/prismaClient');
    
    const businessAccount = await prisma.businessAccount.findFirst({
      where: { userId },
      select: { timeZone: true }
    });
    
    const timezone = businessAccount?.timeZone || 'UTC';
    console.log(`   - Business Account found: ${!!businessAccount}`);
    console.log(`   - User timezone: ${timezone}`);
    
    return timezone;
  } catch (error) {
    console.error('❌ Error getting user timezone:', error);
    console.log(`   - Falling back to UTC`);
    return 'UTC';
  }
}

/**
 * Validate if a timezone is valid
 * @param timezone - Timezone string to validate
 * @returns True if valid, false otherwise
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a timezone is supported by the frontend's timezone selection
 * This matches the EXTENDED_COMMON_TZS list from the frontend
 * @param timezone - Timezone string to check
 * @returns True if supported by frontend, false otherwise
 */
export function isFrontendSupportedTimezone(timezone: string): boolean {
  const supportedTimezones = [
    // Americas & US/Canada
    'Pacific/Honolulu',
    'America/Anchorage',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Toronto',
    'America/Winnipeg',
    'America/Edmonton',
    'America/Vancouver',
    'America/Halifax',
    'America/St_Johns',
    'America/Mexico_City',
    'America/Bogota',
    'America/Lima',
    'America/Caracas',
    'America/Santiago',
    'America/Buenos_Aires',
    'America/Sao_Paulo',
    'America/Montevideo',
    
    // Europe (inc. UTC)
    'UTC',
    'Europe/Lisbon',
    'Europe/London',
    'Europe/Dublin',
    'Europe/Madrid',
    'Europe/Paris',
    'Europe/Brussels',
    'Europe/Amsterdam',
    'Europe/Berlin',
    'Europe/Rome',
    'Europe/Zurich',
    'Europe/Stockholm',
    'Europe/Vienna',
    'Europe/Prague',
    'Europe/Warsaw',
    'Europe/Budapest',
    'Europe/Athens',
    'Europe/Istanbul',
    'Europe/Helsinki',
    'Europe/Bucharest',
    'Europe/Moscow',
    
    // Africa
    'Africa/Casablanca',
    'Africa/Algiers',
    'Africa/Lagos',
    'Africa/Accra',
    'Africa/Cairo',
    'Africa/Johannesburg',
    'Africa/Nairobi',
    
    // Middle East
    'Asia/Jerusalem',
    'Asia/Amman',
    'Asia/Beirut',
    'Asia/Baghdad',
    'Asia/Riyadh',
    'Asia/Tehran',
    'Asia/Dubai',
    
    // South Asia
    'Asia/Karachi',
    'Asia/Kolkata',
    'Asia/Colombo',
    'Asia/Kathmandu',
    'Asia/Dhaka',
    'Asia/Yangon',
    
    // SE Asia & East Asia
    'Asia/Bangkok',
    'Asia/Jakarta',
    'Asia/Kuala_Lumpur',
    'Asia/Singapore',
    'Asia/Manila',
    'Asia/Shanghai',
    'Asia/Taipei',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Australia/Perth',
    
    // Australia & Pacific
    'Australia/Darwin',
    'Australia/Adelaide',
    'Australia/Brisbane',
    'Australia/Sydney',
    'Australia/Melbourne',
    'Pacific/Guam',
    'Pacific/Port_Moresby',
    'Pacific/Noumea',
    'Pacific/Auckland',
    'Pacific/Fiji',
  ];
  
  return supportedTimezones.includes(timezone);
}

/**
 * Get current time in a specific timezone
 * @param timezone - IANA timezone identifier
 * @returns Current time in the specified timezone
 */
export function getCurrentTimeInTimezone(timezone: string): string {
  try {
    const now = new Date();
    return now.toLocaleString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch (error) {
    console.error('Error getting current time in timezone:', error);
    return new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }
}
