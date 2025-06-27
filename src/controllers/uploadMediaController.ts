import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { uploadFileToDigitalOceanHelper } from "../helpers";
import { checkMediaUploadLimit } from "../utils/packageUtils";

const prisma = new PrismaClient();

// Get all media files
export const getAllMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    // TODO: Implement get all media logic
    res.json({ message: "Get all media - to be implemented" });
  } catch (error) {
    res.status(500).json({ error: "Error fetching media files" });
  }
};

// Get a single media file by ID
export const getMediaById = async (req: Request, res: Response): Promise<void> => {
  try {
    // TODO: Implement get media by ID logic
    res.json({ message: "Get media by ID - to be implemented" });
  } catch (error) {
    res.status(500).json({ error: "Error fetching media file" });
  }
};

// Upload/create a new media file
export const uploadMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const user: any = req.user;
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
    });

    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Check media upload limit before proceeding
    const limitCheck = await checkMediaUploadLimit(dbUser.id, 1);
    if (!limitCheck.allowed) {
      res.status(403).json({ 
        error: "Media upload limit exceeded",
        details: limitCheck
      });
      return;
    }

    const bp = await prisma.businessPhoneNumber.findFirst({
      where: {
        metaPhoneNumberId: dbUser?.selectedPhoneNumberId as string,
      },
    });

    const file: any = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const fileUrl = await uploadFileToDigitalOceanHelper(file);
    const media = await prisma.media.create({
      data: {
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        url: fileUrl,
        userId: dbUser?.id as number,
        businessPhoneNumberId: bp?.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    res.status(200).json({
      message: "File uploaded successfully",
      fileUrl: fileUrl,
      mediaId: media.id,
      limitInfo: {
        currentCount: limitCheck.currentCount + 1,
        maxAllowed: limitCheck.maxAllowed,
        packageName: limitCheck.packageName
      }
    });
  } catch (error) {
    console.error("Error uploading media:", error);
    res.status(500).json({ error: "Error uploading media file" });
  }
};

// Update a media file
export const updateMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    // TODO: Implement update media logic
    res.json({ message: "Update media - to be implemented" });
  } catch (error) {
    res.status(500).json({ error: "Error updating media file" });
  }
};

// Delete a media file
export const deleteMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    // TODO: Implement delete media logic
    res.json({ message: "Delete media - to be implemented" });
  } catch (error) {
    res.status(500).json({ error: "Error deleting media file" });
  }
}; 