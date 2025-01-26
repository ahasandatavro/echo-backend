// @ts-nocheck
import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../models/prismaClient';
import passport from 'passport';
import "../config/passportConfig";

// export const fileList = [
//     passport.authenticate("google", { session: false }),
//     async (req: any, res: Response) => {
//       try {
//         const { accessToken } = req.authInfo; // Retrieve the access token from authInfo
  
//         if (!accessToken) {
//           return res.status(401).json({ message: "Access token not found" });
//         }
  
//         // Fetch the list of Google Spreadsheets using the access token
//         const response = await fetch(
//           "https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'",
//           {
//             headers: {
//               Authorization: `Bearer ${accessToken}`,
//             },
//           }
//         );
  
//         if (!response.ok) {
//           const errorData = await response.json();
//           console.error("Error fetching files:", errorData);
//           return res.status(response.status).json({
//             message: "Failed to fetch files",
//             error: errorData,
//           });
//         }
  
//         const data = await response.json();
  
//         // Send the list of files as JSON response
//         return res.status(200).json({
//           message: "File list fetched successfully",
//           files: data.files,
//         });
//       } catch (error) {
//         console.error("Google Callback Error:", error);
//         return res.status(500).json({
//           message: "An error occurred while fetching the file list",
//           error: error.message,
//         });
//       }
//     },
//   ];
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
      return res.status(200).json({ files: data.files });
    } catch (error) {
      console.error("Error fetching file list:", error);
      return res.status(500).json({ message: "Failed to fetch file list", error: error.message });
    }
  };
  