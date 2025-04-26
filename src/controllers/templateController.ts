import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import { preprocessHtmlForWhatsApp } from "../helpers";
import fs from "fs";
import FormData from "form-data";
import { prisma } from "../models/prismaClient";
import { brodcastTemplate } from "../processors/template/templateProcessor";

interface ButtonData {
  id?: number;
  type: string;      // e.g. "Visit Website", "Call Phone", "Copy offer code", "Quick replies"
  label?: string;    // The text you want displayed on the button
  url?: string;
  phone?: string;
  code?: string;
  [key: string]: any;
}

dotenv.config();

const WHATSAPP_GRAPH_API = `${process.env.META_BASE_URL}/${process.env.META_WHATSAPP_BUSINESS_ID}/message_templates`;

// Axios instance with headers
const axiosInstance = axios.create({
  headers: {
    Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
});

export const getAllTemplates = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        selectedWabaId: true,
      },
    });
    const templates = await prisma.template.findMany({
      where: { userId: user.userId, wabaId: userRecord?.selectedWabaId },
    });

    const formattedTemplates = templates.map((tmpl: any) => {
      let parsedContent = {};
      try {
        // Try to parse the stored content (which should be in your desired format)
        parsedContent = JSON.parse(tmpl.content);
      } catch (e) {
        // Fallback: if parsing fails, we build the object from DB fields.
        parsedContent = {
          name: tmpl.name,
          parameter_format: "POSITIONAL",
          components: [],
          language: tmpl.language,
          status: tmpl.status,
          category: tmpl.category,
          id: tmpl.id.toString(),
          lastUpdated:tmpl.updatedAt.toISOString().split("T")[0]
        };
      }
      return {
        ...parsedContent,
        // Ensure the main fields are present and correctly formatted:
        name: tmpl.name,
        language: tmpl.language,
        status: tmpl.status,
        category: tmpl.category,
        id: tmpl.id.toString(),
        lastUpdated:tmpl.updatedAt.toISOString().split("T")[0]
      };
    });

    // Create a dummy paging object. In a real-world scenario you might generate these cursors.
    const paging = {
      cursors: {
        before: "MAZDZD",
        after: "MjQZD",
      },
    };

    res.status(200).json({ data: formattedTemplates, paging });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to fetch templates",
      details: error.response?.data || error.message,
    });
  }
};

// **Create a New Template**
export const   createTemplate = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedWabaId: true },
    });
    const selectedWabaId = dbUser?.selectedWabaId;
    const { name, category, language } = req.body;
    const file = req.file;
    const filePath = req?.file?.path || "";
    const components = JSON.parse(req.body.components || "[]");

    // ✅ Preprocess only BODY type
    const processedComponents = components.map(async (component: any) => {
      if (component.type === "BODY") {
        return {
          ...component,
          text: preprocessHtmlForWhatsApp(component.text || ""),
        };
      }

      // ✅ Process HEADER with media (upload & replace header_handle)
      if (component.type === "HEADER" && req.file) {
        // ✅ Step 1: Upload Media to WhatsApp API
        const mediaUploadResponse = await axios.post(
          `${process.env.META_BASE_URL}/${process.env.META_APP_ID}/uploads`,
          null,
          {
            params: {
              file_name: req.file.originalname, // The name of the file being uploaded
              file_length: req.file.size, // The length of the file in bytes
              file_type: req.file.mimetype,
              access_token: process.env.META_ACCESS_TOKEN,
            },
            headers: {
              Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
            },
          }
        );
        let mediaUploadId = mediaUploadResponse.data.id; // Returns "upload:1233"

        const form = new FormData();
        form.append("file_offset", 0);
        form.append("file", fs.createReadStream(filePath));
        const fileSize = fs.statSync(filePath).size;
        const fileStreams = fs.createReadStream(filePath);
        const headers = {
          Authorization: `OAuth ${process.env.META_ACCESS_TOKEN}`,
          file_offset: "0",
          "Content-Length": fileSize,
          ...form.getHeaders(),
        };
        const mediaIdResponse = await axios.post(
          `${process.env.META_BASE_URL}/${mediaUploadId}`,
          fileStreams,
          { headers }
        );

        if (mediaIdResponse.data && mediaIdResponse.data.h) {
          // ✅ Replace header_handle with media ID
          return {
            type: "HEADER",
            format: component.format,
            example: {
              header_handle: [mediaIdResponse.data.h],
            },
          };
        } else {
          throw new Error("Failed to upload media to WhatsApp");
        }
      }

      return component;
    });

    // ✅ Resolve all async component modifications
    const resolvedComponents = await Promise.all(processedComponents);
    const buttonsData: ButtonData[] = JSON.parse(req.body.buttons || "[]");

    // 3) Transform them into Meta's "BUTTONS" component if any exist
    if (buttonsData.length > 0) {
      // Map each frontend button to a Meta button object
      const metaButtons = buttonsData.map((button) => {
        // Remove unwanted keys like "id", "labelLimit", etc.
        const { id, labelLimit, urlLimit, phoneLimit, codeLimit, ...rest } = button;

        // We'll convert your custom "type" to Meta's "type" ("PHONE_NUMBER", "URL", or "QUICK_REPLY")
        switch (rest.type) {
          case "Call Phone":
            return {
              type: "PHONE_NUMBER",
              text: rest.label || "Call",
              phone_number: rest.phone || "",
            };

          case "Visit Website":
            return {
              type: "URL",
              text: rest.label || "Visit us",
              url: rest.url || "",
            };

          case "Copy offer code":
            // Typically a quick reply with some text
            return {
              type: "QUICK_REPLY",
              text: rest.label || "Offer Code",
            };

          case "Quick replies":
            return {
              type: "QUICK_REPLY",
              text: rest.label || "Reply",
            };

          default:
            // Fallback to QUICK_REPLY if unrecognized
            return {
              type: "QUICK_REPLY",
              text: rest.label || "Reply",
            };
        }
      });

      resolvedComponents.push({
        type: "BUTTONS",
        buttons: metaButtons,
      });}
      console.log(resolvedComponents);
    const response = await axiosInstance.post(WHATSAPP_GRAPH_API, {
      name,
      category,
      language,
      components: resolvedComponents,
    });
    const templateContent = {
      name,
      parameter_format: "POSITIONAL",
      components: resolvedComponents, // the processed components array
      language,
      // Use response.data.status if available, otherwise default to "PENDING"
      status: response.data.status || "PENDING",
      category,
      // Ensure id is a string; if response.data.id exists, convert it to string
      id: response.data.id ? response.data.id.toString() : undefined,
    };

    // Create the template in the database with the new structure in the content field.
    const dbTemplate = await prisma.template.create({
      data: {
        name,
        language,
        category,
        status: "PENDING", // We store pending status initially
        content: JSON.stringify(templateContent),
        userId: user?.userId,
        wabaId: selectedWabaId,
      },
    });

    res.status(201).json(response.data);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to create template",
      details: error.response?.data || error.message,
    });
  }
};

// **Delete a Template**
export const deleteTemplate = async (req: Request, res: Response) => {
  try {
    const { templateName } = req.params;
    const deleteURL = `${WHATSAPP_GRAPH_API}/${templateName}`;

    const response = await axiosInstance.delete(deleteURL);
    res.status(200).json(response.data);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to delete template",
      details: error.response?.data || error.message,
    });
  }
};

export const createBroadcast = async (req: Request, res: Response) => {
  try {
    const { broadcastName, templateName, userId, contacts, chatbotId, scheduledDate, scheduledTime } =
      req.body;
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { id: true, selectedPhoneNumberId: true },
    });
    const phoneNumberId = dbUser?.selectedPhoneNumberId;
    const contactsToConnect = await prisma.contact.findMany({
      where: {
        phoneNumber: { in: contacts },
      },
      select: { id: true },
    });
    const broadcast = await prisma.broadcast.create({
      data: {
        name: broadcastName,
        templateName,
        userId: dbUser?.id || 1,
        phoneNumberId,
        recipients: {
          create: contactsToConnect.map((contact) => ({
            contact: { connect: { id: contact.id } },
          })),
        },
      },
    });

    // If scheduling is requested
    if (scheduledDate && scheduledTime) {
      const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`);

      // Schedule the broadcast using Agenda
      const agenda = (await import('../config/agenda')).default;
      await agenda.schedule(scheduledDateTime, 'sendScheduledBroadcast', {
        broadcastId: broadcast.id
      });

      // Update the broadcast with scheduling info
      await prisma.broadcast.update({
        where: { id: broadcast.id },
        data: {
          scheduledDate,
          scheduledTime
        }
      });

      res.status(200).json({
        success: true,
        broadcastId: broadcast.id,
        message: "Broadcast scheduled successfully!",
        scheduledFor: scheduledDateTime
      });
    } else {
      // Send immediately if no scheduling requested
      for (const phoneNumber of contacts) {
        await brodcastTemplate(
          phoneNumber,
          templateName,
          chatbotId,
          broadcast.id
        );
      }

      // Update sent time
      await prisma.broadcast.update({
        where: { id: broadcast.id },
        data: {
          sentAt: new Date()
        }
      });

      res.status(200).json({
        success: true,
        broadcastId: broadcast.id,
        message: "Broadcast sent successfully!",
      });
    }
  } catch (error: any) {
    console.error("Error creating broadcast:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create broadcast",
      error: error.message,
    });
  }
};

export const getBroadcastStats = async (req: Request, res: Response) => {
  try {
    const broadcastId = parseInt(req.params.id, 10);
    if (isNaN(broadcastId)) {
      res.status(400).json({ error: "Invalid broadcast id" });
    }
    const broadcast = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
      include: {
        recipients: true,
      },
    });
    if (!broadcast) {
      res.status(404).json({ error: "Broadcast not found" });
    }
    const totalRecipients = broadcast?.recipients.length;
    // Group the broadcast recipients by status for the given broadcast
    const stats = await prisma.broadcastRecipient.groupBy({
      by: ["status"],
      where: { broadcastId },
      _count: { _all: true },
    });

    // Create a default stats object with zeros.
    const defaultStats: { [key: string]: number } = {
      SENT: 0,
      DELIVERED: 0,
      READ: 0,
      FAILED: 0,
    };

    // Map the groupBy results into the defaultStats object.
    stats.forEach((stat) => {
      defaultStats[stat.status] = stat._count._all;
    });

    res.status(200).json({
      data: {
        ...defaultStats,
        totalRecipients,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to fetch broadcast stats",
      details: error.message,
    });
  }
};

export const getBroadcasts = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate, dateRange } = req.query;
    let where: any = {};

    if (dateRange && dateRange !== "customRange") {
      const today = new Date();
      let start: Date | null = null;
      if (dateRange === "7days") {
        start = new Date(today);
        start.setDate(today.getDate() - 7);
      } else if (dateRange === "30days") {
        start = new Date(today);
        start.setDate(today.getDate() - 30);
      }
      if (start) {
        where.createdAt = { gte: start, lte: today };
      } else if (startDate && endDate) {
        // fallback to custom range if dateRange value is unsupported
        where.createdAt = {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string),
        };
      }
    } else if (startDate && endDate) {
      // Use custom date range if dateRange is "customRange" or not provided
      where.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }
    const broadcasts = await prisma.broadcast.findMany({
      where,
      include: { recipients: true },
    });
    res.status(200).json(broadcasts);
  } catch (error) {
    console.error("Error fetching broadcasts:", error);
    res.status(500).json({ error: "Failed to fetch broadcasts" });
  }
};

export const getTemplateByName = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { templateName } = req.params;

    // Fetch the template record from the DB
    const tmpl = await prisma.template.findUnique({
      where: { name: templateName },
    });

    if (!tmpl) {
      res.status(404).json({ error: "Template not found" });
    }
    if (tmpl) {
      const formattedTemplates = (() => {
        let parsedContent = {};
        try {
          // Try to parse the stored content (which should be in your desired format)
          parsedContent = JSON.parse(tmpl?.content || "{}");
        } catch (e) {
          // Fallback: if parsing fails, we build the object from DB fields.
          parsedContent = {
            name: tmpl.name,
            parameter_format: "POSITIONAL",
            components: [],
            language: tmpl.language,
            status: tmpl.status,
            category: tmpl.category,
            id: tmpl.id.toString(),
          };
        }
        return {
          ...parsedContent,
          // Ensure the main fields are present and correctly formatted:
          name: tmpl.name,
          language: tmpl.language,
          status: tmpl.status,
          category: tmpl.category,
          id: tmpl.id.toString(),
        };
      })();

      // Create a dummy paging object. In a real-world scenario you might generate these cursors.
      const paging = {
        cursors: {
          before: "MAZDZD",
          after: "MjQZD",
        },
      };

      res.status(200).json({ data: formattedTemplates, paging });
    }
  } catch (error) {
    console.error("Error fetching template by name:", error);
    res.status(500).json({ error: "Failed to fetch template" });
  }
};

