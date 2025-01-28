// @ts-nocheck
import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../models/prismaClient';
import passport from 'passport';
import "../config/passportConfig";
import { google } from "googleapis";

export const fileList = async (req: any, res: Response) => {
    try {
      const userId = req.user.userId; // Ensure the user is authenticated and the user ID is available
  
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized: User not authenticated" });
      }
  
      // Fetch the user from the database to get the access token
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
  
      if (!user || !user.accessToken) {
        return res.status(403).json({ message: "No access token found for the user" });
      }
  
      const accessToken = user.accessToken;
  
      // Fetch the list of Google Spreadsheets using the access token
      const response = await fetch(
        "https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
  
      if (!response.ok) {
        const errorData = await response.json();
        console.error("Error fetching files:", errorData);
        return res.status(403).json({ message: "Failed to fetch files", error: errorData });
      }
  
      const data = await response.json();
  
      // Return the file list as JSON
      return res.status(200).json({ user:user.email, files: data.files });
    } catch (error) {
      console.error("Error fetching file list:", error);
      return res.status(500).json({ message: "Failed to fetch file list", error: error.message });
    }
  };
  
export const modifySpreadsheet = async (req: Request, res: Response) => {
  try {
    const { spreadsheetId, sheetName, action, referenceColumn, updateColumn } = req.body;

    if (!spreadsheetId || !sheetName || !action) {
      return res.status(400).json({ message: "Spreadsheet ID, sheet name, and action are required." });
    }

    // Fetch the user's access token (e.g., from your database)
    const userId = req.user?.id; // Assuming `req.user` contains the authenticated user
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.accessToken) {
      return res.status(403).json({ message: "User does not have a valid access token." });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: user.accessToken });

    const sheets = google.sheets({ version: "v4", auth });

    // Retrieve sheet metadata to get the sheet ID
    const metadataResponse = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [],
      includeGridData: false,
    });

    const sheetMetadata = metadataResponse.data.sheets?.find(
      (sheet) => sheet.properties?.title === sheetName
    );
    if (!sheetMetadata || !sheetMetadata.properties?.sheetId) {
      return res.status(404).json({ message: "Sheet not found." });
    }

    const sheetId = sheetMetadata.properties.sheetId;

    switch (action) {
      case "add":
        // Add a new row
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: sheetName,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[updateColumn.name, updateColumn.value]],
          },
        });
        break;

      case "update":
        // Update a row
        if (!referenceColumn.name || !referenceColumn.value || !updateColumn.name || !updateColumn.value) {
          return res.status(400).json({ message: "Reference and update columns are required for updates." });
        }

        const readResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: sheetName,
        });

        const rows = readResponse.data.values || [];
        const headerRow = rows[0];
        const refColumnIndex = headerRow.indexOf(referenceColumn.name);
        const updateColumnIndex = headerRow.indexOf(updateColumn.name);

        if (refColumnIndex === -1 || updateColumnIndex === -1) {
          return res.status(400).json({ message: "Column names do not match the sheet." });
        }

        const rowIndex = rows.findIndex((row) => row[refColumnIndex] === referenceColumn.value);
        if (rowIndex === -1) {
          return res.status(404).json({ message: "Row not found." });
        }

        rows[rowIndex][updateColumnIndex] = updateColumn.value;

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1:Z${rows.length}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: rows,
          },
        });
        break;

      case "delete":
        // Delete a row
        if (!referenceColumn.name || !referenceColumn.value) {
          return res.status(400).json({ message: "Reference column is required for deletions." });
        }

        const deleteResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: sheetName,
        });

        const rowsToDelete = deleteResponse.data.values || [];
        const refColumnToDeleteIndex = rowsToDelete[0].indexOf(referenceColumn.name);

        if (refColumnToDeleteIndex === -1) {
          return res.status(400).json({ message: "Column name does not match the sheet." });
        }

        const rowIndexToDelete = rowsToDelete.findIndex(
          (row) => row[refColumnToDeleteIndex] === referenceColumn.value
        );
        if (rowIndexToDelete === -1) {
          return res.status(404).json({ message: "Row not found." });
        }

        rowsToDelete.splice(rowIndexToDelete, 1); // Remove the row

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1:Z${rowsToDelete.length}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: rowsToDelete,
          },
        });
        break;

      default:
        return res.status(400).json({ message: "Invalid action." });
    }

    res.status(200).json({ message: "Spreadsheet modified successfully." });
  } catch (error) {
    console.error("Error modifying spreadsheet:", error);
    res.status(500).json({ message: "An error occurred while modifying the spreadsheet.", error });
  }
};
export const getSheetNames = async (req: Request, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const userId = req.user?.userId; // Assuming `req.user` contains the authenticated user
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    // Fetch the user from the database to get the access token
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.accessToken) {
      return res.status(403).json({ message: "No access token found for the user" });
    }

    const accessToken = user.accessToken;
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: user.accessToken });

    const sheets = google.sheets({ version: "v4", auth });

    // Fetch spreadsheet metadata to get sheet names
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheetNames = response.data.sheets?.map((sheet) => sheet.properties?.title) || [];
    res.status(200).json({ success: true, sheetNames });
  } catch (error: any) {
    console.error("Error fetching sheet names:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
