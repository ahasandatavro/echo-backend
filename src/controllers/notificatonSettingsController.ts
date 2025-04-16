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

  const { phoneNumberDetails } = await getUserAndPhoneNumberDetails(userId);

  try {
    const settings = await prisma.notificationSetting.findUnique({
      where: { businessPhoneNumberId: phoneNumberDetails?.id || 0 },
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

  const { phoneNumberDetails } = await getUserAndPhoneNumberDetails(userId);
  const input = req.body;

  try {
    const existing = await prisma.notificationSetting.findUnique({
      where: { businessPhoneNumberId: phoneNumberDetails?.id || 0 },
    });

    if (existing) {
      await prisma.notificationSetting.update({
        where: { businessPhoneNumberId: phoneNumberDetails?.id || 0 },
        data: input,
      });
    } else {
      await prisma.notificationSetting.create({
        data: {
          ...input,
          businessPhoneNumberId: phoneNumberDetails?.id || 0,
        },
      });
    }

    return res.status(200).json({ message: "Settings saved" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to save settings" });
  }
};


