import { IQuestion } from "../../interphases";
type IQuestionValidation = IQuestion["validation"];
import { Prisma } from "@prisma/client";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export const validateUserResponse = (
  userResponse: string,
  validation?: IQuestionValidation,
  responseType?: "text" | "image" | "video" | "audio" | "document"
): boolean => {
if (!validation || validation.type==="") {
    console.warn("No validation specified. Automatically accepting the response.");
    return true; // Accept if no validation is defined
  }

  const { type, minValue, maxValue, regexPattern } = validation;

  switch (type) {
    case "number": {
      const parsedNumber = parseFloat(userResponse);
      if (isNaN(parsedNumber)) {
        console.error("Response is not a valid number.");
        return false;
      }
      if (minValue !== undefined && parsedNumber < minValue) {
        console.error(`Number is less than the minimum allowed value: ${minValue}.`);
        return false;
      }
      if (maxValue !== undefined && parsedNumber > maxValue) {
        console.error(`Number exceeds the maximum allowed value: ${maxValue}.`);
        return false;
      }
      return true;
    }

    case "pattern": {
      if (!regexPattern) {
        console.warn("Regex pattern is missing for validation.");
        return false;
      }
      const regex = new RegExp(regexPattern);
      if (!regex.test(userResponse)) {
        console.error("Response does not match the regex pattern.");
        return false;
      }
      return true;
    }

    case "date": {
      const trimmedResponse = userResponse.trim();

      // Try parsing ISO 8601 format first
      const isoDate = new Date(trimmedResponse);
      if (!isNaN(isoDate.getTime())) {
        console.log("Valid ISO 8601 date:", isoDate);
        return true;
      }
    
      // Try parsing common date formats (e.g., DD/MM/YYYY, MM/DD/YYYY)
      const dateRegexes = [
        /^\d{2}\/\d{2}\/\d{4}$/, // DD/MM/YYYY or MM/DD/YYYY
        /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
        /^\d{2}-\d{2}-\d{4}$/, // DD-MM-YYYY
        /^[A-Za-z]+\s\d{1,2},\s\d{4}$/, // January 19, 2025
      ];
    
      for (const regex of dateRegexes) {
        if (regex.test(trimmedResponse)) {
          const parsedDate = new Date(trimmedResponse);
          if (!isNaN(parsedDate.getTime())) {
            console.log("Valid date:", parsedDate);
            return true;
          }
        }
      }
    
      console.error("Response is not a valid date.");
      return false;
    }

    case "datetime": {
      // Supported formats: YYYY-MM-DD HH:mm, YYYY-MM-DD HH:mm AM/PM, DD/MM/YYYY HH:mm, MM/DD/YYYY HH:mm, Month DD, YYYY HH:mm
      const datetimeRegexes = [
        /^\d{4}-\d{2}-\d{2}\s\d{1,2}:\d{2}(\s?[APap][Mm])?$/, // YYYY-MM-DD HH:mm or HH:mm AM/PM
        /^\d{2}\/\d{2}\/\d{4}\s\d{1,2}:\d{2}(\s?[APap][Mm])?$/, // DD/MM/YYYY HH:mm or HH:mm AM/PM
        /^\d{2}-\d{2}-\d{4}\s\d{1,2}:\d{2}(\s?[APap][Mm])?$/, // DD-MM-YYYY HH:mm or HH:mm AM/PM
        /^[A-Za-z]+\s\d{1,2},\s\d{4}\s\d{1,2}:\d{2}(\s?[APap][Mm])?$/, // Month DD, YYYY HH:mm or HH:mm AM/PM
      ];
    
      const isValidFormat = datetimeRegexes.some((regex) => regex.test(userResponse));
      if (!isValidFormat) {
        console.error("Response is not a valid datetime format.");
        return false;
      }
    
      let parsedDate: Date | null = null;
    
      // Parse based on format
      if (/^\d{4}-\d{2}-\d{2}/.test(userResponse)) {
        // ISO-style date
        parsedDate = new Date(userResponse.replace(" ", "T"));
      } else if (/^\d{2}\/\d{2}\/\d{4}/.test(userResponse)) {
        // DD/MM/YYYY or MM/DD/YYYY
        const [day, month, year] = userResponse.split(" ")[0].split("/").map(Number);
        const time = userResponse.split(" ")[1] || "";
        parsedDate = new Date(`${year}-${month}-${day}T${time}`);
      } else if (/^\d{2}-\d{2}-\d{4}/.test(userResponse)) {
        // DD-MM-YYYY
        const [day, month, year] = userResponse.split(" ")[0].split("-").map(Number);
        const time = userResponse.split(" ")[1] || "";
        parsedDate = new Date(`${year}-${month}-${day}T${time}`);
      } else if (/^[A-Za-z]+\s\d{1,2},\s\d{4}/.test(userResponse)) {
        // Month DD, YYYY
        parsedDate = new Date(userResponse);
      }
    
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        console.error("Parsed response is not a valid datetime.");
        return false;
      }
    
      console.log("Valid datetime:", parsedDate);
      return true;
    }
    
    case "time": {
      // Supported formats: HH:mm, hh:mm AM/PM
      const timeRegex = /^(\d{1,2}):(\d{2})(\s?[APap][Mm])?$/;
    
      if (!timeRegex.test(userResponse)) {
        console.error("Response is not a valid time format (HH:mm or hh:mm AM/PM).");
        return false;
      }
    
      const match = userResponse.match(timeRegex);
      if (!match) {
        console.error("Time format validation failed.");
        return false;
      }
    
      let [_, hoursStr, minutesStr, period] = match;
      let hours = parseInt(hoursStr, 10);
      const minutes = parseInt(minutesStr, 10);
    
      if (period) {
        period = period.trim().toUpperCase();
        if (period === "PM" && hours < 12) {
          hours += 12; // Convert PM to 24-hour format
        } else if (period === "AM" && hours === 12) {
          hours = 0; // Convert 12 AM to 0
        }
      }
    
      if (hours > 23 || minutes > 59) {
        console.error("Invalid time values.");
        return false;
      }
    
      console.log("Valid time:", `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`);
      return true;
    }
      

    case "image":
    case "video":
    case "audio":
    case "document": {
  // Ensure the response type matches the expected validation type
  if (responseType !== validation.type) {
    console.error(
      `Validation failed: Expected type "${validation.type}" but received "${responseType}".`
    );
    return false;
  }

  if (!userResponse) {
    console.error("Media ID is missing.");
    return false;
  }

  console.log(`Validating media of type ${responseType} with ID: ${userResponse}`);
  // You can add further validation here (e.g., fetch media metadata from WhatsApp API)
  return true; // Assume valid if type matches
    }

    default: {
      console.error(`Unknown validation type: ${type}.`);
      return false;
    }
  }
};

export const resolveVariables = async (text: string, chatbotId: number): Promise<string> => {
  try {
    const regex = /@(\w+)/g; // Match all occurrences of @variableName
    const matches: RegExpExecArray[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match);
    }
    
    if (matches.length === 0) return text; // If no variables, return the original text

    // Fetch all variables for the given chatbotId from the database
    const variables = await prisma.variable.findMany({
      where: { chatbotId },
    });

    // Create a mapping of variable names to their values
    const variableMap = variables.reduce((acc: Record<string, string>, variable) => {
      // Only add the variable if it doesn't already exist in the map and has a non-null value
      if (!acc[variable.name] && variable.value !== null) {
        acc[variable.name] = variable.value || ""; // Use empty string if value is undefined
      }
      return acc;
    }, {});
    

    // Replace each @variableName in the text with its value
    let resolvedText = text;
    matches.forEach((match) => {
      const variableName = match[1]; // Extract variable name (without @)
      const variableValue = variableMap[variableName] || ""; // Use the value or empty string if not found
      resolvedText = resolvedText.replace(`@${variableName}`, variableValue);
    });

    return resolvedText;
  } catch (error) {
    console.error("Error resolving variables:", error);
    return text; // If an error occurs, return the original text
  }
};