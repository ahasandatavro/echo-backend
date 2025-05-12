import { Request, Response } from "express";
import { prisma } from "../models/prismaClient";

export const createBusinessPhoneNumber = async (req: Request, res: Response) => {
  try {
    const { phoneNumber, businessAccountId, metaPhoneNumberId, displayName, connectionStatus, subscription } = req.body;

    const businessPhoneNumber = await prisma.businessPhoneNumber.create({
      data: {
        phoneNumber,
        businessAccountId: Number(businessAccountId),
        metaPhoneNumberId,
        displayName,
        connectionStatus,
        subscription,
      },
    });

    res.status(201).json(businessPhoneNumber);
  } catch (error) {
    console.error("Error creating business phone number:", error);
    res.status(500).json({ message: "Failed to create business phone number" });
  }
};

export const getBusinessPhoneNumbers = async (req: Request, res: Response) => {
  try {
    const { businessAccountId } = req.query;

    const where = businessAccountId ? { businessAccountId: Number(businessAccountId) } : {};

    const phoneNumbers = await prisma.businessPhoneNumber.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(phoneNumbers);
  } catch (error) {
    console.error("Error fetching business phone numbers:", error);
    res.status(500).json({ message: "Failed to fetch business phone numbers" });
  }
};

export const getBusinessPhoneNumber = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const phoneNumber = await prisma.businessPhoneNumber.findUnique({
      where: { id: Number(id) },
    });

    if (!phoneNumber) {
      return res.status(404).json({ message: "Business phone number not found" });
    }

    res.status(200).json(phoneNumber);
  } catch (error) {
    console.error("Error fetching business phone number:", error);
    res.status(500).json({ message: "Failed to fetch business phone number" });
  }
};

export const updateBusinessPhoneNumber = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { phoneNumber, displayName, connectionStatus, subscription } = req.body;

    const updatedPhoneNumber = await prisma.businessPhoneNumber.update({
      where: { id: Number(id) },
      data: {
        phoneNumber,
        displayName,
        connectionStatus,
        subscription,
      },
    });

    res.status(200).json(updatedPhoneNumber);
  } catch (error) {
    console.error("Error updating business phone number:", error);
    res.status(500).json({ message: "Failed to update business phone number" });
  }
};

export const deleteBusinessPhoneNumber = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.businessPhoneNumber.delete({
      where: { id: Number(id) },
    });

    res.status(200).json({ message: "Business phone number deleted successfully" });
  } catch (error) {
    console.error("Error deleting business phone number:", error);
    res.status(500).json({ message: "Failed to delete business phone number" });
  }
};

export const updateFallbackSettings = async (req: Request, res: Response) => {
  try {
    // 1. Get the logged-in user
    const user: any = req.user;

    // 2. Look up which phoneNumber they have selected
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    });

    if (!dbUser?.selectedPhoneNumberId) {
      return res
        .status(400)
        .json({ message: "No phone number selected for this user." });
    }
    const metaId = dbUser.selectedPhoneNumberId;

    // 2) Find the record by its string metaPhoneNumberId
    const bp = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: metaId },
      select: { id: true },
    });
    if (!bp) {
        return res
          .status(404)
          .json({ message: `No BusinessPhoneNumber found for metaId=${metaId}` });
      }
    // 3. Pull the payload from the frontend
    const { enabled, message, maxTriggers } = req.body as {
      enabled: boolean;
      message: string;
      maxTriggers: number;
    };

    // 4. Update the BusinessPhoneNumber record
    await prisma.businessPhoneNumber.update({
      where: { id: bp?.id },
      data: {
        fallbackEnabled: enabled,
        fallbackMessage: message,
        fallbackTriggerCount: maxTriggers,
      },
    });

    return res
      .status(200)
      .json({ message: "Fallback settings saved successfully." });
  } catch (err) {
    console.error("Error saving fallback settings:", err);
    return res
      .status(500)
      .json({ message: "Unable to save fallback settings." });
  }
}; 

// GET /businessPhoneNumbers/chatbot/settings/fallback
export const getFallbackSettings = async (req: Request, res: Response) => {
  const user:any = req.user;
  const dbUser = await prisma.user.findUnique({ 
    where:{ id: user.userId },
    select:{ selectedPhoneNumberId: true }
  });
  if (!dbUser?.selectedPhoneNumberId) {
    return res.status(400).json({ message: "No phone number selected" });
  }
  const bp = await prisma.businessPhoneNumber.findFirst({
    where: { metaPhoneNumberId: dbUser.selectedPhoneNumberId },
    select: { fallbackEnabled:true, fallbackMessage:true, fallbackTriggerCount: true},
  });
  if (!bp) {
      return res
        .status(404)
        .json({ message: `No BusinessPhoneNumber found` });
    }

  return res.json({
    enabled: bp?.fallbackEnabled ?? false,
    message: bp?.fallbackMessage ?? "",
    maxTriggers: bp?.fallbackTriggerCount ?? 0
  });
};
