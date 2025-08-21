/**
 * Timezone utilities for working hours conversion
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
 * Convert working hours from user's timezone to UTC for storage
 * @param workingHours - Working hours in user's timezone
 * @param userTimezone - User's timezone (IANA identifier)
 * @returns Working hours converted to UTC
 */
export function convertWorkingHoursToUTC(workingHours: WorkingHours, userTimezone: string): WorkingHours {
  const utcWorkingHours: WorkingHours = {};
  
  for (const [day, dayData] of Object.entries(workingHours)) {
    if (dayData && dayData.open && dayData.times) {
      utcWorkingHours[day as keyof WorkingHours] = {
        open: dayData.open,
        times: dayData.times.map(time => {
          // Convert from user's timezone to UTC
          const fromTime = convertTimeToUTC(time.from, userTimezone);
          const toTime = convertTimeToUTC(time.to, userTimezone);
          
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
  
  return utcWorkingHours;
}

/**
 * Convert working hours from UTC back to user's timezone for display
 * @param workingHours - Working hours stored in UTC
 * @param userTimezone - User's timezone (IANA identifier)
 * @returns Working hours converted to user's timezone
 */
export function convertWorkingHoursFromUTC(workingHours: WorkingHours, userTimezone: string): WorkingHours {
  const localWorkingHours: WorkingHours = {};
  
  for (const [day, dayData] of Object.entries(workingHours)) {
    if (dayData && dayData.open && dayData.times) {
      localWorkingHours[day as keyof WorkingHours] = {
        open: dayData.open,
        times: dayData.times.map(time => {
          // Convert from UTC to user's timezone
          const fromTime = convertTimeFromUTC(time.from, userTimezone);
          const toTime = convertTimeFromUTC(time.to, userTimezone);
          
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
    
    // Get timezone offset in hours (simplified approach)
    const offsetHours = getTimezoneOffsetHours(userTimezone);
    
    // Convert to UTC by subtracting the offset
    let utcHours = hours - offsetHours;
    
    // Handle day wrapping
    if (utcHours >= 24) {
      utcHours -= 24;
    } else if (utcHours < 0) {
      utcHours += 24;
    }
    
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
      
      // Handle day wrapping again after minute adjustment
      if (utcHoursInt >= 24) {
        utcHoursInt -= 24;
      } else if (utcHoursInt < 0) {
        utcHoursInt += 24;
      }
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
    
    // Get timezone offset in hours (simplified approach)
    const offsetHours = getTimezoneOffsetHours(userTimezone);
    
    // Convert from UTC to user timezone by adding the offset
    let localHours = hours + offsetHours;
    
    // Handle day wrapping
    if (localHours >= 24) {
      localHours -= 24;
    } else if (localHours < 0) {
      localHours += 24;
    }
    
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
      
      // Handle day wrapping again after minute adjustment
      if (localHoursInt >= 24) {
        localHoursInt -= 24;
      } else if (localHoursInt < 0) {
        localHoursInt += 24;
      }
    }
    
    const result = `${localHoursInt.toString().padStart(2, '0')}:${localMinutes.toString().padStart(2, '0')}`;
    
    return result;
  } catch (error) {
    console.error(`Error converting time from UTC: ${timeString} to ${userTimezone}`, error);
    return timeString; // Return original time if conversion fails
  }
}

/**
 * Get timezone offset in hours (simplified)
 * @param timezone - IANA timezone identifier
 * @returns Offset in hours (positive for ahead of UTC, negative for behind)
 */
function getTimezoneOffsetHours(timezone: string): number {
  // Simplified timezone offsets (you can expand this list)
  const timezoneOffsets: { [key: string]: number } = {
    'UTC': 0,
    'America/New_York': -5,      // EST (UTC-5)
    'America/Chicago': -6,       // CST (UTC-6)
    'America/Denver': -7,        // MST (UTC-7)
    'America/Los_Angeles': -8,   // PST (UTC-8)
    'Europe/London': 0,          // GMT/BST (UTC+0)
    'Europe/Paris': 1,           // CET (UTC+1)
    'Europe/Berlin': 1,          // CET (UTC+1)
    'Asia/Tokyo': 9,             // JST (UTC+9)
    'Asia/Shanghai': 8,          // CST (UTC+8)
    'Asia/Kolkata': 5.5,         // IST (UTC+5:30)
    'Australia/Sydney': 10,      // AEST (UTC+10)
    'Pacific/Auckland': 12       // NZST (UTC+12)
  };
  
  return timezoneOffsets[timezone] || 0;
}

/**
 * Get the user's timezone from their business account
 * @param userId - User ID
 * @returns User's timezone or default to UTC
 */
export async function getUserTimezone(userId: number): Promise<string> {
  try {
    const { prisma } = await import('../models/prismaClient');
    
    const businessAccount = await prisma.businessAccount.findFirst({
      where: { userId },
      select: { timeZone: true }
    });
    
    return businessAccount?.timeZone || 'UTC';
  } catch (error) {
    console.error('Error getting user timezone:', error);
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
