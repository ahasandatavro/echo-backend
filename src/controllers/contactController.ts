//@ts-nocheck
import { Request, Response } from "express";
import { prisma } from '../models/prismaClient';
import fs from "fs";
import csvParser from "csv-parser";
import { processWebhookMessage } from "../processors/inboxProcessor";
import { broadcastTemplate } from "../controllers/templateController";
import {
  sendMessage,
  sendTemplate,
} from "../processors/metaWebhook/webhookProcessor";
import { handleChatbotTrigger, checkRulesForNodeAction } from "../subProcessors/metaWebhook";
import FormData from "form-data";
import axios from "axios";
import { parse } from 'csv-parse/sync';
import path from 'path';
import { ProcessRulesForAttributes } from "../processors/contactProcessor/contactProcessor";
import { checkContactLimit, checkChatAssignmentAccess } from "../utils/packageUtils";
import { parsePhoneNumberFromString, getCountries, getCountryCallingCode, getCountryName } from 'libphonenumber-js';
import { storeMessage } from "../processors/metaWebhook/webhookProcessor";

// Helper function to get user's phone number ID
const getUserPhoneNumberId = async (userId: number): Promise<string | undefined> => {
  const dbUser = await prisma.user.findFirst({
    where: { id: userId },
    select: { selectedPhoneNumberId: true },
  });
  return dbUser?.selectedPhoneNumberId;
};

// Helper function to check if attributes have changed
const hasAttributeChanges = (oldAttributes: any, newAttributes: any): boolean => {
  if (!oldAttributes && newAttributes) return true; // New attributes added
  if (oldAttributes && !newAttributes) return true; // All attributes removed
  if (!oldAttributes && !newAttributes) return false; // No attributes in both
  
  const oldKeys = Object.keys(oldAttributes || {});
  const newKeys = Object.keys(newAttributes || {});
  
  // Check if any keys were added or removed
  if (oldKeys.length !== newKeys.length) return true;
  
  // Check if any values changed
  for (const key of newKeys) {
    if (oldAttributes[key] !== newAttributes[key]) return true;
  }
  
  return false;
};

export const getAllContacts = async (req: Request, res: Response) => {
  //console.log('🔄 Starting getAllContacts function');
  try {
    // Extract selectedPhoneNumberId from user
    const user:any=req.user;
    //console.log('👤 User from request:', user);
    
    const dbUser=await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    })
    //console.log('📱 DB User selectedPhoneNumberId:', dbUser?.selectedPhoneNumberId);
    
    const selectedPhoneNumberId = dbUser?.selectedPhoneNumberId;

    if (!selectedPhoneNumberId) {
      //console.log('❌ No selectedPhoneNumberId found');
      return res.status(400).json({ error: "selectedPhoneNumberId is required" });
    }

    // Step 1: Find businessPhoneNumberId from BusinessPhoneNumber table
    //console.log('🔍 Looking up business phone number...');
    const businessPhone = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: selectedPhoneNumberId },
      select: { id: true }, // We only need the businessPhoneNumberId
    });

    if (!businessPhone) {
     // console.log('❌ Business phone number not found');
      return res.status(404).json({ error: "Business phone number not found" });
    }

    const businessPhoneNumberId = businessPhone.id;
    //console.log('✅ Found businessPhoneNumberId:', businessPhoneNumberId);

    // Step 2: Find unique contact IDs from Conversation table linked to this businessPhoneNumberId
   // console.log('🔍 Fetching conversation contacts...');
    const conversationContacts = await prisma.conversation.findMany({
      where: { businessPhoneNumberId },
      select: { contactId: true },
      distinct: ["contactId"], // Get unique contact IDs
    });

    const contactIds = conversationContacts.map((c) => c.contactId).filter((id) => id !== null);
   // console.log('📊 Found contact IDs:', contactIds.length);

    if (contactIds.length === 0) {
      //console.log('ℹ️ No contacts found');
      return res.json([]); // No contacts found
    }

    // Get favorite filter from query parameters
    const { favorite } = req.query;
    let favoriteFilter = {};
    
    if (favorite !== undefined) {
      const isFavorite = favorite === 'true';
      favoriteFilter = { favorite: isFavorite };
    }

    // Step 3: Fetch contacts with their latest message time, ordered by most recent message first
   // console.log('🔍 Fetching contact details with latest message time...');
    const contacts = await prisma.contact.findMany({
      where: { 
        id: { in: contactIds },
        ...favoriteFilter
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        attributes: true,
        subscribed: true,
        sendSMS: true,
        ticketStatus: true,
        favorite: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { time: 'desc' },
          take: 1,
          select: { time: true }
        }
      },
      orderBy: {
        messages: {
          _count: 'desc'
        }
      }
    });

    // Sort contacts by their latest message time (most recent first)
    const sortedContacts = contacts.sort((a, b) => {
      const aLatestTime = a.messages[0]?.time || a.createdAt;
      const bLatestTime = b.messages[0]?.time || b.createdAt;
      return new Date(bLatestTime).getTime() - new Date(aLatestTime).getTime();
    });

    // Remove the messages array from the response
    const contactsWithoutMessages = sortedContacts.map(({ messages, ...contact }) => contact);
   // console.log('✅ Found contacts:', contacts.length);

    // Ensure attributes is always an array
   // console.log('🔄 Formatting contact attributes...');
    const formattedContacts = contactsWithoutMessages.map((contact) => ({
      ...contact,
      attributes: Array.isArray(contact.attributes)
        ? contact.attributes
        : Object.entries(contact.attributes || {}).map(([key, value]) => ({
            key,
            value,
          })),
    }));
   // console.log('✅ Contacts formatted successfully');

   // console.log('🎉 Successfully returning contacts');
    res.json(formattedContacts);
  } catch (error) {
    console.error('❌ Error in getAllContacts:', error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getAllImportedContacts = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;

    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: {
        id: true,
        agent: true,
        createdById: true,
      },
    });
const bp=await prisma.businessPhoneNumber.findFirst({
  where: {
    metaPhoneNumberId: dbUser?.selectedPhoneNumberId,
  },
});
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    let userIdsToInclude: number[] = [];

    if (dbUser.agent) {
      // ✅ If agent: include self + same creator + fellow agents
      const agents = await prisma.user.findMany({
        where: {
          createdById: dbUser.createdById || undefined,
          agent: true,
        },
        select: { id: true },
      });

      userIdsToInclude = [
        ...agents.map((a) => a.id),
        dbUser.createdById!,
        dbUser.id,
      ];
    } else {
      // ✅ If creator: include self + agents created by them
      const agents = await prisma.user.findMany({
        where: {
          createdById: dbUser.id,
          agent: true,
        },
        select: { id: true },
      });

      userIdsToInclude = [dbUser.id, ...agents.map((a) => a.id)];
    }

    // Get query parameters
    const { favorite, search, page = '1', limit = '20' } = req.query;
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);
    const offset = (pageNumber - 1) * limitNumber;
    
    let favoriteFilter = {};
    let searchFilter = {};
    
    if (favorite !== undefined) {
      const isFavorite = favorite === 'true';
      favoriteFilter = { favorite: isFavorite };
    }

    if (search && typeof search === 'string' && search.trim()) {
      const searchTerm = search.trim();
      searchFilter = {
        OR: [
          {
            name: {
              contains: searchTerm,
              mode: 'insensitive',
            },
          },
          {
            phoneNumber: {
              contains: searchTerm,
              mode: 'insensitive',
            },
          },
        ],
      };
    }

    // Step 1: Get business phone number ID for conversation contacts
    const businessPhone = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: dbUser?.selectedPhoneNumberId },
      select: { id: true },
    });

    // Step 2: Get conversation contact IDs (recipients who messaged this business phone)
    let conversationContactIds: number[] = [];
    if (businessPhone) {
      const conversationContacts = await prisma.conversation.findMany({
        where: { businessPhoneNumberId: businessPhone.id },
        select: { contactId: true },
        distinct: ["contactId"],
      });
      conversationContactIds = conversationContacts.map((c) => c.contactId).filter((id) => id !== null);
    }

    // Step 3: Fetch all contacts created by any of the users in the set with search and pagination
    const createdContacts = await prisma.contact.findMany({
      where: {
        createdById: {
          in: userIdsToInclude,
        },
        ...favoriteFilter,
        ...searchFilter,
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        attributes: true,
        subscribed: true,
        sendSMS: true,
        ticketStatus: true,
        favorite: true,
        createdAt: true,
        updatedAt: true,
      },
      skip: offset,
      take: limitNumber,
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Step 4: Fetch conversation contacts (recipients) that aren't already in createdContacts
    const existingContactIds = new Set(createdContacts.map(c => c.id));
    const uniqueConversationContactIds = conversationContactIds.filter(id => !existingContactIds.has(id));
    
    let conversationContacts: any[] = [];
    if (uniqueConversationContactIds.length > 0) {
      conversationContacts = await prisma.contact.findMany({
        where: {
          id: { in: uniqueConversationContactIds },
          ...favoriteFilter,
          ...searchFilter,
        },
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          attributes: true,
          subscribed: true,
          sendSMS: true,
          ticketStatus: true,
          favorite: true,
          createdAt: true,
          updatedAt: true,
        },
        skip: offset,
        take: limitNumber,
        orderBy: {
          createdAt: 'desc',
        },
      });
    }

    // Step 5: Combine both sets of contacts
    const contacts = [...createdContacts, ...conversationContacts];

    // Get total count for pagination
    const totalCreatedContacts = await prisma.contact.count({
      where: {
        createdById: {
          in: userIdsToInclude,
        },
        ...favoriteFilter,
        ...searchFilter,
      },
    });

    const totalConversationContacts = uniqueConversationContactIds.length > 0 
      ? await prisma.contact.count({
          where: {
            id: { in: uniqueConversationContactIds },
            ...favoriteFilter,
            ...searchFilter,
          },
        })
      : 0;

    const totalContacts = totalCreatedContacts + totalConversationContacts;
    const totalPages = Math.ceil(totalContacts / limitNumber);

    // ✅ Format attributes into array of {key, value} objects
    const formattedContacts = contacts.map((contact) => ({
      ...contact,
      attributes: Array.isArray(contact.attributes)
        ? contact.attributes
        : Object.entries(contact.attributes || {}).map(([key, value]) => ({
            key,
            value,
          })),
    }));

    res.json({
      contacts: formattedContacts,
      pagination: {
        currentPage: pageNumber,
        totalPages,
        totalContacts,
        limit: limitNumber,
        hasNextPage: pageNumber < totalPages,
        hasPreviousPage: pageNumber > 1,
      },
    });
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
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        email: true,
        source: true,
        userId: true,
        tags: true,
        attributes: true,
        createdAt: true,
        updatedAt: true,
        sendSMS: true,
        subscribed: true,
        favorite: true,
        latestChatStatusId: true,
        lastMessageTime: true,
        ticketStatus: true,
        timerEndTime: true,
        timerStartTime: true,
        createdById: true,
        conversations: true,
      },
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

/** 📌 Get Multiple Contacts by IDs */
export const getContactsByIds = async (req: Request, res: Response) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.status(400).json({ error: "Contact IDs are required" });
    }

    // Parse the IDs from query parameter
    let contactIds: number[];
    if (typeof ids === 'string') {
      // Handle comma-separated string: "1,2,3"
      contactIds = ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    } else if (Array.isArray(ids)) {
      // Handle array: ["1", "2", "3"]
      contactIds = ids.map(id => parseInt(String(id))).filter(id => !isNaN(id));
    } else {
      return res.status(400).json({ error: "Invalid IDs format" });
    }

    if (contactIds.length === 0) {
      return res.status(400).json({ error: "No valid contact IDs provided" });
    }

    // Fetch contacts with the same structure as getContactById
    const contacts = await prisma.contact.findMany({
      where: { 
        id: { in: contactIds }
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
      },
    });

    // Format attributes for each contact (same as in getAllContacts)
    const formattedContacts = contacts.map((contact) => ({
      ...contact,
      attributes: Array.isArray(contact.attributes)
        ? contact.attributes
        : Object.entries(contact.attributes || {}).map(([key, value]) => ({
            key,
            value,
          })),
    }));

    res.status(200).json({
      contacts: formattedContacts,
      total: formattedContacts.length,
      requested: contactIds.length,
      found: formattedContacts.length,
      missing: contactIds.filter(id => !contacts.some(c => c.id === id))
    });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** 📌 Create a New Contact */
export const createContact = async (req: Request, res: Response) => {
  const { name, phoneNumber, source, userId,subscribed, sendSMS, tags, attributes } = req.body;

  try {
    // Get the currently logged-in user if userId is not provided
    let contactUserId = userId;
    if (!contactUserId) {
      const reqUser: any = req.user;
      if (reqUser && reqUser.userId) {
        contactUserId = reqUser.userId;
      }
    }

    // Check contact limit before creating
    const limitCheck = await checkContactLimit(contactUserId, 1);
    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: "Contact limit exceeded",
        message: limitCheck.message,
        currentCount: limitCheck.currentCount,
        maxAllowed: limitCheck.maxAllowed,
        packageName: limitCheck.packageName
      });
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
        subscribed: subscribed !== undefined ? subscribed : false,
        sendSMS: sendSMS !== undefined ? sendSMS : false,
        tags: tags || [],
        attributes: parsedAttributes,
        createdById: contactUserId ? parseInt(contactUserId) : undefined,
      },
    });

    // Check if attributes were added and trigger rules
    if (Object.keys(parsedAttributes).length > 0) {
      const phoneNumberId = await getUserPhoneNumberId(contactUserId);
      if (phoneNumberId) {
        await checkRulesForNodeAction(phoneNumber, "attributeAdded", phoneNumberId, contactUserId);
      }
    }

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
        phoneNumber: true,
      },
    });

    if (!existingContact) {
      return res.status(404).json({ error: "Contact not found" });
    }
  
  // Determine which userId to use (new one from request or existing one)
    let contactUserId = userId !== undefined ? userId : existingContact.userId;
    const dbUser = await prisma.user.findFirst({
      where: { id: req.user.userId },
    });
    const bp = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: dbUser?.selectedPhoneNumberId },
    });
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
        let rawAttributes = typeof attributes === 'string' 
          ? JSON.parse(attributes) 
          : attributes;
        
        // Convert array format to object format if needed
        if (Array.isArray(rawAttributes)) {
          parsedAttributes = rawAttributes.reduce((obj, item) => {
            if (item && typeof item === 'object' && item.key && item.value !== undefined) {
              obj[item.key] = item.value;
            }
            return obj;
          }, {});
        } else {
          parsedAttributes = rawAttributes;
        }
         // await ProcessRulesForAttributes(existingContact.attributes, parsedAttributes, bp);
      } catch (error) {
        console.error("Error parsing attributes:", error);
        return res.status(400).json({ error: "Invalid attributes format" });
      }
    }

    // Check if attributes have changed
    const attributesChanged = hasAttributeChanges(existingContact.attributes, parsedAttributes);

    // Check if new attributes are added
    const existingKeys = Object.keys(existingContact.attributes || {});
    const newKeys = Object.keys(parsedAttributes || {});
    const newAttributesAdded = newKeys.some(key => !existingKeys.includes(key));

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

    // Check if attributes changed and trigger rules
    if (attributesChanged) {
      const phoneNumberId = await getUserPhoneNumberId(contactUserId);
      if (phoneNumberId) {
        if (newAttributesAdded) {
          // If new attributes are added, trigger attributeAdded rule
          await checkRulesForNodeAction(existingContact.phoneNumber, "attributeAdded", phoneNumberId, contactUserId);
        } else {
          // If only existing attributes are modified, trigger attributeChanged rule
          await checkRulesForNodeAction(existingContact.phoneNumber, "attributeChanged", phoneNumberId, contactUserId);
        }
      }
    }

    res.status(200).json(updatedContact);
  } catch (error) {
    console.error("Error updating contact:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
/** 📌 Delete a Contact */
export const deleteContact = async (req: Request, res: Response) => {
  const { id } = req.params;
  const contactId = parseInt(id);

  try {
    // Delete related Messages
    await prisma.message.deleteMany({
      where: { contactId },
    });

    // Delete related Notes
    await prisma.note.deleteMany({
      where: { contactId },
    });

    // Delete related BroadcastRecipient entries
    await prisma.broadcastRecipient.deleteMany({
      where: { contactId },
    });

    // Delete related ChatStatusHistory
    await prisma.chatStatusHistory.deleteMany({
      where: { contactId },
    });

    // Delete related Conversations
    await prisma.conversation.deleteMany({
      where: { contactId },
    });

    // Finally, delete the contact
    await prisma.contact.delete({
      where: { id: contactId },
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
    // Get the current user's ID
    const reqUser: any = req.user;
    const userId = reqUser?.userId;

    if (!userId) {
      return res.status(400).json({ error: "User not authenticated" });
    }

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
          // Check contact limit before processing
          const limitCheck = await checkContactLimit(userId, contacts.length);
          if (!limitCheck.allowed) {
            return res.status(403).json({ 
              error: "Contact limit exceeded",
              message: limitCheck.message,
              currentCount: limitCheck.currentCount,
              maxAllowed: limitCheck.maxAllowed,
              packageName: limitCheck.packageName,
              contactsInFile: contacts.length
            });
          }

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

    // Check if attributes have changed
    const attributesChanged = hasAttributeChanges(contact.attributes, updateData);

    // Check if new attributes are added
    const existingKeys = Object.keys(contact.attributes || {});
    const newKeys = Object.keys(updateData || {});
    const newAttributesAdded = newKeys.some(key => !existingKeys.includes(key));

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

    // Check if attributes changed and trigger rules
    if (attributesChanged) {
      const phoneNumberId = await getUserPhoneNumberId(userId);
      if (phoneNumberId) {
        if (newAttributesAdded) {
          // If new attributes are added, trigger attributeAdded rule
          await checkRulesForNodeAction(contact.phoneNumber, "attributeAdded", phoneNumberId, userId);
        } else {
          // If only existing attributes are modified, trigger attributeChanged rule
          await checkRulesForNodeAction(contact.phoneNumber, "attributeChanged", phoneNumberId, userId);
        }
      }
    }

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
      include: {
        changedBy: { select: { email: true } },
        assignedToUser: { select: { email: true } },
        assignedToTeam: { select: { name: true } },
      },
      orderBy: { changedAt: "desc" }, // Sort by latest status change
    });

    res.json(chatHistory);
  } catch (error) {
    console.error("Error fetching chat history:", error);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
};

export const updateChatStatusAndAssignment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { newStatus, assignedUser, assignedTeams = [] } = req.body;
  const user: any = req.user;

  const dbUser: any = await prisma.user.findFirst({
    where: { id: user.userId },
    select: { selectedPhoneNumberId: true, id: true, email: true },
  });

  try {
    // Check chat assignment access before proceeding
    const accessCheck = await checkChatAssignmentAccess(dbUser.id);
    if (!accessCheck.allowed) {
      return res.status(403).json({ 
        error: "Chat assignment access denied for your package",
        details: accessCheck
      });
    }

    const contact = await prisma.contact.findUnique({
      where: { id: parseInt(id) },
      include: { assignedTeams: true },
    });

    if (!contact) return res.status(404).json({ error: "Contact not found" });

    // 🔍 Look up assigned user ID from email
    let assignedUserId: number | null = null;
    if (assignedUser) {
      const userRecord = await prisma.user.findUnique({
        where: { email: assignedUser },
        select: { id: true }
      });
      if (!userRecord) return res.status(400).json({ error: `User ${assignedUser} not found.` });
      assignedUserId = userRecord.id;
    }

    // 🔍 Get team names from IDs
    let teamNames: string[] = [];
    if (assignedTeams.length > 0) {
      const teams = await prisma.team.findMany({
        where: { id: { in: assignedTeams } },
        select: { name: true }
      });
      teamNames = teams.map(team => team.name);
    }

    // 🔁 Only log statusChanged if status has actually changed
    const historyEntries: any[] = [];
    const statusChanged = contact.ticketStatus !== newStatus;

    if (statusChanged) {
      historyEntries.push({
        contactId: parseInt(id),
        previousStatus: contact.ticketStatus,
        newStatus,
        type: "statusChanged",
        changedById: dbUser.id,
        changedAt: new Date(),
        timerStartTime: newStatus === "Open" ? new Date() : contact.timerStartTime,
      });
    }

    // ✍️ Compose proper assignment note
    let assignmentNote = null;
    if (assignedUser && teamNames.length === 0) {
      assignmentNote = `Assigned to agent ${assignedUser}`;
    } else if (!assignedUser && teamNames.length > 0) {
      assignmentNote = `Assigned to Teams: ${teamNames.join(", ")}`;
    } else if (assignedUser && teamNames.length > 0) {
      // optional: if you want to handle both together
      assignmentNote = `Assigned to agent ${assignedUser} and Teams: ${teamNames.join(", ")}`;
    }

    if (assignmentNote) {
      historyEntries.push({
        contactId: parseInt(id),
        newStatus: "Assigned",
        type: "assignmentChanged",
        changedById: dbUser.id,
        note: assignmentNote,
        assignedToUserId: assignedUserId ?? undefined,
        changedAt: new Date(),
      });
    }
    const updateData: any = {
      ticketStatus: newStatus,
      userId: assignedUserId ?? contact.userId,
    };
    
    if (req.body.hasOwnProperty('assignedTeams')) {
      updateData.assignedTeams = {
        set: assignedTeams.map((teamId: number) => ({ id: teamId })),
      };
    }
    
    await prisma.contact.update({
      where: { id: parseInt(id) },
      data: updateData,
    });
    

    const saved = await Promise.all(
      historyEntries.map((entry) => prisma.chatStatusHistory.create({ data: entry }))
    );

    const io = req.app.get("socketio");
    io.emit("chatStatusUpdated", {
      contactId: parseInt(id),
      chatStatus: newStatus,
      changedBy: user?.email || "System",
      changedAt: new Date(),
    });

    res.json({ 
      success: true, 
      saved,
      packageInfo: {
        packageName: accessCheck.packageName,
        message: "Chat assignment completed successfully"
      }
    });
  } catch (error) {
    console.error("Error updating chat status:", error);
    res.status(500).json({ error: "Failed to update chat status" });
  }
};

// GET /contacts/:id/status
export const getContactStatus = async (req: Request, res: Response) => {
  try {
    const contactId = parseInt(req.params.id);

    if (isNaN(contactId)) {
      return res.status(400).json({ message: "Invalid contact ID" });
    }

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { ticketStatus: true },
    });

    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }

    res.json({ status: contact.ticketStatus || "Open" });
  } catch (error) {
    console.error("Error fetching contact status:", error);
    res.status(500).json({ message: "Internal server error" });
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

export const getCurrentAssignments = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const contact = await prisma.contact.findUnique({
      where: { id: parseInt(id) },
      include: {
        user: { select: { email: true } },
        assignedTeams: {  select: {
          id: true, // ✅ fixed here
        },},
      },
    });

    if (!contact) return res.status(404).json({ error: "Contact not found" });

    return res.json({
      assignedUser: contact.user?.email ?? null,
      assignedTeams: contact.assignedTeams.map(team => team.id),
    });
  } catch (error) {
    console.error("Error fetching assignments:", error);
    return res.status(500).json({ error: "Failed to get assignments" });
  }
};


export const sendMessageController = async (req: Request, res: Response) => {
  try {
    const user:any=req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    });

    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }
    if (!dbUser.selectedPhoneNumberId) {
      return res.status(400).json({ error: "User does not have a selected Phone Number ID" });
    }
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
     // await sendTemplate(contact.phoneNumber, template, chatbotId, templateDetails,dbUser.selectedPhoneNumberId);
      const broadcastResult = await broadcastTemplate(contact.phoneNumber, template, chatbotId, templateDetails,dbUser.selectedPhoneNumberId);
      
      // Check if broadcast was successful
      if (broadcastResult && broadcastResult.success === false) {
        return res.status(400).json({
          success: false,
          message: broadcastResult.message || "Failed to send template message",
          error: broadcastResult.error
        });
      }
      
      savedMessage = {
        success: true,
        message: "Template message sent successfully",
        templateId: templateId,
        templateDetails: templateDetails
      };  
      await storeMessage({
        recipient: contact.phoneNumber,
        chatbotId,
        messageType: "template",
        text: `Template: sent`,
        templateDetails: templateDetails
      }, dbUser.selectedPhoneNumberId);
    }
    // ✅ Handle Regular Messages (Text, Media)
    else {
      let messageType = "text";
      let messageContent: any = { message: text };
      if (text && text.startsWith("TriggerChatbot:"))
        {
          await handleChatbotTrigger(text,contact.phoneNumber,dbUser.selectedPhoneNumberId);}
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
        user.userId,
        false,
        dbUser.selectedPhoneNumberId
      );
    }


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

// types.ts
type TriggerResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export const triggerChatbotByPhoneNumber = async (req: Request, res: Response) => {
  try {
    const dbUser:any=req.user;
       const userRecord = await prisma.user.findUnique({
      where: { id: dbUser.userId },
      select: { 
        selectedPhoneNumberId: true,
        selectedWabaId: true
      }
    });
    if (!userRecord || !userRecord.selectedPhoneNumberId || !userRecord.selectedWabaId) {
      throw new Error("User's selected contact details are not set.");
    }
    const phoneNumber = req.params.phoneNumber;
    const { text } = req.body;

    if (!text || !text.startsWith("TriggerChatbot:")) {
      return res.status(400).json({ error: "Invalid or missing TriggerChatbot text" });
    }
    const result: TriggerResult =await handleChatbotTrigger(text, phoneNumber, userRecord.selectedPhoneNumberId);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.message });
    }
    return res.json({ success: true, message: "Chatbot triggered successfully" });
  } catch (error) {
    return res.status(result.status).json({ error: result.message });
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

    // Get the current user's ID
    const reqUser: any = req.user;
    const userId = reqUser?.userId;

    if (!userId) {
      return res.status(400).json({ error: "User not authenticated" });
    }

    // Check contact limit before processing
    const limitCheck = await checkContactLimit(userId, records.length);
    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: "Contact limit exceeded",
        message: limitCheck.message,
        currentCount: limitCheck.currentCount,
        maxAllowed: limitCheck.maxAllowed,
        packageName: limitCheck.packageName,
        recordsInFile: records.length
      });
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

    if (!defaultUserId) {
      return res.status(400).json({ error: "User not authenticated" });
    }

    // Read the stored records from temp file
    const rawData = fs.readFileSync(tempFilePath, 'utf8');
    const records = JSON.parse(rawData);

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "No valid records found" });
    }

    // Count how many new contacts will be created (excluding updates)
    let newContactsCount = 0;
    for (const record of records) {
      const contactData: any = {};
      
      // Map fields according to user's selection
      Object.entries(mappedColumns).forEach(([targetField, sourceField]) => {
        if (sourceField && record[sourceField] !== undefined) {
          if (targetField === 'phoneNumber') {
            contactData[targetField] = record[sourceField];
          }
        }
      });

      // Check if contact already exists
      if (contactData.phoneNumber) {
        const existingContact = await prisma.contact.findFirst({
          where: { phoneNumber: contactData.phoneNumber }
        });
        
        if (!existingContact) {
          newContactsCount++;
        }
      }
    }

    // Check contact limit for new contacts
    const limitCheck = await checkContactLimit(defaultUserId, newContactsCount);
    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: "Contact limit exceeded",
        message: limitCheck.message,
        currentCount: limitCheck.currentCount,
        maxAllowed: limitCheck.maxAllowed,
        packageName: limitCheck.packageName,
        newContactsToCreate: newContactsCount
      });
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
                  sendSMS: contactData.sendSMS !== undefined ? contactData.sendSMS : existingContact.sendSMS,
                  createdById: reqUser.userId
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
                sendSMS: contactData.sendSMS !== undefined ? contactData.sendSMS : false,
                createdById: reqUser.userId
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

export const getFilteredAttributesByKeyword = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const keyword = (req.query.keyword as string || '').toLowerCase();
    if (!keyword) {
      return res.status(400).json({ error: 'Keyword query parameter is required' });
    }
    // Find all contacts created by this user
    const contacts = await prisma.contact.findMany({
      where: { createdById: user.userId },
      select: { attributes: true },
    });
    // Collect all attribute keys
    const allKeys = contacts.flatMap(contact =>
      contact.attributes && typeof contact.attributes === 'object'
        ? Object.keys(contact.attributes)
        : []
    );
    // Filter and deduplicate keys
    const filteredKeys = Array.from(new Set(
      allKeys.filter(key => key.toLowerCase().includes(keyword))
    ));
    res.json(filteredKeys);
  } catch (error) {
    console.error('Error fetching filtered attributes:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getAttributeOptionsForUser = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const attribute = req.query.attribute as string;
    if (!attribute) {
      return res.status(400).json({ error: 'Attribute query parameter is required' });
    }
    // Find all contacts created by this user
    const contacts = await prisma.contact.findMany({
      where: { createdById: user.userId },
      select: { attributes: true },
    });
    // Collect all values for the exact attribute key
    const values = contacts.flatMap(contact => {
      if (contact.attributes && typeof contact.attributes === 'object' && attribute in contact.attributes) {
        return [contact.attributes[attribute]];
      }
      return [];
    });
    // Filter and deduplicate values
    const uniqueValues = Array.from(new Set(values));
    res.json(uniqueValues);
  } catch (error) {
    console.error('Error fetching attribute options:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getCountriesByPhoneNumber = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const keyword = (req.query.keyword as string || '').toLowerCase();
    if (!keyword) {
      return res.json([]);
    }
    // Find all contacts created by this user
    const contacts = await prisma.contact.findMany({
      where: { createdById: user.userId },
      select: { phoneNumber: true },
    });
    // Use a Set to collect unique country names
    const countrySet = new Set<string>();
    for (const contact of contacts) {
      if (contact.phoneNumber) {
        let phone = contact.phoneNumber;
        if (!phone.startsWith('+')) {
          phone = '+' + phone;
        }
        try {
          const phoneNumber = parsePhoneNumberFromString(phone);
          if (phoneNumber && phoneNumber.country) {
            const countryCode = phoneNumber.country;
            const countryName = countryCodeToName[countryCode];
            if (countryName && countryName.toLowerCase().includes(keyword)) {
              countrySet.add(countryName);
            }
          }
        } catch (e) {
          // Ignore invalid phone numbers
        }
      }
    }
    res.json(Array.from(countrySet));
  } catch (error) {
    console.error('Error fetching countries by phone number:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * GET /contacts/analytics
 * Query params: chatbot, timeRange, countries, attributes, page, limit
 * Returns: { contacts: [...], total, page, limit }
 */
export const getContactsAnalytics = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const chatbotId = req.query.chatbot;
    const timeRange = req.query.timeRange as string;
    // Accept country names and convert to codes
    let countries: string[] = [];
    if (req.query.countries) {
      countries = (req.query.countries as string)
        .split(',')
        .map(c => c.trim().toLowerCase())
        .map(nameOrCode => countryNameToCode[nameOrCode] || nameOrCode.toUpperCase());
    }
    console.log('Processed countries array:', countries);
    console.log('countryNameToCode[bangladesh]:', countryNameToCode['bangladesh']);
    const attributes = req.query.attributes ? JSON.parse(req.query.attributes as string) : undefined;
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    if (!chatbotId || !timeRange) {
      return res.status(400).json({ error: 'chatbot and timeRange are required' });
    }

    // 1. Determine allowed userIds (created by user or their agents)
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { id: true, agent: true, createdById: true },
    });
    let userIdsToInclude: number[] = [];
    if (dbUser.agent) {
      const agents = await prisma.user.findMany({
        where: { createdById: dbUser.createdById || undefined, agent: true },
        select: { id: true },
      });
      userIdsToInclude = [
        ...agents.map(a => a.id),
        dbUser.createdById!,
        dbUser.id,
      ];
    } else {
      const agents = await prisma.user.findMany({
        where: { createdById: dbUser.id, agent: true },
        select: { id: true },
      });
      userIdsToInclude = [dbUser.id, ...agents.map(a => a.id)];
    }

    // 2. Time range filter
    let fromDate: Date;
    const now = new Date();
    if (timeRange === 'Last 7 days') {
      fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'Last 30 days') {
      fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'Last 6 months') {
      fromDate = new Date(now.getTime() - 183 * 24 * 60 * 60 * 1000);
    } else {
      return res.status(400).json({ error: 'Invalid timeRange' });
    }

    // 3. Find conversations for chatbotId, in time range, with allowed contacts
    const conversations = await prisma.conversation.findMany({
      where: {
        chatbotId: Number(chatbotId),
        createdAt: { gte: fromDate },
        OR: [
          { contact: { createdById: { in: userIdsToInclude } } },
          { contactId: null }, // allow recipient fallback
        ],
      },
      select: { contactId: true, recipient: true },
    });
    if (conversations.length === 0) {
      return res.json({ contacts: [], total: 0, page, limit });
    }

    // 4. Resolve contacts: by contactId or by recipient (phoneNumber)
    const contactIdSet = new Set<number>();
    const recipientPhones: Set<string> = new Set();
    for (const conv of conversations) {
      if (conv.contactId) {
        contactIdSet.add(conv.contactId);
      } else if (conv.recipient) {
        recipientPhones.add(conv.recipient);
      }
    }
    // Fetch contacts by contactId
    let contactsById = [];
    if (contactIdSet.size > 0) {
      contactsById = await prisma.contact.findMany({
        where: { id: { in: Array.from(contactIdSet) } },
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          subscribed: true,
          sendSMS: true,
          source: true,
          attributes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }
    // Fetch contacts by phoneNumber (recipient)
    let contactsByPhone = [];
    if (recipientPhones.size > 0) {
      contactsByPhone = await prisma.contact.findMany({
        where: { phoneNumber: { in: Array.from(recipientPhones) } },
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          subscribed: true,
          sendSMS: true,
          source: true,
          attributes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }
    // Merge and deduplicate contacts
    const allContactsMap = new Map<string, any>();
    for (const c of [...contactsById, ...contactsByPhone]) {
      allContactsMap.set(String(c.id), c);
    }
    let contacts = Array.from(allContactsMap.values());

    // 5. Filter by country code if provided
    if (countries.length > 0) {
      contacts = contacts.filter(contact => {
        if (!contact.phoneNumber) return false;
        let phone = contact.phoneNumber;
        if (!phone.startsWith('+')) phone = '+' + phone;
        try {
          const phoneNumber = parsePhoneNumberFromString(phone);
          if (phoneNumber && phoneNumber.country) {
            return countries.includes(phoneNumber.country);
          }
        } catch {}
        return false;
      });
    }

    // 6. Filter by attributes (all key-value pairs must match)
    if (attributes && Object.keys(attributes).length > 0) {
      contacts = contacts.filter(contact => {
        const attr = contact.attributes || {};
        return Object.entries(attributes).every(([key, values]) => {
          if (!Array.isArray(values)) return false;
          return values.includes(attr[key]);
        });
      });
    }

    // 7. Pagination
    const total = contacts.length;
    const pagedContacts = contacts.slice((page - 1) * limit, page * limit);

    // 8. Format response
    const formatted = pagedContacts.map(contact => {
      let countryCode = undefined;
      if (contact.phoneNumber) {
        let phone = contact.phoneNumber;
        if (!phone.startsWith('+')) phone = '+' + phone;
        try {
          const phoneNumber = parsePhoneNumberFromString(phone);
          if (phoneNumber && phoneNumber.country) {
            countryCode = phoneNumber.country;
          }
        } catch {}
      }
      return {
        id: String(contact.id),
        name: contact.name,
        phoneNumber: contact.phoneNumber,
        countryCode,
        subscribed: contact.subscribed,
        sendSMS: contact.sendSMS,
        source: contact.source,
        attributes: Array.isArray(contact.attributes)
          ? contact.attributes
          : Object.entries(contact.attributes || {}).map(([key, value]) => ({ key, value })),
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      };
    });

    res.json({
      contacts: formatted,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Error in getContactsAnalytics:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Static map for country code to country name
const countryCodeToName: Record<string, string> = {
  AF: 'Afghanistan', AL: 'Albania', DZ: 'Algeria', AS: 'American Samoa', AD: 'Andorra', AO: 'Angola', AI: 'Anguilla', AQ: 'Antarctica', AG: 'Antigua and Barbuda', AR: 'Argentina', AM: 'Armenia', AW: 'Aruba', AU: 'Australia', AT: 'Austria', AZ: 'Azerbaijan', BS: 'Bahamas', BH: 'Bahrain', BD: 'Bangladesh', BB: 'Barbados', BY: 'Belarus', BE: 'Belgium', BZ: 'Belize', BJ: 'Benin', BM: 'Bermuda', BT: 'Bhutan', BO: 'Bolivia', BA: 'Bosnia and Herzegovina', BW: 'Botswana', BR: 'Brazil', IO: 'British Indian Ocean Territory', VG: 'British Virgin Islands', BN: 'Brunei', BG: 'Bulgaria', BF: 'Burkina Faso', BI: 'Burundi', KH: 'Cambodia', CM: 'Cameroon', CA: 'Canada', CV: 'Cape Verde', KY: 'Cayman Islands', CF: 'Central African Republic', TD: 'Chad', CL: 'Chile', CN: 'China', CX: 'Christmas Island', CC: 'Cocos Islands', CO: 'Colombia', KM: 'Comoros', CK: 'Cook Islands', CR: 'Costa Rica', HR: 'Croatia', CU: 'Cuba', CW: 'Curacao', CY: 'Cyprus', CZ: 'Czech Republic', CD: 'Democratic Republic of the Congo', DK: 'Denmark', DJ: 'Djibouti', DM: 'Dominica', DO: 'Dominican Republic', TL: 'East Timor', EC: 'Ecuador', EG: 'Egypt', SV: 'El Salvador', GQ: 'Equatorial Guinea', ER: 'Eritrea', EE: 'Estonia', ET: 'Ethiopia', FK: 'Falkland Islands', FO: 'Faroe Islands', FJ: 'Fiji', FI: 'Finland', FR: 'France', PF: 'French Polynesia', GA: 'Gabon', GM: 'Gambia', GE: 'Georgia', DE: 'Germany', GH: 'Ghana', GI: 'Gibraltar', GR: 'Greece', GL: 'Greenland', GD: 'Grenada', GU: 'Guam', GT: 'Guatemala', GG: 'Guernsey', GN: 'Guinea', GW: 'Guinea-Bissau', GY: 'Guyana', HT: 'Haiti', HN: 'Honduras', HK: 'Hong Kong', HU: 'Hungary', IS: 'Iceland', IN: 'India', ID: 'Indonesia', IR: 'Iran', IQ: 'Iraq', IE: 'Ireland', IM: 'Isle of Man', IL: 'Israel', IT: 'Italy', CI: 'Ivory Coast', JM: 'Jamaica', JP: 'Japan', JE: 'Jersey', JO: 'Jordan', KZ: 'Kazakhstan', KE: 'Kenya', KI: 'Kiribati', XK: 'Kosovo', KW: 'Kuwait', KG: 'Kyrgyzstan', LA: 'Laos', LV: 'Latvia', LB: 'Lebanon', LS: 'Lesotho', LR: 'Liberia', LY: 'Libya', LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg', MO: 'Macau', MK: 'Macedonia', MG: 'Madagascar', MW: 'Malawi', MY: 'Malaysia', MV: 'Maldives', ML: 'Mali', MT: 'Malta', MH: 'Marshall Islands', MR: 'Mauritania', MU: 'Mauritius', YT: 'Mayotte', MX: 'Mexico', FM: 'Micronesia', MD: 'Moldova', MC: 'Monaco', MN: 'Mongolia', ME: 'Montenegro', MS: 'Montserrat', MA: 'Morocco', MZ: 'Mozambique', MM: 'Myanmar', NA: 'Namibia', NR: 'Nauru', NP: 'Nepal', NL: 'Netherlands', AN: 'Netherlands Antilles', NC: 'New Caledonia', NZ: 'New Zealand', NI: 'Nicaragua', NE: 'Niger', NG: 'Nigeria', NU: 'Niue', KP: 'North Korea', MP: 'Northern Mariana Islands', NO: 'Norway', OM: 'Oman', PK: 'Pakistan', PW: 'Palau', PS: 'Palestine', PA: 'Panama', PG: 'Papua New Guinea', PY: 'Paraguay', PE: 'Peru', PH: 'Philippines', PN: 'Pitcairn', PL: 'Poland', PT: 'Portugal', PR: 'Puerto Rico', QA: 'Qatar', CG: 'Republic of the Congo', RE: 'Reunion', RO: 'Romania', RU: 'Russia', RW: 'Rwanda', BL: 'Saint Barthelemy', SH: 'Saint Helena', KN: 'Saint Kitts and Nevis', LC: 'Saint Lucia', MF: 'Saint Martin', PM: 'Saint Pierre and Miquelon', VC: 'Saint Vincent and the Grenadines', WS: 'Samoa', SM: 'San Marino', ST: 'Sao Tome and Principe', SA: 'Saudi Arabia', SN: 'Senegal', RS: 'Serbia', SC: 'Seychelles', SL: 'Sierra Leone', SG: 'Singapore', SX: 'Sint Maarten', SK: 'Slovakia', SI: 'Slovenia', SB: 'Solomon Islands', SO: 'Somalia', ZA: 'South Africa', KR: 'South Korea', SS: 'South Sudan', ES: 'Spain', LK: 'Sri Lanka', SD: 'Sudan', SR: 'Suriname', SJ: 'Svalbard and Jan Mayen', SZ: 'Swaziland', SE: 'Sweden', CH: 'Switzerland', SY: 'Syria', TW: 'Taiwan', TJ: 'Tajikistan', TZ: 'Tanzania', TH: 'Thailand', TG: 'Togo', TK: 'Tokelau', TO: 'Tonga', TT: 'Trinidad and Tobago', TN: 'Tunisia', TR: 'Turkey', TM: 'Turkmenistan', TC: 'Turks and Caicos Islands', TV: 'Tuvalu', UG: 'Uganda', UA: 'Ukraine', AE: 'United Arab Emirates', GB: 'United Kingdom', US: 'United States', UY: 'Uruguay', UZ: 'Uzbekistan', VU: 'Vanuatu', VA: 'Vatican', VE: 'Venezuela', VN: 'Vietnam', VI: 'Virgin Islands', YE: 'Yemen', ZM: 'Zambia', ZW: 'Zimbabwe'
};
// Reverse map: country name (lowercase) to code
const countryNameToCode: Record<string, string> = Object.fromEntries(
  Object.entries(countryCodeToName).map(([code, name]) => [name.toLowerCase(), code])
);

/**
 * GET /analytics/users
 * Query params: chatbot, timeRange
 * Returns: { existingUsers, newUsers, otherUsers, totalUsers }
 */
export const getUsersAnalytics = async (req, res) => {
  try {
    const user: any = req.user;
    const chatbotId = req.query.chatbot;
    const timeRange = req.query.timeRange;
    if (!chatbotId || !timeRange) {
      return res.status(400).json({ error: 'chatbot and timeRange are required' });
    }

    // 1. Determine allowed userIds (created by user or their agents)
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { id: true, agent: true, createdById: true },
    });
    let userIdsToInclude = [];
    if (dbUser.agent) {
      const agents = await prisma.user.findMany({
        where: { createdById: dbUser.createdById || undefined, agent: true },
        select: { id: true },
      });
      userIdsToInclude = [
        ...agents.map(a => a.id),
        dbUser.createdById,
        dbUser.id,
      ];
    } else {
      const agents = await prisma.user.findMany({
        where: { createdById: dbUser.id, agent: true },
        select: { id: true },
      });
      userIdsToInclude = [dbUser.id, ...agents.map(a => a.id)];
    }

    // 2. Time range filter
    let fromDate;
    const now = new Date();
    if (timeRange === 'Last 7 days') {
      fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'Last 30 days') {
      fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'Last 6 months') {
      fromDate = new Date(now.getTime() - 183 * 24 * 60 * 60 * 1000);
    } else {
      return res.status(400).json({ error: 'Invalid timeRange' });
    }

    // 3. Find all conversations for this chatbot, accessible contacts
    const conversations = await prisma.conversation.findMany({
      where: {
        chatbotId: Number(chatbotId),
        OR: [
          { contact: { createdById: { in: userIdsToInclude } } },
          { contactId: null },
        ],
      },
      select: { contactId: true, recipient: true, createdAt: true },
    });
    // 4. Resolve contacts: by contactId or by recipient (phoneNumber)
    const contactIdSet = new Set();
    const recipientPhones = new Set();
    for (const conv of conversations) {
      if (conv.contactId) {
        contactIdSet.add(conv.contactId);
      } else if (conv.recipient) {
        recipientPhones.add(conv.recipient);
      }
    }
    // Fetch contacts by contactId
    let contactsById = [];
    if (contactIdSet.size > 0) {
      contactsById = await prisma.contact.findMany({
        where: { id: { in: Array.from(contactIdSet) } },
        select: { id: true, phoneNumber: true },
      });
    }
    // Fetch contacts by phoneNumber (recipient)
    let contactsByPhone = [];
    if (recipientPhones.size > 0) {
      contactsByPhone = await prisma.contact.findMany({
        where: { phoneNumber: { in: Array.from(recipientPhones) } },
        select: { id: true, phoneNumber: true },
      });
    }
    // Map phoneNumber to contactId for quick lookup
    const phoneToContactId = new Map();
    for (const c of [...contactsById, ...contactsByPhone]) {
      if (c.phoneNumber) phoneToContactId.set(c.phoneNumber, c.id);
    }
    // Build a map: contactId -> all conversation dates
    const contactConvoDates = {};
    for (const conv of conversations) {
      let cid = conv.contactId;
      if (!cid && conv.recipient) {
        cid = phoneToContactId.get(conv.recipient);
      }
      if (cid) {
        if (!contactConvoDates[cid]) contactConvoDates[cid] = [];
        contactConvoDates[cid].push(conv.createdAt);
      }
    }
    // 5. Get business account ID for the current chatbot
    const chatbot = await prisma.chatbot.findUnique({
      where: { id: Number(chatbotId) },
      select: { ownerId: true },
    });
    
    if (!chatbot) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }
    
    const businessAccount = await prisma.businessAccount.findFirst({
      where: { userId: chatbot.ownerId },
      select: { id: true },
    });
    
    if (!businessAccount) {
      return res.status(404).json({ error: 'Business account not found' });
    }
    
    const businessAccountId = businessAccount.id;
    
    // 6. Get all phone numbers for this business account
    const businessPhoneNumbers = await prisma.businessPhoneNumber.findMany({
      where: { businessAccountId },
      select: { id: true },
    });
    
    const businessPhoneNumberIds = businessPhoneNumbers.map(bp => bp.id);
    
    // 7. Classify users
    let newUsers = 0, existingUsers = 0;
    
    for (const [contactId, convoDates] of Object.entries(contactConvoDates)) {
      // Sort dates ascending
      convoDates.sort((a, b) => a.getTime() - b.getTime());
      const hasInRange = convoDates.some(d => d >= fromDate);
      
             if (hasInRange) {
         // Check if this contact has communicated with other chatbots under the same business account within the current time range
         const otherConversations = await prisma.conversation.findMany({
           where: {
             AND: [
               { businessPhoneNumberId: { in: businessPhoneNumberIds } },
               {
                 OR: [
                   { createdAt: { gte: fromDate } },
                   { updatedAt: { gte: fromDate } }
                 ]
               },
               {
                 OR: [
                   { contactId: parseInt(contactId) },
                   { recipient: { in: contactsById.filter(c => c.id === parseInt(contactId)).map(c => c.phoneNumber).filter(Boolean) } }
                 ]
               }
             ]
           },
           select: { createdAt: true },
         });
         
         // Check if this contact has communicated with other chatbots before the current time range
         const previousConversations = await prisma.conversation.findMany({
           where: {
             AND: [
               { businessPhoneNumberId: { in: businessPhoneNumberIds } },
               { chatbotId: { not: Number(chatbotId) } },
               {
                OR: [
                  { createdAt: { gte: fromDate } },
                  { updatedAt: { gte: fromDate } }
                ]
              },
               {
                 OR: [
                   { contactId: parseInt(contactId) },
                   { recipient: { in: contactsById.filter(c => c.id === parseInt(contactId)).map(c => c.phoneNumber).filter(Boolean) } }
                 ]
               }
             ]
           },
           select: { createdAt: true },
         });
         
         // If they have communicated with other chatbots before the time range, they are existing users
         if (previousConversations.length > 0) {
           existingUsers++;
         } else {
           newUsers++;
         }
       }
    }
    const totalUsers = Object.keys(contactConvoDates).length;
    
    // Convert to percentages
    const existingUsersPercentage = totalUsers > 0 ? Math.round((existingUsers / totalUsers) * 100) : 0;
    const newUsersPercentage = totalUsers > 0 ? Math.round((newUsers / totalUsers) * 100) : 0;
    
    res.json({ 
      existingUsers: existingUsersPercentage, 
      newUsers: newUsersPercentage, 
      totalUsers 
    });
  } catch (error) {
    console.error('Error in getUsersAnalytics:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const toggleContactFavorite = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user: any = req.user;

    // Check if contact exists and user has access
    const contact = await prisma.contact.findFirst({
      where: { id: parseInt(id) },
      select: { id: true, favorite: true },
    });

    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    // Toggle the favorite status
    const updatedContact = await prisma.contact.update({
      where: { id: parseInt(id) },
      data: { favorite: !contact.favorite },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        attributes: true,
        subscribed: true,
        sendSMS: true,
        ticketStatus: true,
        favorite: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Format attributes
    const formattedContact = {
      ...updatedContact,
      attributes: Array.isArray(updatedContact.attributes)
        ? updatedContact.attributes
        : Object.entries(updatedContact.attributes || {}).map(([key, value]) => ({
            key,
            value,
          })),
    };

    res.json(formattedContact);
  } catch (error) {
    console.error('Error in toggleContactFavorite:', error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};