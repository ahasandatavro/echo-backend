import { IQuestion } from "../../interphases";
type IQuestionValidation = IQuestion["validation"];

export const validateUserResponse = (
  userResponse: string,
  validation?: IQuestionValidation
): boolean => {
if (!validation) {
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
      const date = new Date(userResponse);
      if (isNaN(date.getTime())) {
        console.error("Response is not a valid date.");
        return false;
      }
      return true;
    }

    case "datetime": {
      const dateTime = new Date(userResponse);
      if (isNaN(dateTime.getTime())) {
        console.error("Response is not a valid date-time.");
        return false;
      }
      return true;
    }

    case "time": {
      const timeRegex = /^([01]\d|2[0-3]):?([0-5]\d)$/; // Matches HH:MM format
      if (!timeRegex.test(userResponse)) {
        console.error("Response is not a valid time format (HH:MM).");
        return false;
      }
      return true;
    }

    case "image":
    case "video":
    case "audio":
    case "document": {
      console.warn(`Validation for media type (${type}) is handled separately.`);
      return true; // Media validation may involve other checks
    }

    default: {
      console.error(`Unknown validation type: ${type}.`);
      return false;
    }
  }
};
