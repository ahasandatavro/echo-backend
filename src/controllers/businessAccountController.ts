import { Request, Response } from "express";
import { prisma } from "../models/prismaClient";
import { uploadFileToDigitalOcean } from "../routes/replyMaterialRoute";
export const updateBusinessSettings = async (req: Request, res: Response) => {
  try {
    // `req.user` is set by your auth middleware
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedWabaId: true },
    });

    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }
    if (!dbUser.selectedWabaId) {
      return res.status(400).json({ error: "User does not have a selected WABA ID" });
    }

    // Extract all fields from request body
    const {
      timeZone,
      workingHours,
      language,
      contentDirection,
      holidayMode,
      supportButtonEnabled,
      supportButtonWebsite,
    } = req.body;

    // Find the BusinessAccount using the selectedWabaId (stored in metaWabaId)
    let businessAccount = await prisma.businessAccount.findFirst({
      where: { metaWabaId: dbUser.selectedWabaId },
    });

    if (!businessAccount) {
      return res.status(404).json({
        error: "No BusinessAccount found for the selected WABA ID",
      });
    }

    // Parse workingHours safely (if provided as string)
    let parsedWorkingHours = undefined;
    if (workingHours) {
      parsedWorkingHours =
        typeof workingHours === "string" ? JSON.parse(workingHours) : workingHours;
    }

    // Update the found business account
    const updatedBusinessAccount = await prisma.businessAccount.update({
      where: { id: businessAccount.id },
      data: {
        timeZone,
        workingHours: parsedWorkingHours,
        language,
        contentDirection,
        holidayMode,
        supportButtonEnabled,
        supportButtonWebsite,
      },
    });
    if (req.file) {
    const fileUrl = await uploadFileToDigitalOcean(req.file);
    await prisma.user.update({
      where: { id: user.userId },
      data: { image: fileUrl },
    })

  }
    return res.json({
      message: "Business settings updated",
      businessAccount: updatedBusinessAccount,
    });
  } catch (error: any) {
    console.error("Error creating/updating business settings:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};

export const getBusinessSettings = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedWabaId: true },
    });

    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }
    if (!dbUser.selectedWabaId) {
      return res.status(400).json({ error: "User does not have a selected WABA ID" });
    }

    // Find the BusinessAccount using the selectedWabaId (stored in metaWabaId)
    const businessAccount = await prisma.businessAccount.findFirst({
      where: { metaWabaId: dbUser.selectedWabaId },
    });

    if (!businessAccount) {
      return res.status(404).json({ error: "Business settings not found" });
    }

    // Return all fields, including new ones
    res.json({
      id: businessAccount.id,
      timeZone: businessAccount.timeZone,
      workingHours: businessAccount.workingHours,
      language: businessAccount.language,
      contentDirection: businessAccount.contentDirection,
      holidayMode: businessAccount.holidayMode,
      supportButtonEnabled: businessAccount.supportButtonEnabled,
      supportButtonWebsite: businessAccount.supportButtonWebsite,
    });
  } catch (error) {
    console.error("Error fetching business settings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const saveAccountDetails = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const { timeZone, contentDirection, language } = req.body;

    // Validate required fields
    if (!timeZone || !contentDirection || !language) {
      return res.status(400).json({ 
        error: "Missing required fields", 
        required: ["timeZone", "contentDirection", "language"] 
      });
    }

    // Validate content direction
    const validContentDirections = ["ltr", "rtl"];
    if (!validContentDirections.includes(contentDirection)) {
      return res.status(400).json({ 
        error: "Invalid content direction. Must be 'ltr' or 'rtl'" 
      });
    }

    // Validate timezone format (basic validation)
    if (typeof timeZone !== "string" || timeZone.length === 0) {
      return res.status(400).json({ 
        error: "Invalid timezone format" 
      });
    }

    // Validate language format (basic validation)
    if (typeof language !== "string" || language.length === 0) {
      return res.status(400).json({ 
        error: "Invalid language format" 
      });
    }

    // First, try to find existing business account for the user
    let businessAccount = await prisma.businessAccount.findFirst({
      where: { userId: user.userId },
    });

    if (businessAccount) {
      // Update existing business account
      const updatedBusinessAccount = await prisma.businessAccount.update({
        where: { id: businessAccount.id },
        data: {
          timeZone,
          contentDirection,
          language,
          updatedAt: new Date(),
        },
      });

      return res.json({
        message: "Account details updated successfully",
        accountDetails: {
          timeZone: updatedBusinessAccount.timeZone,
          contentDirection: updatedBusinessAccount.contentDirection,
          language: updatedBusinessAccount.language,
        },
      });
    } else {
      // Create new business account for the user
      const newBusinessAccount = await prisma.businessAccount.create({
        data: {
          userId: user.userId,
          timeZone,
          contentDirection,
          language,
        },
      });

      return res.status(201).json({
        message: "Account details created successfully",
        accountDetails: {
          timeZone: newBusinessAccount.timeZone,
          contentDirection: newBusinessAccount.contentDirection,
          language: newBusinessAccount.language,
        },
      });
    }
  } catch (error: any) {
    console.error("Error saving account details:", error);
    res.status(500).json({ 
      error: "Internal server error", 
      details: error.message 
    });
  }
};

export const getAccountDetails = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;

    // Find the business account for the user
    const businessAccount = await prisma.businessAccount.findFirst({
      where: { userId: user.userId },
      select: {
        id: true,
        timeZone: true,
        contentDirection: true,
        language: true,
        businessName: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!businessAccount) {
      return res.status(404).json({ 
        error: "Account details not found",
        message: "No account details have been set for this user" 
      });
    }

    res.json({
      message: "Account details retrieved successfully",
      accountDetails: businessAccount,
    });
  } catch (error) {
    console.error("Error fetching account details:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
