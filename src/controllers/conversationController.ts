import { PrismaClient } from "@prisma/client";
import { Request, Response } from 'express';
const prisma = new PrismaClient();

/**
 * Fetch the latest chat status for a contact
 */
export const getConversationStatus = async (req:Request, res:Response) => {
  try {
    const { contactId } = req.params;

    // Get the latest chat status for this contact
    const contact = await prisma.contact.findUnique({
      where: { id: parseInt(contactId) },
      include: {
        latestChatStatus: true,
      },
    });

    if (!contact || !contact.latestChatStatus) {
      return res.status(404).json({ message: "No conversation history found" });
    }

    res.json({
      status: contact.latestChatStatus.status,
      openedAt: contact.latestChatStatus.status === "OPENED" ? contact.latestChatStatus.changedAt : null,
      expiredAt: contact.latestChatStatus.status === "EXPIRED" ? contact.latestChatStatus.changedAt : null,
      solvedAt: contact.latestChatStatus.status === "SOLVED" ? contact.latestChatStatus.changedAt : null,
    });
  } catch (error) {
    console.error("Error fetching conversation status:", error);
    res.status(500).json({ error: "Failed to retrieve chat status" });
  }
};

/**
 * Mark a conversation as solved
 */
export const solveConversation = async (req:Request, res:Response) => {
  try {
    const { contactId } = req.params;

    // Create a new chat status history record
    const newStatus = await prisma.chatStatusHistory.create({
      data: {
        contactId: parseInt(contactId),
        status: "SOLVED",
      },
    });

    // Update the latest status reference in Contact
    await prisma.contact.update({
      where: { id: parseInt(contactId) },
      data: { latestChatStatusId: newStatus.id },
    });

    res.json({ message: "Conversation marked as solved", newStatus });
  } catch (error) {
    console.error("Error solving conversation:", error);
    res.status(500).json({ error: "Failed to mark conversation as solved" });
  }
};

/**
 * Automatically mark expired conversations (run as a background job)
 */
export const updateExpiredConversations = async () => {
  try {
    const now = new Date();
    const expirationThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    // Find all open conversations older than 24 hours
    const expiredConversations = await prisma.chatStatusHistory.findMany({
      where: {
        status: "OPENED",
        changedAt: { lt: expirationThreshold },
      },
    });

    for (const conv of expiredConversations) {
      // Create an EXPIRED status entry
      const newStatus = await prisma.chatStatusHistory.create({
        data: {
          contactId: conv.contactId,
          status: "EXPIRED",
        },
      });

      // Update the latest chat status in Contact
      await prisma.contact.update({
        where: { id: conv.contactId },
        data: { latestChatStatusId: newStatus.id },
      });
    }

    console.log("✅ Expired conversations updated successfully");
  } catch (error) {
    console.error("Error updating expired conversations:", error);
  }
};

// Run expiration check every 15 minutes
setInterval(updateExpiredConversations, 15 * 60 * 1000);
