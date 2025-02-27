//@ts-nocheck
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import csvParser from "csv-parser";
import { processWebhookMessage } from "../processors/inboxProcessor";
import {
  sendMessage,
  sendTemplate,
} from "../processors/webhook/webhookProcessor";
import { handleChatbotTrigger } from "../subProcessors/webhook";
const prisma = new PrismaClient();
import FormData from "form-data";
import axios from "axios";
/** 📌 Get All Contacts */
// export const getAllContacts = async (req: Request, res: Response) => {
//   try {
//     const contacts = await prisma.contact.findMany({
//       select: {
//         id: true,
//         name: true,
//         phoneNumber: true,
//         attributes: true, // Fetch attributes as JSON
//         subscribed: true,
//         sendSMS: true,
//         ticketStatus: true,
//       },
//     });

//     // Ensure attributes is an array
//     const formattedContacts = contacts.map((contact) => ({
//       ...contact,
//       attributes: Array.isArray(contact.attributes)
//         ? contact.attributes
//         : Object.entries(contact.attributes || {}).map(([key, value]) => ({
//             key,
//             value,
//           })),
//     }));

//     res.json(formattedContacts);
//   } catch (error) {
//     console.error("Error fetching contacts:", error);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// };
export const getAllContacts = async (req: Request, res: Response) => {
  try {
    // Extract selectedPhoneNumberId from user
    const user:any=req.user;
    const dbUser=await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    })
    const selectedPhoneNumberId = dbUser?.selectedPhoneNumberId;

    if (!selectedPhoneNumberId) {
      return res.status(400).json({ error: "selectedPhoneNumberId is required" });
    }

    // Step 1: Find businessPhoneNumberId from BusinessPhoneNumber table
    const businessPhone = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: selectedPhoneNumberId },
      select: { id: true }, // We only need the businessPhoneNumberId
    });

    if (!businessPhone) {
      return res.status(404).json({ error: "Business phone number not found" });
    }

    const businessPhoneNumberId = businessPhone.id;

    // Step 2: Find unique contact IDs from Conversation table linked to this businessPhoneNumberId
    const conversationContacts = await prisma.conversation.findMany({
      where: { businessPhoneNumberId },
      select: { contactId: true },
      distinct: ["contactId"], // Get unique contact IDs
    });

    const contactIds = conversationContacts.map((c) => c.contactId).filter((id) => id !== null);

    if (contactIds.length === 0) {
      return res.json([]); // No contacts found
    }

    // Step 3: Fetch only the contacts that are linked via conversations
    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        attributes: true,
        subscribed: true,
        sendSMS: true,
        ticketStatus: true,
      },
    });

    // Ensure attributes is always an array
    const formattedContacts = contacts.map((contact) => ({
      ...contact,
      attributes: Array.isArray(contact.attributes)
        ? contact.attributes
        : Object.entries(contact.attributes || {}).map(([key, value]) => ({
            key,
            value,
          })),
    }));

    res.json(formattedContacts);
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** 📌 Get Contact by ID */
export const getContactById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: parseInt(id) },
      include: { conversations: true },
    });

    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    res.status(200).json(contact);
  } catch (error) {
    console.error("Error fetching contact:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** 📌 Create a New Contact */
export const createContact = async (req: Request, res: Response) => {
  const { name, phoneNumber, source, userId, tags, attributes } = req.body;

  try {
    const newContact = await prisma.contact.create({
      data: {
        name,
        phoneNumber,
        source,
        userId: userId ? parseInt(userId) : undefined,
        tags: tags || [],
        attributes: attributes ? JSON.parse(attributes) : {},
      },
    });

    res.status(201).json(newContact);
  } catch (error) {
    console.error("Error creating contact:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** 📌 Update an Existing Contact */
export const updateContact = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, phoneNumber, source, tags, attributes } = req.body;

  try {
    // Fetch existing contact to preserve current tags/attributes if not provided
    const existingContact = await prisma.contact.findUnique({
      where: { id: parseInt(id) },
      select: { tags: true, attributes: true }, // Only select necessary fields
    });

    if (!existingContact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    const updatedContact = await prisma.contact.update({
      where: { id: parseInt(id) },
      data: {
        name,
        phoneNumber,
        source,
        tags: tags !== undefined ? tags : existingContact.tags, // Keep existing tags if not provided
        attributes:
          attributes !== undefined
            ? JSON.parse(attributes)
            : existingContact.attributes, // Keep existing attributes if not provided
      },
    });

    res.status(200).json(updatedContact);
  } catch (error) {
    console.error("Error updating contact:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** 📌 Delete a Contact */
export const deleteContact = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await prisma.contact.delete({
      where: { id: parseInt(id) },
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting contact:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const uploadContacts = async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const filePath = req.file.path;
  const contacts: any[] = [];

  try {
    // Read and parse CSV file
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on("data", (row) => {
        contacts.push({
          name: row.name || "Unknown",
          phoneNumber: row.phoneNumber,
          source: row.source || "Unknown",
          userId: row.userId ? parseInt(row.userId) : null,
          tags: row.tags ? row.tags.split(",") : [],
          attributes: parseAttributes(row.attributes), // FIXED: Safe attribute parsing
        });
      })
      .on("end", async () => {
        try {
          // Insert contacts into database (avoid duplicates)
          for (const contact of contacts) {
            await prisma.contact.upsert({
              where: { phoneNumber: contact.phoneNumber },
              update: contact,
              create: contact,
            });
          }

          res.status(200).json({ message: "Contacts uploaded successfully." });
        } catch (error) {
          console.error("Error saving contacts:", error);
          res.status(500).json({ error: "Error saving contacts to database." });
        } finally {
          fs.unlinkSync(filePath); // Delete uploaded file
        }
      });
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const parseAttributes = (attributes: string): Record<string, string> => {
  if (!attributes) return {}; // Return empty object if no attributes

  try {
    // Check if it's already a valid JSON string
    return JSON.parse(attributes);
  } catch {
    // Convert "key:value,key:value" format to JSON
    return attributes.split(",").reduce((acc, attr) => {
      const [key, value] = attr.split(":");
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    }, {} as Record<string, string>);
  }
};

// export const getMessagesByContactId = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;

//     // Validate input
//     if (!id) {
//       return res.status(400).json({ message: "Contact ID is required" });
//     }

//     // Fetch messages
//     const messages = await prisma.message.findMany({
//       where: { contactId: parseInt(id) },
//       orderBy: { time: "asc" },
//       include: {
//         template: true, // ✅ Fetch template details alongside messages
//       },
//     });

//     res.status(200).json(messages);
//   } catch (error) {
//     console.error("Error fetching messages:", error);
//     res.status(500).json({ message: "Error retrieving messages" });
//   }
// };

export const getMessagesByContactId = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user: any = req.user;

    // Validate input
    if (!id) {
      return res.status(400).json({ message: "Contact ID is required" });
    }

    // ✅ Step 1: Find businessPhoneNumberId from selectedPhoneNumberId
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    });

    if (!dbUser?.selectedPhoneNumberId) {
      return res.status(400).json({ message: "Selected phone number ID is missing" });
    }

    const businessPhone = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: dbUser.selectedPhoneNumberId },
      select: { id: true },
    });

    if (!businessPhone) {
      return res.status(404).json({ message: "Business phone number not found" });
    }

    const businessPhoneNumberId = businessPhone.id;

    // ✅ Step 2: Find all conversation IDs matching contactId and businessPhoneNumberId
    const conversations = await prisma.conversation.findMany({
      where: { contactId: parseInt(id), businessPhoneNumberId },
      select: { id: true },
    });

    const conversationIds = conversations.map((c) => c.id);

    if (conversationIds.length === 0) {
      return res.status(200).json([]); // No messages if no matching conversations
    }

    // ✅ Step 3: Fetch messages linked to the found conversation IDs
    const messages = await prisma.message.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { time: "asc" },
      include: { template: true }, // ✅ Include template details
    });

    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ message: "Error retrieving messages" });
  }
};


export const getAttributes = async (req: Request, res: Response) => {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: parseInt(req.params.id) },
      select: { attributes: true },
    });
    res.json(contact?.attributes || {});
  } catch {
    res.status(500).json({ error: "Failed to fetch attributes" });
  }
};

export const updateAttribute = async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    const contactId = parseInt(req.params.id);

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) return res.status(404).json({ message: "Contact not found" });

    // Ensure attributes is an object before updating
    const existingAttributes =
      (contact.attributes as Record<string, any>) || {};
    const updatedAttributes = { ...existingAttributes, [key]: value };

    // Update the contact's attributes in the database
    await prisma.contact.update({
      where: { id: contactId },
      data: { attributes: updatedAttributes },
    });

    res.json({ message: "Attribute updated", attributes: updatedAttributes });
  } catch (error) {
    console.error("Error updating attribute:", error);
    res.status(500).json({ error: "Failed to update attribute" });
  }
};

export const getNotes = async (req: Request, res: Response) => {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: parseInt(req.params.id) },
      select: { notes: true },
    });
    res.json(contact?.notes || []);
  } catch {
    res.status(500).json({ error: "Failed to fetch notes" });
  }
};

export const addNote = async (req: Request, res: Response) => {
  try {
    const { note } = req.body;
    const contactId = parseInt(req.params.id);

    if (!note)
      return res.status(400).json({ error: "Note content is required" });

    // Create a new note entry linked to the contact
    const newNote = await prisma.note.create({
      data: {
        content: note,
        contactId: contactId,
      },
    });

    res.json({ message: "Note added", note: newNote });
  } catch (error) {
    console.error("Error adding note:", error);
    res.status(500).json({ error: "Failed to add note" });
  }
};

export const getTags = async (req: Request, res: Response) => {
  try {
    const contactId = parseInt(req.params.id);

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { tags: true },
    });

    if (!contact) return res.status(404).json({ message: "Contact not found" });

    res.json(contact.tags || []);
  } catch (error) {
    console.error("Error fetching tags:", error);
    res.status(500).json({ error: "Failed to fetch tags" });
  }
};

/**
 * Add a tag to a contact
 */
export const addTag = async (req: Request, res: Response) => {
  try {
    const contactId = parseInt(req.params.id);
    const { tag } = req.body;

    if (!tag) return res.status(400).json({ error: "Tag is required" });

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) return res.status(404).json({ message: "Contact not found" });

    if (contact.tags.includes(tag)) {
      return res.status(400).json({ error: "Tag already exists" });
    }

    const updatedContact = await prisma.contact.update({
      where: { id: contactId },
      data: { tags: { push: tag } },
    });

    res.json({ message: "Tag added", tags: updatedContact.tags });
  } catch (error) {
    console.error("Error adding tag:", error);
    res.status(500).json({ error: "Failed to add tag" });
  }
};

/**
 * Remove a tag from a contact
 */
export const removeTag = async (req: Request, res: Response) => {
  try {
    const contactId = parseInt(req.params.id);
    const tagToRemove = req.params.tag;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) return res.status(404).json({ message: "Contact not found" });

    const updatedTags = contact.tags.filter((tag) => tag !== tagToRemove);

    await prisma.contact.update({
      where: { id: contactId },
      data: { tags: updatedTags },
    });

    res.json({ message: "Tag removed", tags: updatedTags });
  } catch (error) {
    console.error("Error removing tag:", error);
    res.status(500).json({ error: "Failed to remove tag" });
  }
};

export const getChatHistory = async (req: Request, res: Response) => {
  const { contactId } = req.params;
  try {
    const chatHistory = await prisma.chatStatusHistory.findMany({
      where: { contactId: parseInt(contactId) },
      include: { changedBy: true }, // Include agent/bot details
      orderBy: { changedAt: "desc" }, // Sort by latest status change
    });

    res.json(chatHistory);
  } catch (error) {
    console.error("Error fetching chat history:", error);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
};

/**
 * ✅ Update chat status & track in history
 */
export const updateChatStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { newStatus } = req.body; // `changedById` is the user ID (agent/bot)

  try {
    const contact = await prisma.contact.findUnique({
      where: { id: parseInt(id) },
    });
    if (!contact) return res.status(404).json({ error: "Contact not found" });

    // ✅ Update Contact's current status
    await prisma.contact.update({
      where: { id: parseInt(id) },
      data: { ticketStatus: newStatus },
    });
    const userId = req.user?.userId; // Assuming `req.user` contains the authenticated user
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.accessToken) {
      return res
        .status(403)
        .json({ message: "User does not have a valid access token." });
    }

    // ✅ Add new entry in ChatStatusHistory
    const statusChange = await prisma.chatStatusHistory.create({
      data: {
        contactId: parseInt(id),
        previousStatus: contact.ticketStatus,
        newStatus,
        changedById: user.id || null, // If it's a bot, this can be null
        changedAt: new Date(),
        timerStartTime:
          newStatus === "Open" ? new Date() : contact.timerStartTime,
      },
      include: { changedBy: { select: { email: true } } },
    });
    const io = req.app.get("socketio");
    io.emit("chatStatusUpdated", {
      contactId: parseInt(id),
      chatStatus: newStatus,
      changedBy: statusChange.changedBy ? statusChange.changedBy.email : "Bot",
      changedAt: statusChange.changedAt,
    });
    res.json({ success: true, statusChange });
  } catch (error) {
    console.error("Error updating chat status:", error);
    res.status(500).json({ error: "Failed to update chat status" });
  }
};

/**
 * ✅ Auto-expire chat after inactivity
 */
export const expireInactiveChats = async (req: Request, res: Response) => {
  try {
    const currentTime = new Date();
    const expiredChats = await prisma.chatStatusHistory.findMany({
      where: {
        timerStartTime: {
          lte: new Date(currentTime.getTime() - 60 * 60 * 1000),
        }, // 1 hour inactivity
        timerEndTime: null,
      },
    });

    for (const chat of expiredChats) {
      await prisma.chatStatusHistory.update({
        where: { id: chat.id },
        data: {
          newStatus: "Expired",
          changedById: 999, // Assuming bot user ID
          changedAt: currentTime,
          timerEndTime: currentTime,
        },
      });

      await prisma.contact.update({
        where: { id: chat.contactId },
        data: { ticketStatus: "Expired" },
      });
    }

    res.json({ success: true, expiredChats: expiredChats.length });
  } catch (error) {
    console.error("Error expiring chats:", error);
    res.status(500).json({ error: "Failed to expire chats" });
  }
};

export const sendMessageController = async (req: Request, res: Response) => {
  try {
    const user:any=req.user;
    const contactId = Number(req.params.contactId); // Ensure it's a number
    const { text, template, chatbotId } = req.body;
    const file = req.file; // Handle file uploads
    const filePath = req?.file?.path||"";
    if (!text && !template && !file) {
      return res.status(400).json({ error: "Message content is required" });
    }

    // ✅ Fetch Contact by ID
    let contact = await prisma.contact.findFirst({ where: { id: contactId } });

    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }
    let fileUrl: string | null = null;
    if (file) {
      const formData = new FormData();
      const fileStream = fs.readFileSync(file.path); // ✅ Use createReadStream()

      formData.append("file", fileStream, {
        filename: file.originalname,
        contentType: file.mimetype, // ✅ Ensure correct MIME type
      });
      const uploadResponse = await axios.post(
        `${process.env.BASE_URL}/upload`, // Change to your actual upload API URL
        formData,
        { headers: { ...formData.getHeaders() } }
      );

      fileUrl = uploadResponse.data.fileUrl; // Get uploaded file URL
    }
    // ✅ Handle WhatsApp Template Messages
    let savedMessage;
    let templateDetails = null;
    let templateId = null;
    if (template) {
      const dbTemplate = await prisma.template.findFirst({
        where: { name: template },
      });

      if (!dbTemplate) {
        return res.status(404).json({ error: "Template not found in DB" });
      }

      templateId = dbTemplate.id;
      templateDetails = dbTemplate;
      await sendTemplate(contact.phoneNumber, template, chatbotId);
      savedMessage = await prisma.message.create({
        data: {
          contact: { connect: { id: contactId } },
          sender: "user",
          text: `Template: ${template}`,
          time: new Date(),
          status: "SENT",
          attachment: fileUrl,
          messageType: "template",
          template: { connect: { id: templateId } },
        },
        include: {
          template: true, // Include template details in response
        },
      });
    }
    // ✅ Handle Regular Messages (Text, Media)
    else {
      let messageType = "text";
      let messageContent: any = { message: text };
      if (text && text.startsWith("TriggerChatbot:"))
        {
          await handleChatbotTrigger(text,contact.phoneNumber);}
      if (fileUrl) {
        // Determine message type based on file extension
        const fileExtension = fileUrl.split(".").pop()?.toLowerCase();
        if (["jpg", "jpeg", "png", "gif"].includes(fileExtension)) {
          messageType = "image";
        } else if (["mp3", "wav", "ogg"].includes(fileExtension)) {
          messageType = "audio";
        } else if (["mp4", "mov"].includes(fileExtension)) {
          messageType = "video";
        } else {
          messageType = "document";
        }

        messageContent = {
          message: { url: fileUrl, name: fileUrl.split("/").pop() },
        };
      }

      // Send message to WhatsApp using your existing function
      await sendMessage(
        contact.phoneNumber,
        { type: messageType, ...messageContent },
        chatbotId,
        user.userId
      );
    }

    // ✅ Store Message in Database
  // savedMessage = await prisma.message.create({
  //     data: {
  //       contact: {
  //         connect: { id: contactId }, // ✅ Explicitly linking the contact
  //       },
  //       sender: "user",
  //       text: text || "",
  //       time: new Date(),
  //       status: "SENT",
  //       attachment: fileUrl,
  //     },
  //   });

  //   // ✅ Emit message to frontend via socket
  //   const io = req.app.get("socketio");
  //   io.emit("newMessage", {
  //     recipient: contact.phoneNumber, // Ensure correct recipient
  //     message: savedMessage, // Send the saved message object
  //     template: templateDetails,
  //   });

    if (filePath) {
      fs.unlink(filePath, (err) => {
        if (err) console.error("Failed to delete file:", err);
        else console.log(`Deleted file: ${filePath}`);
      });
    }
    return res.status(200).json(savedMessage);
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

