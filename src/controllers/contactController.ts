// @ts-nocheck
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import csvParser from "csv-parser";
import { processWebhookMessage } from "../processors/inboxProcessor";
import {sendMessage, sendTemplate} from "../processors/webhook/webhookProcessor"
const prisma = new PrismaClient();

/** 📌 Get All Contacts */
export const getAllContacts = async (req: Request, res: Response) => {
  try {
    const contacts = await prisma.contact.findMany({
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        attributes: true, // Fetch attributes as JSON
        subscribed: true,
        sendSMS: true,
        ticketStatus:true
      },
    });
    
    // Ensure attributes is an array
    const formattedContacts = contacts.map(contact => ({
      ...contact,
      attributes: Array.isArray(contact.attributes)
        ? contact.attributes
        : Object.entries(contact.attributes || {}).map(([key, value]) => ({ key, value })),
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
        attributes: attributes !== undefined ? JSON.parse(attributes) : existingContact.attributes, // Keep existing attributes if not provided
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

export const getMessagesByContactId = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate input
    if (!id) {
      return res.status(400).json({ message: "Contact ID is required" });
    }

    // Fetch messages
    const messages = await prisma.message.findMany({
      where: { contactId: parseInt(id) },
      orderBy: { time: "asc" },
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
    const existingAttributes = (contact.attributes as Record<string, any>) || {};
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

    if (!note) return res.status(400).json({ error: "Note content is required" });

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
  const { newStatus} = req.body; // `changedById` is the user ID (agent/bot)

  try {
    const contact = await prisma.contact.findUnique({ where: { id: parseInt(id) } });
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
      return res.status(403).json({ message: "User does not have a valid access token." });
    }

    // ✅ Add new entry in ChatStatusHistory
    const statusChange = await prisma.chatStatusHistory.create({
      data: {
        contactId: parseInt(id),
        previousStatus: contact.ticketStatus,
        newStatus,
        changedById: user.id || null, // If it's a bot, this can be null
        changedAt: new Date(),
        timerStartTime: newStatus === "Open" ? new Date() : contact.timerStartTime,
      },
      include: { changedBy: { select: { email: true } } }
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
        timerStartTime: { lte: new Date(currentTime.getTime() - 60 * 60 * 1000) }, // 1 hour inactivity
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

// export const sendMessage = async (req: Request, res: Response) => {
//   try {
//     const contactId = Number(req.params.contactId); // Ensure it's a number
//     const { text, template } = req.body;
//     const file = req.file; // Handle file uploads

//     if (!text && !template && !file) {
//       return res.status(400).json({ error: "Message content is required" });
//     }

//     // ✅ Fetch Contact by ID
//     let contact = await prisma.contact.findFirst({
//       where: { id: contactId },
//     });

//     if (!contact) {
//       return res.status(404).json({ error: "Contact not found" });
//     }

//     // ✅ Prepare Message Object for processWebhookMessage
//     const messageData: any = {
//       type: "text", // Default message type
//       text: { body: text || `Template: ${template}` },
//     };

//     // ✅ Handle File Upload (If any)
//     if (file) {
//       messageData.type = "media";
//       messageData.mediaType = file.mimetype; // Store file type
//       messageData.attachment = `/uploads/${file.filename}`; // Store file URL
//     }

//     // ✅ Use processWebhookMessage to handle logic (without modifying it)
//     const savedMessage = await processWebhookMessage(contact.phoneNumber, messageData);
//     const io = req.app.get("socketio"); 
//     // ✅ Emit message via socket
//     io.emit("newMessage", savedMessage);

//     return res.status(200).json(savedMessage);
//   } catch (error) {
//     console.error("Error sending message:", error);
//     res.status(500).json({ error: "Internal server error" });
//   }
// };

export const sendMessageController = async (req: Request, res: Response) => {
  try {
    const contactId = Number(req.params.contactId); // Ensure it's a number
    const { text, template, chatbotId } = req.body;
    const file = req.file; // Handle file uploads

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
        "http://localhost:5000/upload", // Change to your actual upload API URL
        formData,
        { headers: { ...formData.getHeaders() } }
      );

      fileUrl = uploadResponse.data.fileUrl; // Get uploaded file URL
    }
    // ✅ Handle WhatsApp Template Messages
    if (template) {
      await sendTemplate(contact.phoneNumber, template, chatbotId);
    }
    // ✅ Handle Regular Messages (Text, Media)
    else {
      let messageType = "text";
      let messageContent: any = { message: text };

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

        messageContent = { message: { url: fileUrl, name: fileUrl.split("/").pop() } };
      }

      // Send message to WhatsApp using your existing function
      await sendMessage(contact.phoneNumber, { type: messageType, ...messageContent }, chatbotId);
    }

    // ✅ Store Message in Database
    const savedMessage = await prisma.message.create({
      data: {
        contact: {
          connect: { id: contactId }, // ✅ Explicitly linking the contact
        },
        sender: "user",
        text: text || `Template: ${template}`,
        time: new Date(),
        status: "SENT",
        attachment: fileUrl,
      },
    });

    // ✅ Emit message to frontend via socket
    const io = req.app.get("socketio"); 
    io.emit("newMessage", {
      recipient: contact.phoneNumber, // Ensure correct recipient
      message: savedMessage, // Send the saved message object
    });
    

    return res.status(200).json(savedMessage);
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};