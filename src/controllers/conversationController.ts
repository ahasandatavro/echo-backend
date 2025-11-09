import { prisma } from "../models/prismaClient";
import { Request, Response } from 'express';
import { sendTemplate } from "../processors/metaWebhook/webhookProcessor";
import { broadcastTemplate } from "./templateController";
import { uploadFileToDigitalOceanHelper } from "../helpers";
/**
 * Fetch the latest chat status for a contact
 */
export const getConversationStatus = async (req:Request, res:Response) => {
  try {
    const { contactId } = req.params;

    // Get the latest chat status for this contact
    const contact = await prisma.contact.findUnique({
      where: { id: parseInt(contactId) },
      
    });

    if (!contact || !contact.ticketStatus) {
      return res.status(404).json({ message: "No conversation history found" });
    }

    res.json({
      status: contact.ticketStatus
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
        newStatus: "SOLVED",
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
        newStatus: "OPENED",
        changedAt: { lt: expirationThreshold },
      },
    });

    for (const conv of expiredConversations) {
      // Create an EXPIRED status entry
      const newStatus = await prisma.chatStatusHistory.create({
        data: {
          contactId: conv.contactId,
          newStatus: "EXPIRED",
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


export const createNewConversation = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const dbUser = await prisma.user.findUnique({
      where: { id: reqUser.userId },
      select: { selectedPhoneNumberId: true },
    });
    const selectedPhoneNumberId = dbUser?.selectedPhoneNumberId;
    
    if (!selectedPhoneNumberId) {
      return res.status(400).json({ message: "No phone number selected for this user." });
    }

    // Extract data from request body (handles both JSON and form-data)
    const { contactId, phoneNumber, templateName, templateParameters } = req.body;
    
    // Handle template parameters parsing (in case it comes as string from form-data)
    let parsedTemplateParameters: Record<string, string> = {};
    if (templateParameters) {
      try {
        parsedTemplateParameters = typeof templateParameters === 'string' 
          ? JSON.parse(templateParameters) 
          : templateParameters;
      } catch (error) {
        console.error("Error parsing template parameters:", error);
        return res.status(400).json({ message: "Invalid template parameters format" });
      }
    }

    // Handle file upload for header image
    let fileUrl = "";
    if (req.file) {
      try {
        fileUrl = await uploadFileToDigitalOceanHelper(req.file, reqUser.userId);
      } catch (error) {
        console.error("Error uploading file:", error);
        return res.status(500).json({ message: "Failed to upload header image" });
      }
    }

    if (!templateName || (!contactId && !phoneNumber)) {
      return res.status(400).json({ message: "Either contactId or phoneNumber and templateName are required" });
    }

    let contact;

    // Search contact by ID or phone number
    if (contactId) {
      contact = await prisma.contact.findUnique({
        where: { id: parseInt(contactId) },
      });}
      
    if (phoneNumber) {
      contact = await prisma.contact.findFirst({
        where: { phoneNumber },
      });
    }

    // Create new contact if not found
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          phoneNumber: phoneNumber || "", // fallback empty string if no number
          source: "WhatsApp",
          createdById: reqUser.userId,
        },
      });
    }

    // Create broadcast record
    const broadcast = await prisma.broadcast.create({
      data: {
        name: `Template: ${templateName}`,
        templateName: templateName,
        userId: reqUser.userId,
        phoneNumberId: selectedPhoneNumberId,
        recipients: {
          create: [{
            contactId: contact.id
          }]
        }
      }
    });

    // Send template with all parameters including fileUrl
    await broadcastTemplate(
      contact.phoneNumber, 
      templateName, 
      0, // chatbotId (0 for single conversation)
      broadcast.id, // broadcastId from created broadcast
      selectedPhoneNumberId,
      parsedTemplateParameters,
      fileUrl // Pass the uploaded file URL
    );
const bp=await prisma.businessPhoneNumber.findFirst({
  where: {
    metaPhoneNumberId: selectedPhoneNumberId
  }
});
    // Create conversation
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        recipient: contact.phoneNumber,
        contactId: contact.id,
        businessPhoneNumberId: bp?.id,
        chatbotId: null,
      },
    });
    if(existingConversation){
      return res.status(200).json({
        message: "Conversation already exists",
        conversation: existingConversation,
        broadcastId: broadcast.id,
      });
    }
    else{ 
    const conversation = await prisma.conversation.create({
      data: {
        recipient: contact.phoneNumber,
        contactId: contact.id,
        businessPhoneNumberId: bp?.id, // optionally dynamic
        chatbotId: null, // No chatbot for template-based conversations
      },
    });
  }

    return res.status(200).json({
      message: "Template sent and conversation created",
      broadcastId: broadcast.id,
    });
  } catch (err) {
    console.error("Error in createNewConversation:", err);
    return res.status(500).json({ 
      error: "Failed to create contact, send template, or create conversation",
      details: err instanceof Error ? err.message : "Unknown error"
    });
  }
};
