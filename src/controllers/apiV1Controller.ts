import {  Request, Response } from "express";

import { s3 } from "../config/s3Config";
import { handleChatbotTrigger } from "../subProcessors/metaWebhook";
import { sendMessage, sendTemplate } from "../processors/metaWebhook/webhookProcessor";
import { brodcastTemplate } from "../processors/template/templateProcessor";
import { broadcastTemplate } from "./templateController";
import { notifyAgent } from "../helpers";
import { prisma } from "../models/prismaClient";
import { razorpayService } from '../services/razorpay.service';
import { validatePackagePricing } from '../utils/packageUtils';

// Helper to parse date as UTC if no timezone is present
function parseAsUTC(dateStr: string): Date {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(dateStr)) return new Date(dateStr);
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

// GET /:phoneNumberId/api/v1/getMessages/:whatsappNumber
export const getMessages = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId, whatsappNumber } = req.params;
    const { pageSize = 20, pageNumber = 1, from, to } = req.query;
    const user: any = req.user;

    // Validate input
    if (!phoneNumberId || !whatsappNumber) {
      return res.status(400).json({ message: "phoneNumberId and whatsappNumber are required" });
    }

    // Step 1: Find businessPhoneNumberId from phoneNumberId (metaPhoneNumberId)
    const businessPhone = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: phoneNumberId },
      select: { id: true },
    });
    if (!businessPhone) {
      return res.status(404).json({ message: "Business phone number not found" });
    }
    const businessPhoneNumberId = businessPhone.id;

    // Step 2: Find contact by whatsappNumber
    const contact = await prisma.contact.findFirst({
      where: { phoneNumber: whatsappNumber as string },
    });
    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }

    // Check if the contact has a conversation with the businessPhoneNumberId
    const conversation = await prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        businessPhoneNumberId,
      },
    });
    if (!conversation) {
      return res.status(404).json({ message: "There is no conversation between this contact and this business phone number yet" });
    }

    // Step 3: Find all conversation IDs matching contactId and businessPhoneNumberId
    const conversations = await prisma.conversation.findMany({
      where: { contactId: contact.id, businessPhoneNumberId },
      select: { id: true },
    });
    const conversationIds = conversations.map((c) => c.id);
    if (conversationIds.length === 0) {
      return res.status(200).json({ messages: [], total: 0, pageNumber, pageSize, totalPages: 0 });
    }

    // Step 4: Build message query with date filter
    let messageWhere: any = { conversationId: { in: conversationIds } };
    const hasFrom = typeof from === 'string' && from.trim() !== '';
    const hasTo = typeof to === 'string' && to.trim() !== '';
    console.log({ from, to, hasFrom, hasTo });
    if (hasFrom || hasTo) {
      messageWhere.time = {};
      if (hasFrom) messageWhere.time.gte = parseAsUTC(from as string);
      if (hasTo) messageWhere.time.lte = parseAsUTC(to as string);
    }
    console.log('messageWhere:', messageWhere);

    // Step 5: Pagination
    const size = parseInt(pageSize as string, 10);
    const page = parseInt(pageNumber as string, 10);
    const skip = (page - 1) * size;

    // Step 6: Fetch messages and total count
    const [messages, total] = await prisma.$transaction([
      prisma.message.findMany({
        where: messageWhere,
        orderBy: { time: "asc" },
        skip,
        take: size,
        select: {
          text: true,
          time: true,
          links: true,
          attachment: true,
          subMessages: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          messageType: true,
        },
      }),
      prisma.message.count({ where: messageWhere }),
    ]);

    res.status(200).json({
      messages,
      total,
      pageNumber: page,
      pageSize: size,
      totalPages: Math.ceil(total / size),
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ message: "Error retrieving messages" });
  }
};

// GET /:phoneNumberId/api/v1/getMessageTemplates

export const getMessageTemplates = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { pageSize = 20, pageNumber = 1 } = req.query;
    const user: any = req.user;

    // Find user and selectedWabaId (if needed)
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { selectedWabaId: true },
    });
    const selectedWabaId = dbUser?.selectedWabaId;

    // Pagination
    const size = parseInt(pageSize as string, 10);
    const page = parseInt(pageNumber as string, 10);
    const skip = (page - 1) * size;

    // Fetch templates and total count
    const [templates, total] = await prisma.$transaction([
      prisma.template.findMany({
        where: { userId: user.userId, wabaId: selectedWabaId },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: size,
      }),
      prisma.template.count({ where: { userId: user.userId, wabaId: selectedWabaId } }),
    ]);

    // Format templates
    const formattedTemplates = templates.map((tmpl: any) => {
      let parsedContent = {};
      try {
        parsedContent = JSON.parse(tmpl.content);
      } catch (e) {
        parsedContent = {
          name: tmpl.name,
          parameter_format: "POSITIONAL",
          components: [],
          language: tmpl.language,
          status: tmpl.status,
          category: tmpl.category,
          id: tmpl.id.toString(),
          lastUpdated: tmpl.updatedAt.toISOString().split("T")[0],
        };
      }
      return {
        ...parsedContent,
        name: tmpl.name,
        language: tmpl.language,
        status: tmpl.status,
        category: tmpl.category,
        id: tmpl.id.toString(),
        lastUpdated: tmpl.updatedAt.toISOString().split("T")[0],
      };
    });

    res.status(200).json({
      data: formattedTemplates,
      total,
      pageNumber: page,
      pageSize: size,
      totalPages: Math.ceil(total / size),
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to fetch templates",
      details: error.response?.data || error.message,
    });
  }
};

// GET /:phoneNumberId/api/v1/getContacts

export const getContacts = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { pageSize = 20, pageNumber = 1, name, attribute, createdDate } = req.query;
    const user: any = req.user;

    // Find user and agent/creator info
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { id: true, agent: true, createdById: true },
    });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    let userIdsToInclude: number[] = [];
    if (dbUser.agent) {
      const agents = await prisma.user.findMany({
        where: { createdById: dbUser.createdById || undefined, agent: true },
        select: { id: true },
      });
      userIdsToInclude = [...agents.map((a) => a.id), dbUser.createdById!, dbUser.id];
    } else {
      const agents = await prisma.user.findMany({
        where: { createdById: dbUser.id, agent: true },
        select: { id: true },
      });
      userIdsToInclude = [dbUser.id, ...agents.map((a) => a.id)];
    }

    // Build where filter
    let where: any = {
      createdById: { in: userIdsToInclude },
    };
    if (typeof name === 'string' && name.trim() !== '') {
      where.name = { contains: name, mode: 'insensitive' };
    }
    if (typeof createdDate === 'string' && createdDate.trim() !== '') {
      // Accept YYYY-MM-DD or MM-DD-YYYY
      const date = new Date(createdDate as string);
      if (!isNaN(date.getTime())) {
        // Filter for contacts created on this date (ignoring time)
        const nextDay = new Date(date);
        nextDay.setDate(date.getDate() + 1);
        where.createdAt = { gte: date, lt: nextDay };
      }
    }
    if (typeof attribute === 'string' && attribute.trim() !== '') {
      try {
        const attrFilters = JSON.parse(attribute as string);
        // Only support 'contain' operator for now (can be extended)
        if (Array.isArray(attrFilters)) {
          for (const filter of attrFilters) {
            if (filter.operator === 'contain' && filter.name && filter.value) {
              where[`attributes`]= {
                path: [filter.name],
                string_contains: filter.value
              };
            }
            // Add more operators as needed
          }
        }
      } catch (e) {
        // Ignore attribute filter if invalid JSON
      }
    }

    // Pagination
    const size = parseInt(pageSize as string, 10);
    const page = parseInt(pageNumber as string, 10);
    const skip = (page - 1) * size;

    // Fetch contacts and total count
    const [contacts, total] = await prisma.$transaction([
      prisma.contact.findMany({
        where,
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          attributes: true,
          subscribed: true,
          sendSMS: true,
          ticketStatus: true,
          createdAt: true,
          updatedAt: true,
        },
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contact.count({ where }),
    ]);

    // Format attributes into array of {key, value} objects
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
      data: formattedContacts,
      total,
      pageNumber: page,
      pageSize: size,
      totalPages: Math.ceil(total / size),
    });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// GET /:tenantId/api/v1/getMedia
export const getMedia = async (req: Request, res: Response) => {
  const fileName = req.query.fileName as string;
  const phoneNumberId = req.params.phoneNumberId as string;

  if (!fileName) {
    return res.status(400).json({ message: "fileName query parameter is required" });
  }

  if (!phoneNumberId) {
    return res.status(400).json({ message: "phoneNumberId is required" });
  }

  try {
    // Find the user with the given selectedPhoneNumberId
    const user = await prisma.user.findFirst({
      where: {
        selectedPhoneNumberId: phoneNumberId,
        agent: false,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found for the given phoneNumberId" });
    }

    // Check if the media exists in the database for this user
    const mediaRecord = await prisma.media.findFirst({
      where: {
        fileName: fileName,
        userId: user.id,
      },
    });

    if (!mediaRecord) {
      return res.status(404).json({ message: "Media file not found or access denied" });
    }

    // Return the media URL from the database
    res.status(200).json({
      url: mediaRecord.url,
      fileName: mediaRecord.fileName,
      fileType: mediaRecord.fileType,
      fileSize: mediaRecord.fileSize,
      mimeType: mediaRecord.mimeType,
    });
  } catch (error) {
    console.error("Error fetching media:", error);
    res.status(500).json({ message: "Error fetching media", error: (error as any)?.message });
  }
};
// POST /:tenantId/api/v1/updateContactAttributes
export const updateContactAttributes = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId, whatsappNumber } = req.params;
    const updateData = req.body;

    if (!phoneNumberId || !whatsappNumber) {
      return res.status(400).json({ message: "phoneNumberId and whatsappNumber are required" });
    }
    if (!updateData || typeof updateData !== 'object' || Array.isArray(updateData)) {
      return res.status(400).json({ message: "Request body must be a JSON object with attribute key-value pairs" });
    }

    // Find businessPhoneNumberId from phoneNumberId
    const businessPhone = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: phoneNumberId },
      select: { id: true },
    });
    if (!businessPhone) {
      return res.status(404).json({ message: "Business phone number not found" });
    }
    const businessPhoneNumberId = businessPhone.id;

    // Find contact by whatsappNumber
    const contact = await prisma.contact.findFirst({
      where: { phoneNumber: whatsappNumber as string },
    });
    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }

    // Check if the contact has a conversation with the businessPhoneNumberId

    // Update the contact's attributes
    const existingContactAttributes = (contact.attributes as Record<string, any>) || {};
    const updatedContactAttributes = { ...existingContactAttributes, ...updateData };

    const updatedContact = await prisma.contact.update({
      where: { id: contact.id },
      data: { attributes: updatedContactAttributes },
    });

    // Always return a flat object for attributes (no numeric keys)
    const flatAttributes = Object.fromEntries(
      Object.entries(updatedContact.attributes || {}).filter(([key]) => isNaN(Number(key)))
    );

    res.json({
      message: "Attribute updated",
      attributes: flatAttributes,
    });
  } catch (error) {
    console.error("Error updating contact attributes:", error);
    res.status(500).json({ error: "Failed to update contact attributes" });
  }
};
// POST /:phoneNumberId/api/v1/updateContactAttributesForMultiContacts
export const updateContactAttributesForMultiContacts = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { contacts } = req.body;
    if (!phoneNumberId || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ message: "phoneNumberId (path) and contacts (body) are required" });
    }

    // Find businessPhoneNumberId from phoneNumberId
    const businessPhone = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: phoneNumberId },
      select: { id: true },
    });
    if (!businessPhone) {
      return res.status(404).json({ message: "Business phone number not found" });
    }
    const businessPhoneNumberId = businessPhone.id;

    const results = [];
    for (const contactObj of contacts) {
      const { whatsappNumber, customParams } = contactObj;
      if (!whatsappNumber) {
        results.push({ whatsappNumber, status: 'failed', error: 'Missing whatsappNumber' });
        continue;
      }
      try {
        // Find contact by whatsappNumber
        const contact = await prisma.contact.findFirst({
          where: { phoneNumber: whatsappNumber as string },
        });
        if (!contact) {
          results.push({ whatsappNumber, status: 'failed', error: 'Contact not found' });
          continue;
        }
        // Check if the contact has a conversation with the businessPhoneNumberId
    
        // Merge customParams into attributes
        const existingAttributes = (contact.attributes as Record<string, any>) || {};
        let updatedAttributes = { ...existingAttributes };
        if (Array.isArray(customParams)) {
          for (const param of customParams) {
            if (param.name) {
              updatedAttributes[param.name] = param.value;
            }
          }
        }
        await prisma.contact.update({
          where: { id: contact.id },
          data: { attributes: updatedAttributes },
        });
        results.push({ whatsappNumber, status: 'updated' });
      } catch (err) {
        results.push({ whatsappNumber, status: 'failed', error: err instanceof Error ? err.message : String(err) });
      }
    }
    res.status(200).json({ message: 'Attributes update complete', results });
  } catch (error) {
    console.error("Error updating contact attributes for multi contacts:", error);
    res.status(500).json({ error: "Failed to update contact attributes for multi contacts" });
  }
};
// POST /:tenantId/api/v1/rotateToken
export const rotateToken = (req: Request, res: Response) => { res.sendStatus(501); };
// POST /:tenantId/api/v1/addContact/:whatsappNumber
export const addContact = async (req: Request, res: Response) => {
  const { name, source, tags, attributes,allowBroadcast, allowSMS  } = req.body;
  const { phoneNumberId, whatsappNumber } = req.params;
  try {
    // find the user who has selectedPhoneNumberId equal to phoneNumberId
    const userWithPhone = await prisma.user.findFirst({
      where: { selectedPhoneNumberId: phoneNumberId },
      select: { id: true },
    });
    if (!userWithPhone) {
      return res.status(404).json({ message: 'No user found with the given phoneNumberId' });
    }
    let contactUserId = userWithPhone.id;
    if (!contactUserId) {
      const reqUser: any = req.user;
      if (reqUser && reqUser.userId) {
        contactUserId = reqUser.userId;
      }
    }

    const parsedAttributes = attributes ?
      (typeof attributes === 'string' ? JSON.parse(attributes) : attributes) :
      {};
    //first check if the contact already exists
    const existingContact = await prisma.contact.findFirst({
      where: { phoneNumber: whatsappNumber as string },
    });
    if (existingContact) {
      return res.status(400).json({ message: 'Contact already exists' });
    }
    // Create the new contact
    const newContact = await prisma.contact.create({
      data: {
        name,
        phoneNumber: whatsappNumber as string,
        source: source || 'manual',
        createdById: contactUserId,
        tags: tags || [],
        attributes: parsedAttributes,
        subscribed: allowBroadcast ?? false,  // Map allowBroadcast -> subscribed
        sendSMS: allowSMS ?? false, 
      },
    });


    res.status(201).json(newContact);
  } catch (error) {
    console.error("Error creating contact:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
// POST /:phoneNumberId/api/v1/sendSessionFile/:whatsappNumber
export const sendSessionFile = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId, whatsappNumber } = req.params;
    const user: any = req.user;
    const file = req.file;

    if (!phoneNumberId || !whatsappNumber) {
      return res.status(400).json({ error: "phoneNumberId and whatsappNumber are required" });
    }
    if (!file || !file.buffer) {
      return res.status(400).json({ error: "File is required and must be in memory" });
    }

    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    });
    if (!dbUser?.selectedPhoneNumberId) {
      return res.status(400).json({ error: "User does not have a selected Phone Number ID" });
    }

    const contact = await prisma.contact.findFirst({
      where: { phoneNumber: whatsappNumber as string },
    });
    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    // Upload to DO Spaces or S3 using buffer
    const fileKey = `${Date.now()}-${file.originalname}`;
    const uploadParams = {
      Bucket: process.env.DO_SPACES_BUCKET || "",
      Key: fileKey,
      Body: file.buffer, // ✅ using in-memory buffer
      ACL: "public-read",
      ContentType: file.mimetype,
    };

    let fileUrl;
    try {
      const result = await s3.upload(uploadParams).promise();
      fileUrl = result.Location;
    } catch (uploadErr) {
      console.error("Error uploading to S3/Spaces:", uploadErr);
      return res.status(500).json({ error: "File upload failed" });
    }

    // Detect message type
    let messageType = "document";
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif"].includes(ext as string)) messageType = "image";
    else if (["mp3", "wav", "ogg"].includes(ext as string)) messageType = "audio";
    else if (["mp4", "mov"].includes(ext as string)) messageType = "video";

    // Send message to WhatsApp
    await sendMessage(
      contact.phoneNumber,
      { type: messageType, message: { url: fileUrl, name: file.originalname } },
      0,
      user.userId,
      false,
      dbUser.selectedPhoneNumberId
    );

    res.status(200).json({ success: true, fileUrl });
  } catch (error) {
    console.error("Error sending session file:", error);
    res.status(500).json({ error: "Please start by opening a session first, if it is expired" });
  }
};

// POST /:phoneNumberId/api/v1/sendSessionMessage/:whatsappNumber
export const sendSessionMessage = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId, whatsappNumber } = req.params;
    const user: any = req.user;
    const { message } = req.query;

    if (!phoneNumberId || !whatsappNumber) {
      return res.status(400).json({ error: "phoneNumberId and whatsappNumber are required" });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Message is required and must be a string" });
    }

    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    });
    if (!dbUser?.selectedPhoneNumberId) {
      return res.status(400).json({ error: "User does not have a selected Phone Number ID" });
    }

    const contact = await prisma.contact.findFirst({
      where: { phoneNumber: whatsappNumber as string },
    });
    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    // Send message to WhatsApp
    await sendMessage(
      contact.phoneNumber,
      { type: "text", message },
      0,
      user.userId,
      false,
      dbUser.selectedPhoneNumberId
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error sending session message:", error);
    res.status(500).json({ error: "Please start by opening a session first, if it is expired" });
  }
};
// POST /:tenantId/api/v1/sendTemplateMessage
export const sendTemplateMessage = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { whatsappNumber } = req.query;
    const { template_name, broadcast_name, templateParameters,fileUrl } = req.body;
    const user: any = req.user;

    // Validate required fields
    if (!phoneNumberId || !whatsappNumber || !template_name) {
      return res.status(400).json({
        message: "phoneNumberId (path), whatsappNumber (query), and template_name (body) are required"
      });
    }

    // Find the contact to create broadcast recipient
    const contact = await prisma.contact.findFirst({
      where: { phoneNumber: whatsappNumber as string },
      select: { id: true }
    });

    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }

    // Create broadcast record
    const broadcast = await prisma.broadcast.create({
      data: {
        name: broadcast_name || `Template: ${template_name}`,
        templateName: template_name,
        userId: Number((user as any)?.userId) || 1,
        phoneNumberId: phoneNumberId,
        recipients: {
          create: [{
            contact: { connect: { id: contact.id } }
          }]
        }
      }
    });

    // Send the template message
    const templateResult = await broadcastTemplate(
      whatsappNumber as string,
      template_name,
      0, // chatbotId is not used in this context
      broadcast.id, // broadcastId from created broadcast
      phoneNumberId,
      templateParameters || {}, // templateParameters
      fileUrl // fileUrl - not used for single message
    );

    // Check if template sending was successful
    if (templateResult && templateResult.success === false) {
      console.error("Error sending template message:", templateResult.message);
      console.error("Full error response:", JSON.stringify(templateResult.error, null, 2));
      
      // Update broadcast status to FAILED
      await prisma.broadcast.update({
        where: { id: broadcast.id },
        data: {
          status: 'FAILED'
        }
      });
      
      // Extract detailed error message from WhatsApp API response
      let errorMessage = templateResult.message || "Failed to send template message";
      
      if (templateResult.error?.error?.error_data?.details) {
        errorMessage = templateResult.error.error.error_data.details;
      }
      
      throw new Error(errorMessage);
    }

    // Update broadcast status to SENT only if template was sent successfully
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        sentAt: new Date(),
        status: 'SENT'
      }
    });

    res.status(200).json({
      message: "Template message sent successfully",
      recipient: whatsappNumber,
      template_name,
      broadcastId: broadcast.id
    });
  } catch (error) {
    console.error("Error sending template message:", error);
    res.status(500).json({
      message: "Failed to send template message",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
// POST /:tenantId/api/v1/sendTemplateMessages
export const sendTemplateMessages = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { template_name, broadcast_name,fileUrl } = req.body;

    const receivers: string[] = req.body.contacts;  
    if (!phoneNumberId || !template_name || !Array.isArray(receivers) || receivers.length === 0) {
      return res.status(400).json({
        message: "phoneNumberId (path), template_name (body), and receivers (body) are required"
      });
    }
//but receiver is like this
// "receivers": [
//   {
//     "whatsappNumber": "8801752015791",
//     "customParams": [
//     ]
//   }
    const contactsToConnect = await prisma.contact.findMany({
      where: {
        phoneNumber: { in: receivers },//
      },
      select: { id: true, phoneNumber: true },
    });

    const broadcast = await prisma.broadcast.create({
      data: {
        name: broadcast_name,
        templateName: template_name,
        userId: 1,
        phoneNumberId: phoneNumberId,
        recipients: {
          create: contactsToConnect.map((contact:any) => ({
            contact: { connect: { id: contact.id } },
          })),
        },
      },
    });

    const results = [];
    for (const receiver of contactsToConnect) {
      const whatsappNumber = receiver.phoneNumber;
      // Find the corresponding receiver data to get customParams
      const receiverData = receivers.find((r: any) => r.whatsappNumber === whatsappNumber);
      const customParams = (receiverData as any)?.customParams || {};
      
      try {
        // broadcastTemplate(phoneNumber, templateName, chatbotId, broadcastId, phoneNumberId, templateParameters, fileUrl)
        const templateResult = await broadcastTemplate(
          whatsappNumber,
          template_name,
          0, // chatbotId (not used)
          broadcast.id, // broadcastId
          phoneNumberId,
          req.body.templateParameters, // templateParameters from receiver data
          fileUrl // fileUrl - not used for broadcast
        );

        // Check if template sending was successful
        if (templateResult && templateResult.success === false) {
          console.error(`Error sending template message to ${whatsappNumber}:`, templateResult.message);
          console.error("Full error response:", JSON.stringify(templateResult.error, null, 2));
          
          // Extract detailed error message from WhatsApp API response
          let errorMessage = templateResult.message || "Failed to send template message";
          
          if (templateResult.error?.error?.error_data?.details) {
            errorMessage = templateResult.error.error.error_data.details;
          }
          
          results.push({ whatsappNumber, status: 'failed', error: errorMessage });
        } else {
          results.push({ whatsappNumber, status: 'sent' });
        }
      } catch (err) {
        console.error(`Unexpected error sending template to ${whatsappNumber}:`, err);
        results.push({ whatsappNumber, status: 'failed', error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Update broadcast status after all messages are sent
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        sentAt: new Date(),
        status: 'SENT'
      }
    });

    res.status(200).json({
      message: "Broadcast sent",
      results
    });
  } catch (error) {
    console.error("Error sending template messages:", error);
    res.status(500).json({
      message: "Failed to send template messages",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
// POST /:tenantId/api/v1/sendTemplateMessagesCSV
export const sendTemplateMessagesCSV = (req: Request, res: Response) => { res.sendStatus(501); };
// POST /:phoneNumberId/api/v1/sendInteractiveButtonsMessage
export const sendInteractiveButtonsMessage = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { whatsappNumber } = req.query;
    const { header, body, footer, buttons } = req.body;
    const user: any = req.user;

    if (!phoneNumberId || !whatsappNumber) {
      return res.status(400).json({ error: "phoneNumberId (path) and whatsappNumber (query) are required" });
    }
    if (!body || !Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) {
      return res.status(400).json({ error: "body (string) and 1-3 buttons are required" });
    }

    // Find user and selectedPhoneNumberId
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    });
    if (!dbUser?.selectedPhoneNumberId) {
      return res.status(400).json({ error: "User does not have a selected Phone Number ID" });
    }

    // Find contact by whatsappNumber
    const contact = await prisma.contact.findFirst({ where: { phoneNumber: whatsappNumber as string } });
    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    // Build header payload
    let headerPayload: any = undefined;
    if (header) {
      if (header.type && header.type.toLowerCase() === "text" && header.text) {
        headerPayload = { type: "text", text: header.text };
      } else if (["image", "video", "document"].includes(header.type?.toLowerCase())) {
        if (!header.media || !header.media.url) {
          return res.status(400).json({ error: "media.url is required for non-text header types" });
        }
        if (header.type.toLowerCase() === "image") {
          headerPayload = { type: "image", image: { link: header.media.url } };
        } else if (header.type.toLowerCase() === "video") {
          headerPayload = { type: "video", video: { link: header.media.url } };
        } else if (header.type.toLowerCase() === "document") {
          headerPayload = { type: "document", document: { link: header.media.url, filename: header.fileName } };
        }
      }
    }

    // Build buttons payload
    const actionButtons = buttons.map((btn: any, i: number) => ({
      type: 'reply',
      reply: { id: `${i}_btn`, title: btn.text }
    }));

    // Build interactive payload
    const interactive = {
      type: 'button',
      header: headerPayload,
      body: { text: body },
      footer: footer ? { text: footer } : undefined,
      action: { buttons: actionButtons },
    };

    // Send to WhatsApp
    const { sendMessageWithButtons } = require("../processors/metaWebhook/webhookProcessor");
    await sendMessageWithButtons(
      contact.phoneNumber,
      interactive,
      dbUser.selectedPhoneNumberId
    );

    // Optionally, store the sent message (not required here)

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error sending interactive buttons message:", error);
    res.status(500).json({ error: "Failed to send interactive buttons message" });
  }
};
// POST /:phoneNumberId/api/v1/sendInteractiveListMessage
export const sendInteractiveListMessage = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { whatsappNumber } = req.query;
    const { header, body, footer, buttonText, sections } = req.body;
    const user: any = req.user;
    const axios = require('axios');
    const { metaWhatsAppAPI } = require("../config/metaConfig");

    if (!phoneNumberId || !whatsappNumber) {
      return res.status(400).json({ error: "phoneNumberId (path) and whatsappNumber (query) are required" });
    }
    if (!body || !buttonText || !Array.isArray(sections) || sections.length < 1 || sections.length > 10) {
      return res.status(400).json({ error: "body (string), buttonText (string), and 1-10 sections are required" });
    }

    // Find user and selectedPhoneNumberId
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedPhoneNumberId: true },
    });
    if (!dbUser?.selectedPhoneNumberId) {
      return res.status(400).json({ error: "User does not have a selected Phone Number ID" });
    }

    // Transform sections/rows to WhatsApp API format
    const waSections = sections.map((section: any) => ({
      title: section.title,
      rows: section.rows.map((row: any) => ({
        id: typeof row.id === 'string' ? row.id : undefined,
        title: typeof row.title === 'string' ? row.title : String(row.title ?? ''),
        description: typeof row.description === 'string' ? row.description : '',
      }))
    }));

    // Build WhatsApp API payload
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: whatsappNumber,
      type: "interactive",
      interactive: {
        type: "list",
        header: header ? { type: "text", text: header } : undefined,
        body: { text: body },
        footer: footer ? { text: footer } : undefined,
        action: {
          button: buttonText,
          sections: waSections,
        },
      },
    };
    // Remove undefined header/footer if not present
    if (!header) delete payload.interactive.header;
    if (!footer) delete payload.interactive.footer;

    // Send to WhatsApp
    const url = `${process.env.META_BASE_URL || metaWhatsAppAPI.baseURL}/${dbUser.selectedPhoneNumberId}/messages`;
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN || metaWhatsAppAPI.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Error sending interactive list message:", error?.response?.data || error);
    res.status(500).json({ error: "Failed to send interactive list message" });
  }
};
// POST /:phoneNumberId/api/v1/assignOperator
export const assignOperator = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { whatsappNumber, email } = req.query;
    if (!phoneNumberId || !whatsappNumber) {
      return res.status(400).json({ error: "phoneNumberId (path) and whatsappNumber (query) are required" });
    }
    const dbUser: any = await prisma.user.findFirst({ where: { selectedPhoneNumberId: phoneNumberId }, select: { id: true } });
    let assignedUserId: number | null = null;
    let user:any;
    if (email) {
     user = await prisma.user.findFirst({ where: { email: email as string }, select: { id: true, email: true } });
      if (!user) {
        return res.status(404).json({ error: `User with email ${email} not found` });
      }
      assignedUserId = user.id;
    }
    else {
       user = await prisma.user.findFirst({ where: { email: "bot" }, select: { id: true, email: true } });
      if (!user) {
        return res.status(404).json({ error: `User with email ${email} not found` });
      }
      assignedUserId = user.id;
    }

    // Upsert contact: assign userId or null (bot)
    await prisma.contact.upsert({
      where: { phoneNumber: whatsappNumber as string },
      update: { userId: assignedUserId },
      create: {
        phoneNumber: whatsappNumber as string,
        name: "Unknown",
        source: "WhatsApp",
        userId: assignedUserId,
        createdById: dbUser?.id || undefined,
      },
    });
    const contact = await prisma.contact.findFirst({ where: { phoneNumber: whatsappNumber as string }, select: { id: true } });
    await prisma.chatStatusHistory.create({
      data: {
        contactId: contact?.id||0,
        newStatus: "Assigned",
        type: "assignmentChanged",
        note: `Assigned to agent ${user?.email}`,
        assignedToUserId: user?.id,
        changedById:  null,
        changedAt: new Date(),
      }
    });
    //await notifyAgent(io, user?.email, dbUser.email, contact?.name || "Unknown");
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error assigning operator:", error);
    res.status(500).json({ error: "Failed to assign operator" });
  }
};
// POST /:tenantId/api/v1/assignTeam
export const assignTeam = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    let { whatsappNumber, teams } = req.query;

    if (!phoneNumberId || !whatsappNumber || !teams) {
      return res.status(400).json({ error: "phoneNumberId (path), whatsappNumber (query), and teams (query) are required" });
    }

    // Normalize teams to a string array
    let teamNames: string[] = [];
    if (Array.isArray(teams)) {
      teamNames = teams.filter((t): t is string => typeof t === "string");
    } else if (typeof teams === "string") {
      try {
        // Try to parse as JSON array
        const parsed = JSON.parse(teams);
        if (Array.isArray(parsed)) {
          teamNames = parsed.filter((t): t is string => typeof t === "string");
        } else {
          teamNames = [teams];
        }
      } catch {
        teamNames = [teams];
      }
    }

    if (!Array.isArray(teamNames) || teamNames.length === 0) {
      return res.status(400).json({ error: "teams must be a non-empty array of team names" });
    }

    // Find user who owns this phoneNumberId
    const userWithPhoneNumber = await prisma.user.findFirst({
      where: { selectedPhoneNumberId: phoneNumberId },
      select: { 
        id: true,
        teams: {
          select: { id: true }
        }
      }
    });

    if (!userWithPhoneNumber) {
      return res.status(404).json({ error: "User with the specified phoneNumberId not found" });
    }

    // Get the team IDs that belong to this user
    const userTeamIds = userWithPhoneNumber.teams.map(team => team.id);

    if (userTeamIds.length === 0) {
      return res.status(403).json({ error: "User has no teams assigned. Cannot assign teams to contact." });
    }

    // Fetch team IDs by name, ensuring they belong to the user's teams
    const teamRecords = await prisma.team.findMany({
      where: {
        AND: [
          {
            id: { in: userTeamIds } // Only teams that belong to the user
          },
          {
            OR: teamNames.map((teamName: string) =>
              teamName === "Default Team"
                ? { defaultTeam: true }
                : { name: teamName }
            )
          }
        ]
      },
      select: { id: true, name: true },
    });
    const teamIds = teamRecords.map((team) => ({ id: team.id }));
    
    if (teamIds.length === 0) {
      return res.status(404).json({ error: "No matching teams found that belong to this user" });
    }

    // Check if all requested teams were found
    if (teamRecords.length < teamNames.length) {
      const foundTeamNames = teamRecords.map(t => t.name);
      const missingTeams = teamNames.filter(name => !foundTeamNames.includes(name));
      return res.status(404).json({ 
        error: "Some teams not found or do not belong to this user", 
        missingTeams 
      });
    }

    // Update assigned teams in the Contact model
    const contact = await prisma.contact.findFirst({ where: { phoneNumber: whatsappNumber as string } });
    if (!contact) {
      return res.status(404).json({ error: `Contact with phoneNumber ${whatsappNumber} not found.` });
    }
    await prisma.contact.update({
      where: { id: contact.id },
      data: { assignedTeams: { set: teamIds } },
    });

    // Log assignment in chatStatusHistory
    await prisma.chatStatusHistory.create({
      data: {
        contactId: contact.id,
        newStatus: "Assigned",
        type: "assignmentChanged",
        note: `Assigned to Teams: ${teamNames.join(", ")}`,
        changedById: null,
        changedAt: new Date(),
      },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error assigning teams:", error);
    res.status(500).json({ error: "Failed to assign teams" });
  }
};
// POST /:phoneNumberId/api/v1/updateChatStatus
export const updateChatStatus = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { whatsappNumber, ticketStatus } = req.body;
    const allowedStatuses = ["Open", "Solved", "Pending", "Expired"];
    const user: any = req.user;

    if (!phoneNumberId || !whatsappNumber || !ticketStatus) {
      return res.status(400).json({ message: "phoneNumberId (path), whatsappNumber (body), and ticketStatus (body) are required" });
    }
    if (!allowedStatuses.includes(ticketStatus)) {
      return res.status(400).json({ message: `ticketStatus must be one of: ${allowedStatuses.join(", ")}` });
    }

    // Find businessPhoneNumberId from phoneNumberId
    const businessPhone = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: phoneNumberId },
      select: { id: true },
    });
    if (!businessPhone) {
      return res.status(404).json({ message: "Business phone number not found" });
    }
    const businessPhoneNumberId = businessPhone.id;

    // Find contact by whatsappNumber
    const contact = await prisma.contact.findFirst({
      where: { phoneNumber: whatsappNumber as string },
    });
    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }

    // Check if the contact has a conversation with the businessPhoneNumberId
    const conversation = await prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        businessPhoneNumberId,
      },
    });
    if (!conversation) {
      return res.status(404).json({ message: "Contact does not belong to this business phone number" });
    }

    // Only log statusChanged if status has actually changed
    const statusChanged = contact.ticketStatus !== ticketStatus;
    if (statusChanged) {
      await prisma.chatStatusHistory.create({
        data: {
          contactId: contact.id,
          previousStatus: contact.ticketStatus,
          newStatus: ticketStatus,
          type: "statusChanged",
          changedById: user?.userId || null,
          changedAt: new Date(),
        },
      });
    }

    // Update the contact's ticketStatus
    await prisma.contact.update({
      where: { id: contact.id },
      data: { ticketStatus },
    });

    // Emit socket event
    const io = req.app.get("socketio");
    io.emit("chatStatusUpdated", {
      contactId: contact.id,
      chatStatus: ticketStatus,
      changedBy: user?.email || "System",
      changedAt: new Date(),
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error updating chat status:", error);
    res.status(500).json({ error: "Failed to update chat status" });
  }
};
// GET /:tenantId/api/v1/chatbots
export const getChatbots = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.query;
    const page   = parseInt((req.query.page  as string) ?? "1",  10);
    const limit  = parseInt((req.query.limit as string) ?? "10", 10);
    const search = (req.query.search as string)?.trim();
    const offset = (page - 1) * limit;

    if (!phoneNumberId) {
      return res.status(400).json({ message: 'phoneNumberId is required as a query parameter' });
    }

    // Find the user who has selectedPhoneNumberId equal to phoneNumberId
    const userWithPhone = await prisma.user.findFirst({
      where: { selectedPhoneNumberId: phoneNumberId as string },
      select: { id: true },
    });
    if (!userWithPhone) {
      return res.status(404).json({ message: 'No user found with the given phoneNumberId' });
    }

    // combine the search filter and ownerId into one `where`
    const whereFilter: any = {
      ownerId: userWithPhone.id,
      ...(search
        ? { name: { contains: search, mode: 'insensitive' } }
        : {}),
    };

    const [chatbots, total] = await prisma.$transaction([
      prisma.chatbot.findMany({
        where:   whereFilter,
        skip:    offset,
        take:    limit,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.chatbot.count({
        where: whereFilter,
      }),
    ]);

    res.status(200).json({
      chatbots,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Error fetching chatbots:', error);
    res.status(500).json({ message: 'Failed to fetch chatbots' });
  }
};
// POST /:tenantId/api/v1/chatbots/start
export const startChatbot = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { whatsappNumber, chatbotId } = req.query;
    
    if (!phoneNumberId || !whatsappNumber || !chatbotId) {
      return res.status(400).json({ message: "phoneNumberId, whatsappNumber, and chatbotId are required" });
    }
    //chatbotId is  a query string hence always a string. Fix this. What I want to do is if chatbotId is a number, then find the chatbot by id, otherwise find the chatbot by name
    
    let chatbot: any;
    const isNumeric = (value: any) => !isNaN(value) && !isNaN(parseFloat(value));

    if (isNumeric(chatbotId as string)) {
      chatbot = await prisma.chatbot.findFirst({
        where: { id: Number(chatbotId) },
      });
    } else {
      chatbot = await prisma.chatbot.findFirst({
        where: { name: chatbotId as string },
      });
    }
    if (!chatbot) {
      return res.status(404).json({ message: "Chatbot not found" });
    }
    // Compose the trigger text as expected by handleChatbotTrigger
    const text = `TriggerChatbot:${chatbot.name}`;

    // Call the trigger logic
    const result: any = await handleChatbotTrigger(text, whatsappNumber as string, phoneNumberId as string);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.message });
    }
    return res.json({ success: true, message: "Chatbot triggered successfully" });
  } catch (error) {
    console.error("Error triggering chatbot:", error);
    res.status(500).json({ error: "Failed to trigger chatbot" });
  }
};
// POST /:tenantId/api/v1/chatbots/update
export const updateChatbot = (req: Request, res: Response) => { res.sendStatus(501); };
// POST /:tenantId/api/v1/chatbots/stop
export const stopChatbot = (req: Request, res: Response) => { res.sendStatus(501); };

// -------------------- WhatsApp Payment API --------------------
// POST /:tenantId/api/v1/order_details
export const orderDetails = (req: Request, res: Response) => { res.sendStatus(501); };
// POST /:tenantId/api/v1/order_details_template
export const orderDetailsTemplate = (req: Request, res: Response) => { res.sendStatus(501); };
// POST /:tenantId/api/v1/order_status
export const orderStatus = (req: Request, res: Response) => { res.sendStatus(501); };
// POST /:tenantId/api/v1/order_status_template
export const orderStatusTemplate = (req: Request, res: Response) => { res.sendStatus(501); };
// POST /:tenantId/api/v1/checkout_button_template
export const checkoutButtonTemplate = (req: Request, res: Response) => { res.sendStatus(501); };
// GET /:tenantId/api/v1/order_details/:referenceId
export const getOrderDetailsByReferenceId = (req: Request, res: Response) => { res.sendStatus(501); };
// GET /:tenantId/api/v1/payment_status/:referenceId
export const getPaymentStatusByReferenceId = (req: Request, res: Response) => { res.sendStatus(501); };

// -------------------- Payment API --------------------
// POST /:phoneNumberId/payments/create-order
export const createOrder = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { amount, currency, packageName, packageDuration } = req.body;

    if (!phoneNumberId) {
      return res.status(400).json({ error: 'phoneNumberId is required' });
    }

    if (!amount || !packageName || !packageDuration) {
      return res.status(400).json({ error: 'Amount, package name, and package duration are required' });
    }

    if (packageDuration !== 'monthly' && packageDuration !== 'yearly') {
      return res.status(400).json({ error: 'Package duration must be either monthly or yearly' });
    }

    // Find the user with the given selectedPhoneNumberId
    const user = await prisma.user.findFirst({
      where: {
        selectedPhoneNumberId: phoneNumberId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found for the given phoneNumberId" });
    }

    // Validate package pricing against configured packages
    const validation = validatePackagePricing(packageName, amount, packageDuration);
    
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: validation.error,
        expectedAmount: validation.expectedAmount
      });
    }

    const order = await razorpayService.createOrder(amount, user.id, packageName, packageDuration, currency);
    res.json(order);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Error creating order' });
  }
};

// POST /:phoneNumberId/payments/verify-payment
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { paymentId, orderId, signature } = req.body;

    if (!phoneNumberId) {
      return res.status(400).json({ error: 'phoneNumberId is required' });
    }

    if (!paymentId || !orderId || !signature) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Find the user with the given selectedPhoneNumberId
    const user = await prisma.user.findFirst({
      where: {
        selectedPhoneNumberId: phoneNumberId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found for the given phoneNumberId" });
    }

    const isValid = await razorpayService.verifyPayment(paymentId, orderId, signature);
    
    if (isValid) {
      // Fetch the updated payment record to get card information
      const payment = await razorpayService.getPaymentDetails(orderId);
      
      res.json({ 
        status: 'success', 
        message: 'Payment verified successfully',
        payment: {
          id: payment.id,
          orderId: payment.orderId,
          paymentId: payment.paymentId,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          lastFourDigits: payment.lastFourDigits,
          cardType: payment.cardType,
          createdAt: payment.createdAt
        }
      });
    } else {
      res.status(400).json({ status: 'error', message: 'Payment verification failed' });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ error: 'Error verifying payment' });
  }
}; 