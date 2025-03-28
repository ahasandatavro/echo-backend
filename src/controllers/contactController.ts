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
import { parse } from 'csv-parse/sync';
import path from 'path';


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

export const getAllImportedContacts = async (req: Request, res: Response) => {
  try {
    // Fetch all contacts from the database
    const contacts = await prisma.contact.findMany({
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

    // Ensure attributes is always returned as an array
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
    // Get the currently logged-in user if userId is not provided
    let contactUserId = userId;
    if (!contactUserId) {
      const reqUser: any = req.user;
      if (reqUser && reqUser.userId) {
        contactUserId = reqUser.userId;
      }
    }

    const parsedAttributes = attributes ? 
      (typeof attributes === 'string' ? JSON.parse(attributes) : attributes) : 
      {};

    // Create the new contact
    const newContact = await prisma.contact.create({
      data: {
        name,
        phoneNumber,
        source: source || 'manual',
        userId: contactUserId ? parseInt(contactUserId) : undefined,
        tags: tags || [],
        attributes: parsedAttributes,
      },
    });

    // If we have a userId, update the user's tags and attributes
    if (contactUserId) {
      const user = await prisma.user.findUnique({
        where: { id: parseInt(contactUserId) },
      });
      
      if (user) {
        // Sync tags
        if (tags && tags.length > 0) {
          const userTags = user.tags || [];
          const uniqueTags = new Set([...userTags, ...tags]);
          
          await prisma.user.update({
            where: { id: parseInt(contactUserId) },
            data: { tags: Array.from(uniqueTags) },
          });
        }
        
        // Sync attributes
        if (Object.keys(parsedAttributes).length > 0) {
          const userAttributes = user.attributes || [];
          const uniqueAttributes = new Set([
            ...userAttributes, 
            ...Object.keys(parsedAttributes)
          ]);
          
          await prisma.user.update({
            where: { id: parseInt(contactUserId) },
            data: { attributes: Array.from(uniqueAttributes) },
          });
        }
      }
    }

    res.status(201).json(newContact);
  } catch (error) {
    console.error("Error creating contact:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** 📌 Update an Existing Contact */
export const updateContact = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { 
    name, 
    phoneNumber, 
    source, 
    tags, 
    attributes, 
    subscribed, // From allowBroadcast in frontend
    sendSMS, // From allowSMS in frontend
    userId, // Allow changing the userId if needed
  } = req.body;

  try {
    // Fetch existing contact to preserve current tags/attributes if not provided
    const existingContact = await prisma.contact.findUnique({
      where: { id: parseInt(id) },
      select: { 
        tags: true, 
        attributes: true,
        subscribed: true,
        sendSMS: true,
        userId: true,
      },
    });

    if (!existingContact) {
      return res.status(404).json({ error: "Contact not found" });
    }
    
    // Determine which userId to use (new one from request or existing one)
    let contactUserId = userId !== undefined ? userId : existingContact.userId;
    
    // If userId is not provided in request but we need one, try to get from the logged-in user
    if (contactUserId === undefined || contactUserId === null) {
      const reqUser: any = req.user;
      if (reqUser && reqUser.userId) {
        contactUserId = reqUser.userId;
      }
    }

    // Parse attributes if they're provided as a string
    let parsedAttributes = existingContact.attributes;
    if (attributes !== undefined) {
      try {
        parsedAttributes = typeof attributes === 'string' 
          ? JSON.parse(attributes) 
          : attributes;
      } catch (error) {
        console.error("Error parsing attributes:", error);
        return res.status(400).json({ error: "Invalid attributes format" });
      }
    }

    // If userId has changed, need to update both old and new users
    if (existingContact.userId !== contactUserId && existingContact.userId) {
      // If there was a previous user, remove this contact's tags/attributes from them
      // This is optional - you may want to keep the old user's tags/attributes
    }

    // Update the new user's tags and attributes
    if (contactUserId) {
      const user = await prisma.user.findUnique({
        where: { id: contactUserId },
      });

      if (user) {
        // Update user tags if tags are provided
        if (tags !== undefined) {
          const userTags = user.tags || [];
          const uniqueTags = new Set([...userTags, ...tags]);
          
          await prisma.user.update({
            where: { id: contactUserId },
            data: { tags: Array.from(uniqueTags) },
          });
        }

        // Update user attributes if attributes are provided
        if (parsedAttributes && typeof parsedAttributes === 'object') {
          const attributeKeys = Object.keys(parsedAttributes);
          const userAttributes = user.attributes || [];
          const uniqueAttributes = new Set([...userAttributes, ...attributeKeys]);
          
          await prisma.user.update({
            where: { id: contactUserId },
            data: { attributes: Array.from(uniqueAttributes) },
          });
        }
      }
    }

    const updatedContact = await prisma.contact.update({
      where: { id: parseInt(id) },
      data: {
        name: name !== undefined ? name : undefined,
        phoneNumber: phoneNumber !== undefined ? phoneNumber : undefined,
        source: source !== undefined ? source : undefined,
        userId: contactUserId !== undefined ? contactUserId : undefined,
        subscribed: subscribed !== undefined ? subscribed : existingContact.subscribed,
        sendSMS: sendSMS !== undefined ? sendSMS : existingContact.sendSMS,
        tags: tags !== undefined ? tags : existingContact.tags,
        attributes: parsedAttributes,
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
    // Find the contact first to get its userId, tags, and attributes
    const contact = await prisma.contact.findUnique({
      where: { id: parseInt(id) },
      select: { userId: true, tags: true, attributes: true },
    });

    // Delete the contact
    await prisma.contact.delete({
      where: { id: parseInt(id) },
    });

    // Optionally: Update the user's tags and attributes
    // Note: This would require checking if other contacts of this user have these tags/attributes
    // before removing them. This could be complex and might not be desired behavior.
    
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

// export const updateAttribute = async (req: Request, res: Response) => {
//   try {
//     const { key, value } = req.body;
//     const contactId = parseInt(req.params.id);

//     const contact = await prisma.contact.findUnique({
//       where: { id: contactId },
//     });

//     if (!contact) return res.status(404).json({ message: "Contact not found" });

//     if (contact.userId) {
//       const user = await prisma.user.findUnique({
//         where: { id: contact.userId },
//       });
//       const existingUserAttributes = (user?.attributes as Record<string, any>) || {};
//       const updatedUserAttributes = { ...existingUserAttributes, [key]: value };

//       await prisma.user.update({
//         where: { id: contact.userId },
//         data: { attributes: updatedUserAttributes },
//       });
//     }
//     // Ensure attributes is an object before updating
//     const existingAttributes =
//       (contact.attributes as Record<string, any>) || {};
//     const updatedAttributes = { ...existingAttributes, [key]: value };

//     // Update the contact's attributes in the database
//     await prisma.contact.update({
//       where: { id: contactId },
//       data: { attributes: updatedAttributes },
//     });

//     res.json({ message: "Attribute updated", attributes: updatedAttributes });
//   } catch (error) {
//     console.error("Error updating attribute:", error);
//     res.status(500).json({ error: "Failed to update attribute" });
//   }
// };

export const updateAttribute = async (req: Request, res: Response) => {
  try {
    const updateData = req.body;
    const contactId = parseInt(req.params.id, 10);

    // Find the contact by id
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });
    
    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }

    // Use the contact's userId or get from the current user
    let userId = contact.userId;
    if (!userId) {
      const reqUser: any = req.user;
      if (reqUser && reqUser.userId) {
        userId = reqUser.userId;
        
        // Update the contact with the userId if it doesn't have one
        await prisma.contact.update({
          where: { id: contactId },
          data: { userId },
        });
      }
    }

    // Update attributes for the user if userId exists
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      
      if (user) {
        // Get existing user attribute keys
        const existingUserAttributes = user.attributes || [];
        
        // Get new attribute keys from updateData
        const newAttributeKeys = Object.keys(updateData);
        
        // Combine existing and new attribute keys, ensuring uniqueness
        const uniqueAttributes = new Set([...existingUserAttributes, ...newAttributeKeys]);
        
        await prisma.user.update({
          where: { id: userId },
          data: { attributes: Array.from(uniqueAttributes) },
        });
      }
    }

    // Update the contact's attributes
    const existingContactAttributes = (contact.attributes as Record<string, any>) || {};
    const updatedContactAttributes = { ...existingContactAttributes, ...updateData };

    const updatedContact = await prisma.contact.update({
      where: { id: contactId },
      data: { attributes: updatedContactAttributes },
    });

    res.json({
      message: "Attribute updated",
      attributes: updatedContact.attributes,
    });
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

export const addTag = async (req: Request, res: Response) => {
  try {
    const contactId = parseInt(req.params.id);
    const { tag } = req.body;

    if (!tag) return res.status(400).json({ error: "Tag is required" });

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) return res.status(404).json({ message: "Contact not found" });

    // Use the contact's userId or get from the current user
    let userId = contact.userId;
    if (!userId) {
      const reqUser: any = req.user;
      if (reqUser && reqUser.userId) {
        userId = reqUser.userId;
        
        // Update the contact with the userId if it doesn't have one
        await prisma.contact.update({
          where: { id: contactId },
          data: { userId },
        });
      }
    }
    
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      
      if (user) {
        let updatedUserTags = user.tags || [];
        if (!updatedUserTags.includes(tag)) {
          updatedUserTags = [...updatedUserTags, tag];
          await prisma.user.update({
            where: { id: userId },
            data: { tags: updatedUserTags },
          });
        }
      }
    }

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

export const removeTag = async (req: Request, res: Response) => {
  try {
    const contactId = parseInt(req.params.id);
    const tagToRemove = req.params.tag;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) return res.status(404).json({ message: "Contact not found" });

    if (contact.userId) {
      const user = await prisma.user.findUnique({
        where: { id: contact.userId },
      });
      const updatedUserTags = user?.tags.filter((tag: string) => tag !== tagToRemove) || [];
      await prisma.user.update({
        where: { id: contact.userId },
        data: { tags: updatedUserTags },
      });
    }

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
      await sendTemplate(contact.phoneNumber, template, chatbotId, templateDetails);
      // savedMessage = await prisma.message.create({
      //   data: {
      //     contact: { connect: { id: contactId } },
      //     sender: "user",
      //     text: `Template: ${template}`,
      //     time: new Date(),
      //     status: "SENT",
      //     attachment: fileUrl,
      //     messageType: "template",
      //     template: { connect: { id: templateId } },
      //   },
      //   include: {
      //     template: true, // Include template details in response
      //   },
      // });
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

// Process CSV upload and provide preview
export const uploadCSV = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const records: any[] = [];

    // Use the same csvParser that's working in uploadContacts
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on("data", (row) => {
          records.push(row);
        })
        .on("end", () => {
          resolve();
        })
        .on("error", (error) => {
          reject(error);
        });
    });

    if (records.length === 0) {
      return res.status(400).json({ error: "CSV file is empty" });
    }

    // Get column headers from first record
    const columns = Object.keys(records[0]);
    
    // Create preview with first few records
    const preview = records.slice(0, 5);

    // Store the parsed data in temp file for later import
    const tempFilePath = path.join(process.cwd(), 'uploads', `${req.file.originalname}_${Date.now()}.json`);
    fs.writeFileSync(tempFilePath, JSON.stringify(records));

    res.status(200).json({
      message: "File uploaded successfully",
      fileName: req.file.originalname,
      tempFilePath,
      preview,
      totalRecords: records.length,
      columns
    });
    
    // Clean up the original uploaded file after processing
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("Error processing CSV:", error);
    // Clean up the file if it exists
    if (req.file && req.file.path) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ 
      error: "Failed to process CSV file",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

// Import contacts from uploaded CSV after mapping
export const importContacts = async (req: Request, res: Response) => {
  const { mappedColumns, fileName, tempFilePath, updateExisting = true } = req.body;

  if (!mappedColumns || !tempFilePath) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    // Get the current user's ID for contacts that don't specify a userId
    const reqUser: any = req.user;
    const defaultUserId = reqUser?.userId;

    // Read the stored records from temp file
    const rawData = fs.readFileSync(tempFilePath, 'utf8');
    const records = JSON.parse(rawData);

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "No valid records found" });
    }

    // Process records in batches
    const batchSize = 50;
    const results = {
      total: records.length,
      successful: 0,
      failed: 0,
      new: 0,
      updated: 0,
      failures: [] as Array<{ rowIndex: number; data: any; error: string }>
    };

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      // Process each contact in the batch
      const batchPromises = batch.map(async (record, index) => {
        const rowIndex = i + index;
        
        try {
          // Map fields according to user's selection
          const contactData: any = {};
          
          // Process each mapped column
          Object.entries(mappedColumns).forEach(([targetField, sourceField]) => {
            if (sourceField && record[sourceField] !== undefined) {
              // Handle special fields
              if (targetField === 'tags' && typeof record[sourceField] === 'string') {
                contactData[targetField] = record[sourceField]
                  .replace(/^"(.*)"$/, '$1')
                  .split(',')
                  .map((tag: string) => tag.trim())
                  .filter((tag: string) => tag);
              } 
              else if (targetField === 'attributes' && typeof record[sourceField] === 'string') {
                try {
                  contactData[targetField] = JSON.parse(record[sourceField]);
                } catch (e) {
                  contactData[targetField] = record[sourceField];
                }
              }
              else if (targetField === 'allowbroadcast') {
                const value = record[sourceField];
                contactData['subscribed'] = value === 'TRUE' || value === 'true' || value === true;
              }
              else if (targetField === 'allowsms') {
                const value = record[sourceField];
                contactData['sendSMS'] = value === 'TRUE' || value === 'true' || value === true;
              }
              else {
                contactData[targetField] = record[sourceField];
              }
            }
          });

          // Ensure required fields are present
          if (!contactData.name || !contactData.phoneNumber) {
            throw new Error("Name and phone number are required");
          }

          // Assign default userId if none is provided
          if (!contactData.userId && defaultUserId) {
            contactData.userId = defaultUserId;
          }

          // Check if contact already exists
          const existingContact = await prisma.contact.findFirst({
            where: { phoneNumber: contactData.phoneNumber }
          });

          // Sync attributes and tags with user if userId is provided
          if (contactData.userId) {
            const userId = parseInt(contactData.userId);
            const user = await prisma.user.findUnique({
              where: { id: userId },
            });

            if (user) {
              // Update tags in user record
              if (contactData.tags && Array.isArray(contactData.tags) && contactData.tags.length > 0) {
                const userTags = user.tags || [];
                const uniqueTags = new Set([...userTags, ...contactData.tags]);
                await prisma.user.update({
                  where: { id: userId },
                  data: { tags: Array.from(uniqueTags) },
                });
              }

              // Update attributes in user record
              if (contactData.attributes && typeof contactData.attributes === 'object') {
                const attributeKeys = Object.keys(contactData.attributes);
                if (attributeKeys.length > 0) {
                  const userAttributes = user.attributes || [];
                  const uniqueAttributes = new Set([...userAttributes, ...attributeKeys]);
                  await prisma.user.update({
                    where: { id: userId },
                    data: { attributes: Array.from(uniqueAttributes) },
                  });
                }
              }
            }
          }

          if (existingContact) {
            if (updateExisting) {
              // Determine which userId to use
              let userId = contactData.userId || existingContact.userId;
              if (!userId && defaultUserId) {
                userId = defaultUserId;
              }
              
              // If there's a userId, sync tags and attributes with user
              if (userId) {
                const user = await prisma.user.findUnique({
                  where: { id: userId },
                });
                
                if (user) {
                  // Update user's tags
                  if (contactData.tags && Array.isArray(contactData.tags) && contactData.tags.length > 0) {
                    const userTags = user.tags || [];
                    const uniqueTags = new Set([...userTags, ...contactData.tags]);
                    await prisma.user.update({
                      where: { id: userId },
                      data: { tags: Array.from(uniqueTags) },
                    });
                  }
                  
                  // Update user's attributes
                  if (contactData.attributes && typeof contactData.attributes === 'object') {
                    const attributeKeys = Object.keys(contactData.attributes);
                    if (attributeKeys.length > 0) {
                      const userAttributes = user.attributes || [];
                      const uniqueAttributes = new Set([...userAttributes, ...attributeKeys]);
                      await prisma.user.update({
                        where: { id: userId },
                        data: { attributes: Array.from(uniqueAttributes) },
                      });
                    }
                  }
                }
              }

              // Update existing contact
              await prisma.contact.update({
                where: { id: existingContact.id },
                data: {
                  ...contactData,
                  // Ensure these fields are not undefined
                  name: contactData.name || existingContact.name,
                  userId: userId || undefined,
                  tags: contactData.tags || existingContact.tags,
                  attributes: contactData.attributes || existingContact.attributes,
                  subscribed: contactData.subscribed !== undefined ? contactData.subscribed : existingContact.subscribed,
                  sendSMS: contactData.sendSMS !== undefined ? contactData.sendSMS : existingContact.sendSMS
                }
              });
              
              results.successful++;
              results.updated++;
            } else {
              results.failed++;
              results.failures.push({
                rowIndex,
                data: record,
                error: "Contact with this phone number already exists"
              });
            }
          } else {
            // Create new contact
            await prisma.contact.create({
              data: {
                ...contactData,
                // Set defaults for optional fields
                source: contactData.source || "import",
                tags: contactData.tags || [],
                attributes: contactData.attributes || {},
                subscribed: contactData.subscribed !== undefined ? contactData.subscribed : false,
                sendSMS: contactData.sendSMS !== undefined ? contactData.sendSMS : false
              }
            });
            
            results.successful++;
            results.new++;
          }
        } catch (error) {
          results.failed++;
          results.failures.push({
            rowIndex,
            data: record,
            error: error instanceof Error ? error.message : "Unknown error"
          });
        }
      });

      // Wait for all promises in this batch to complete
      await Promise.all(batchPromises);
    }

    // Clean up the temporary file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    res.status(200).json({
      message: "Import completed",
      results
    });
  } catch (error) {
    console.error("Error importing contacts:", error);
    res.status(500).json({ 
      error: "Failed to import contacts", 
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
};