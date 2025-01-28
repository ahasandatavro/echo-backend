import { google } from "googleapis";
import { prisma } from '../models/prismaClient';

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
        if (!updateInAndBy || updateInAndBy.length === 0) {
          throw new Error("Invalid payload: No data provided for adding rows.");
        }

        return await sheets.spreadsheets.values.append({
          spreadsheetId:spreadsheetId.id,
          range:  `sheet1!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: variables.map((entry: any) => [entry.name, entry.value]),
          },
        });

      case "update":
        if (!referenceColumn || !referenceColumn.name || !referenceColumn.value) {
          throw new Error("Invalid payload: Reference column data is missing.");
        }

        // Read existing rows
        const readResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: sheetName,
        });

        const rows = readResponse.data.values || [];
        const headerRow = rows[0];
        let refColumnIndex = headerRow.indexOf(referenceColumn.name);

        if (refColumnIndex === -1) {
          throw new Error("Reference column not found in the sheet.");
        }

        // Find the row to update
        const rowIndex = rows.findIndex(
          (row:any) => row[refColumnIndex] === referenceColumn.value
        );

        if (rowIndex === -1) {
          throw new Error("Row not found for the reference column value.");
        }

        // Update the row
        updateInAndBy?.forEach((update: any) => {
          const updateIndex = headerRow.indexOf(update.name);
          if (updateIndex !== -1) {
            rows[rowIndex][updateIndex] = update.value;
          }
        });

        // Write updated rows back to the spreadsheet
        return await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1:Z${rows.length}`, // Adjust range as needed
          valueInputOption: "USER_ENTERED",
          requestBody: { values: rows },
        });

      case "delete":
        if (!referenceColumn || !referenceColumn.name || !referenceColumn.value) {
          throw new Error("Invalid payload: Reference column data is missing.");
        }

        // Read existing rows
        const deleteResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: sheetName,
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
        return await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1:Z${rowsToDelete.length}`, // Adjust range as needed
          valueInputOption: "USER_ENTERED",
          requestBody: { values: rowsToDelete },
        });

      default:
        throw new Error(`Invalid action "${action}" specified.`);
    }
  } catch (error) {
    console.error("Error performing Google Sheets action:");
    throw error;
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
  if (isTokenExpired(user.accessTokenExpiresAt)) {
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
