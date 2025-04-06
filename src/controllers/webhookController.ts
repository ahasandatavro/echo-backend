// controllers/webhookController.js
import { prisma } from '../models/prismaClient';
import { Request, Response } from "express";

// Helper function to fetch user and phone number details
const getUserAndPhoneNumberDetails = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: parseInt(userId) },
  });
  const phoneNumberDetails = await prisma.businessPhoneNumber.findFirst({
    where: { metaPhoneNumberId: user?.selectedPhoneNumberId || "" },
  });
  return { user, phoneNumberDetails };
};

export const createWebhook = async (req: Request, res: Response) => {
  const { url, status, eventTypes } = req.body;

  const reqUser: any = req.user; // Ensure the user is authenticated and the user ID is available
  const userId = reqUser.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized: User not authenticated" });
  }

  // Fetch the user and phone number details using the helper function
  const { user, phoneNumberDetails } = await getUserAndPhoneNumberDetails(userId);

  try {
    const webhook = await prisma.webhook.create({
      data: {
        url,
        status,
        eventTypes,
        businessPhoneNumberId: phoneNumberDetails?.id || 0,
      },
    });
    return res.status(201).json({message:"Webhook created successfully"});
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create webhook' });
  }
};

export const getWebhooks = async (req: Request, res: Response) => {
  const reqUser: any = req.user; // Ensure the user is authenticated and the user ID is available
  const userId = reqUser.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized: User not authenticated" });
  }

  // Fetch the user and phone number details using the helper function
  const { phoneNumberDetails } = await getUserAndPhoneNumberDetails(userId);

  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        businessPhoneNumberId: phoneNumberDetails?.id || 0, // Use the ID from phoneNumberDetails
      },
      include: {
        businessPhoneNumber: true, // Include related phone number details if needed
      },
    });
    return res.status(200).json(webhooks);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
};

// Get a single webhook by ID
export const getWebhookById = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const webhook = await prisma.webhook.findUnique({
      where: {
        id: parseInt(id),
      },
      include: {
        businessPhoneNumber: true,
      },
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    return res.status(200).json(webhook);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch webhook' });
  }
};

// Update a webhook
export const updateWebhook = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { url, status, eventTypes } = req.body;

  try {
    const webhook = await prisma.webhook.update({
      where: {
        id: parseInt(id),
      },
      data: {
        url,
        status,
        eventTypes,
      },
    });
    return res.status(200).json(webhook);
  } catch (error) {
    console.error(error);
    if (error instanceof Error && 'code' in error && error.code === 'P2025') {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    return res.status(500).json({ error: 'Failed to update webhook' });
  }
};

// Delete a webhook
export const deleteWebhook = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await prisma.webhook.delete({
      where: {
        id: parseInt(id),
      },
    });
    return res.status(204).send(); // No content response for successful deletion
  } catch (error) {
    console.error(error);
    if (error instanceof Error && 'code' in error && error.code === 'P2025') {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    return res.status(500).json({ error: 'Failed to delete webhook' });
  }
};