import { prisma } from "../models/prismaClient";
import { Request, Response } from 'express';
import { sendTemplate } from "../processors/metaWebhook/webhookProcessor";
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


// export const createNewConversation = async (req: Request, res: Response) => {
//   const { contactId, templateName } = req.body;

//   if (!contactId || !templateName) {
//     return res.status(400).json({ message: "Contact ID and Template ID are required" });
//   }

//   try {
//     // Check if the contact already exists
//     const existingContact = await prisma.contact.findUnique({
//       where: { id: contactId },
//     });

//     let newContact: any;

//     if (!existingContact) {
//       // Create the contact if it doesn't exist
//       newContact = await prisma.contact.create({
//         data: {
//           id: contactId,
//           phoneNumber: "",
//           source: "WEB",
//         },
//       });
//     }

//     const contact = existingContact || newContact;

//     // Send the template (wait for success)
//     await sendTemplate(contact.phoneNumber, templateName, 0, {});

//     // ✅ Create a new conversation
//     const conversation = await prisma.conversation.create({
//       data: {
//         recipient: contact.phoneNumber,
//         contactId: contact.id,
//         chatbotId: 1, // or use a dynamic value if needed
//         businessPhoneNumberId: 5, // or derive dynamically
//       },
//     });

//     return res.status(200).json({
//       message: "Template sent and conversation created",
//       conversation,
//     });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ error: "Failed to create contact, send template, or create conversation" });
//   }
// };

// Run expiration check every 15 minutes
//setInterval(updateExpiredConversations, 15 * 60 * 1000);

export const createNewConversation = async (req: Request, res: Response) => {
  const { contactId, phoneNumber, templateName } = req.body;
 const reqUser:any = req.user;
 const dbUser = await prisma.user.findUnique({
  where: { id: reqUser.userId },
  select: { selectedPhoneNumberId: true },
 });
 const selectedPhoneNumberId = dbUser?.selectedPhoneNumberId;
if(!selectedPhoneNumberId){
  return res.status(400).json({ message: "No phone number selected for this user." });
}
  if (!templateName || (!contactId && !phoneNumber)) {
    return res.status(400).json({ message: "Either contactId or phoneNumber and templateName are required" });
  }

  try {
    let contact;

    // Search contact by ID or phone number
    if (contactId) {
      contact = await prisma.contact.findUnique({
        where: { id: contactId },
      });
          // Block duplicate conversation
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        contactId: contact?.id,
        recipient: contact?.phoneNumber,
      },
    });
    if (existingConversation) {
      return res.status(409).json({ message: "Conversation already exists for this contact" });
    }
    } else if (phoneNumber) {
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

    // Send the template
    await sendTemplate(contact.phoneNumber, templateName, null, {},selectedPhoneNumberId);

    // Create conversation
    const conversation = await prisma.conversation.create({
      data: {
        recipient: contact.phoneNumber,
        contactId: contact.id,
        businessPhoneNumberId: 5, // optionally dynamic
      },
    });

    return res.status(200).json({
      message: "Template sent and conversation created",
      conversation,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create contact, send template, or create conversation" });
  }
};
