import { Request, Response } from "express";
import { prisma } from "../models/prismaClient";

const getUserAndPhoneNumberDetails = async (userId: string) => {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
    });
    const phoneNumberDetails = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: user?.selectedPhoneNumberId || "" },
    });
    return { user, phoneNumberDetails };
  };

  export const getNotificationSettings = async (req: Request, res: Response) => {
    const reqUser: any = req.user;
    const userId = reqUser.userId;
  
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
  
    try {
      const settings = await prisma.notificationSetting.findFirst({
        where: { userId },
      });
  
      return res.status(200).json(settings || {});
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch settings" });
    }
  };
  
  export const saveNotificationSettings = async (req: Request, res: Response) => {
    const reqUser: any = req.user;
    const userId = reqUser.userId;
  
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
  
    const input = req.body;
  
    try {
      await prisma.notificationSetting.upsert({
        where: {
          userId, // Ensure uniqueness based on userId
        },
        update: {
          ...input,
          userId,
        },
        create: {
          ...input,
          userId,
        },
      });
  
      return res.status(200).json({ message: "Settings saved" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to save settings" });
    }
  };
  
  
  


