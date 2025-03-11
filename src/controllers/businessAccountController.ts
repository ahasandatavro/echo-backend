import { Request, Response } from "express";
import { prisma } from "../models/prismaClient";

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
