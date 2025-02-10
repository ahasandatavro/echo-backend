import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import csvParser from "csv-parser";

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
        ticketstatus:true
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

export const updateChatStatus = async (req: Request, res: Response) =>{
  try {
    const { id } = req.params;
    const { chatStatus } = req.body;

    if (!["Open", "Pending", "Solved"].includes(chatStatus)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const updatedContact = await prisma.contact.update({
      where: { id: parseInt(id) },
      data: { ticketstatus:chatStatus },
    });

    res.json({ message: "Chat status updated", chatStatus: updatedContact.ticketstatus });
  } catch (error) {
    console.error("Error updating chat status:", error);
    res.status(500).json({ error: "Failed to update chat status" });
  }
}