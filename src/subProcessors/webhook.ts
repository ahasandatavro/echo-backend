import { google } from "googleapis";
import { prisma } from '../models/prismaClient';
import { resolveVariables } from "../helpers/validation";
/**
 * Perform a Google Sheet action using the chatbot's owner's access token.
 * @param {Object} payload - The payload for the Google Sheets action.
 * @param {number} chatbotId - The ID of the chatbot.
 * @returns {Promise<any>} - Result of the Google Sheets API operation.
 */
export const performGoogleSheetAction = async (
  payload: {
    action: string;
    spreadsheetId: any;
    sheetName: string;
    updateInAndBy?: any[];
    referenceColumn?: { name: string; value: string };
    variables:any[]
  },
  currentNode:any
): Promise<any> => {
  try {
    // Step 1: Find the chatbot and its owner
    const chatbot = await prisma.chatbot.findUnique({
      where: { id: currentNode.chatId },
      include: { owner: true }, // Include the owner relation
    });

    if (!chatbot) {
      throw new Error("Chatbot not found.");
    }

    const ownerId = chatbot.ownerId;
    if (!ownerId) {
      throw new Error("Chatbot owner does not have a valid access token.");
    }

    const sheetOwner =  await prisma.user.findUnique({
      where: { id: ownerId },
    });
    const ownerAccessToken = await ensureValidAccessToken(sheetOwner);

    // Step 2: Authenticate with Google Sheets API
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: ownerAccessToken });

    const sheets = google.sheets({ version: "v4", auth });

    const { action, spreadsheetId, sheetName, updateInAndBy, referenceColumn, variables } = payload;

    // Step 3: Perform the specified action
    switch (action) {
      case "add":
        if (!variables || variables.length === 0) {
          throw new Error("Invalid payload: No data provided for adding rows.");
        }
    
        // Read existing header row to match columns
        const readHeaderResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId.id,
          range: `${spreadsheetId.sheetName}!A1:Z1`, // Fetch the header row
        });
    
        let headerRow = readHeaderResponse.data.values?.[0]; // Get the header row
    
        if (!headerRow) {
          throw new Error("Sheet is missing a header row.");
        }
    
        const newRow = await Promise.all(
          headerRow.map(async (columnName: string) => {
            const variable = variables.find((v: any) => v.name === columnName);
        
            if (!variable) return ""; // If no matching variable, leave blank
        
            // Resolve variable if it contains "@"
            if (typeof variable.value === "string" && variable.value.includes("@")) {
              try {
                const resolvedValue = await resolveVariables(variable.value, currentNode.chatId);
                return resolvedValue || ""; // Ensure resolvedValue is a valid string
              } catch (error) {
                console.error("Error resolving variable:", error);
                return ""; // Default to empty string on error
              }
            }
        
            // Ensure variable.value is a string or valid primitive
            return typeof variable.value === "string" || typeof variable.value === "number"
              ? variable.value
              : ""; // Default to empty string for invalid values
          })
        );
        
        
        
    
        // Append the new row to the sheet
        await sheets.spreadsheets.values.append({
          spreadsheetId: spreadsheetId.id,
          range: `${spreadsheetId.sheetName}!A1`, // Target the sheet to append rows
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [newRow], // Wrap the new row in an array to match API format
          },
        });
    
        console.log("Row successfully added.");
        return true;

        case "update":
          if (!referenceColumn || !referenceColumn.name || !referenceColumn.value) {
            console.error("Invalid payload: Reference column data is missing.");
            return false;
          }
        
          // Read existing rows
          const readResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId.id,
            range: spreadsheetId.sheetName,
          });
        
          const rows = readResponse.data.values || [];
          headerRow = rows[0];
          let refColumnIndex = headerRow.indexOf(referenceColumn.name);
        
          if (refColumnIndex === -1) {
            console.error("Reference column not found in the sheet.");
            return false;
          }
        
          // Find the row to update
          const rowIndex = rows.findIndex(
            (row: any) => row[refColumnIndex] === referenceColumn.value
          );
        
          if (rowIndex === -1) {
            console.error("Row not found for the reference column value.");
            return false;
          }
        
          // Update the row with resolved variables
          for (const update of updateInAndBy || []) {
            const updateIndex = headerRow.indexOf(update.name);
            if (updateIndex !== -1) {
              if (update.value.startsWith("@")) {
                // Resolve variable if it starts with '@'
                try {
                  const resolvedValue = await resolveVariables(update.value, currentNode.chatId);
                  rows[rowIndex][updateIndex] = resolvedValue || ""; // Replace with resolved value or empty string
                } catch (error) {
                  console.error("Error resolving variable:", error);
                  rows[rowIndex][updateIndex] = ""; // Default to empty string on error
                }
              } else {
                // If no '@', use the value directly
                rows[rowIndex][updateIndex] = update.value;
              }
            }
          }
        
          // Write updated rows back to the spreadsheet
          await sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId.id,
            range: `${spreadsheetId.sheetName}!A1:Z${rows.length}`, // Adjust range as needed
            valueInputOption: "USER_ENTERED",
            requestBody: { values: rows },
          });
        
          console.log("Rows successfully updated.");
          return true;
        
      case "delete":
        if (!referenceColumn || !referenceColumn.name || !referenceColumn.value) {
          throw new Error("Invalid payload: Reference column data is missing.");
        }

        // Read existing rows
        const deleteResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId.id,
          range: spreadsheetId.sheetName,
        });

        const rowsToDelete = deleteResponse.data.values || [];
         refColumnIndex = rowsToDelete[0].indexOf(referenceColumn.name);

        if (refColumnIndex === -1) {
          throw new Error("Reference column not found in the sheet.");
        }

        // Find the row to delete
        const rowIndexToDelete = rowsToDelete.findIndex(
          (row:any) => row[refColumnIndex] === referenceColumn.value
        );

        if (rowIndexToDelete === -1) {
          throw new Error("Row not found for deletion.");
        }

        rowsToDelete.splice(rowIndexToDelete, 1); // Remove the row

        // Write the updated rows back to the spreadsheet
         await sheets.spreadsheets.values.update({
          spreadsheetId:spreadsheetId.id,
          range: `${spreadsheetId.sheetName}!A1:Z${rowsToDelete.length}`, // Adjust range as needed
          valueInputOption: "USER_ENTERED",
          requestBody: { values: rowsToDelete },
        });
        console.log("Rows successfully deleted.");
        return true;

      default:
        console.error(`Invalid action "${action}" specified.`);
        return false;
    }
  } catch (error) {
    console.error(error);
    return false;
  }
};

export const refreshAccessToken = async (refreshToken: string): Promise<string> => {
  try {

    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.BASE_URL}/auth/google-callback`
    );
    auth.setCredentials({ refresh_token: refreshToken });

    const { token } = await auth.getAccessToken();

    if (!token) {
      throw new Error("Failed to refresh access token.");
    }

    return token;
  } catch (error) {
    console.error("Error refreshing access token:");
    throw error;
  }
};

const ensureValidAccessToken = async (user: any): Promise<string> => {
  if (user.access_token==undefined || isTokenExpired(user.accessTokenExpiresAt)) {
    console.log("Access token expired. Refreshing...");
    const newAccessToken = await refreshAccessToken(user.refreshToken);

    const expiresIn = 3600; // Token lifespan (1 hour)
    const expirationTimestamp = Math.floor(Date.now() / 1000) + expiresIn;

    // Update the database with the new token and expiration time
    await prisma.user.update({
      where: { id: user.id },
      data: { accessToken: newAccessToken, accessTokenExpiresAt: expirationTimestamp },
    });

    return newAccessToken;
  }

  return user.accessToken; // Return valid token
};

// Helper function to check if the token is expired
const isTokenExpired = (expirationTimestamp: number): boolean => {
  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  return now >= expirationTimestamp; // Token is expired if current time is past the expiration time
};
