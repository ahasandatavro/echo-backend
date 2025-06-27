import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import { preprocessHtmlForWhatsApp } from "../helpers";
import fs from "fs";
import FormData from "form-data";
import { prisma } from "../models/prismaClient";
import { brodcastTemplate } from "../processors/template/templateProcessor";
import { uploadFileToDigitalOcean } from "../routes/replyMaterialRoute";
import { syncTemplates as syncTemplatesService } from "../services/templateService";
import { checkBroadcastAccess, checkTemplateLimit } from "../utils/packageUtils";

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
    //send latests templates first
    const templates = await prisma.template.findMany({
      where: { userId: user.userId, wabaId: userRecord?.selectedWabaId },
      orderBy: { updatedAt: 'desc' },
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

export const getAllApprovedTemplates = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        selectedWabaId: true,
      },
    });
    //send latests templates first
    const templates = await prisma.template.findMany({
      where: { userId: user.userId, wabaId: userRecord?.selectedWabaId, status: "APPROVED" },
      orderBy: { updatedAt: 'desc' },
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

export const getTemplatesLibrary = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        selectedWabaId: true,
      },
    });
    // grab your Cloud-API filters from the querystring
    const { search, topic, usecase, industry, language } = req.query

    const params = new URLSearchParams({
      access_token: process.env.META_ACCESS_TOKEN!,
    })
    if (search)   params.append('search',   String(search))
    if (topic)    params.append('topic',    String(topic))
    if (usecase)  params.append('usecase',  String(usecase))
    if (industry) params.append('industry', String(industry))
    if (language) params.append('language', String(language))

    const url = `https://graph.facebook.com/v17.0/message_template_library?${params.toString()}`
   // const url = `https://graph.facebook.com/v17.0/${userRecord?.selectedWabaId}/message_templates?fields=name,language,category,components`
  const { data } = await axios.get(url)

    // data.data is your array of templates
    const templates: any[] = data.data || []

    // compute counts by topic so your tabs show e.g. "Travel (6)"
    const counts = templates.reduce<Record<string, number>>((acc, t) => {
      const key = t.topic || 'Others'
      acc[key] = (acc[key] || 0) + 1
      acc.All = (acc.All || 0) + 1
      return acc
    }, { All: 0 })

    res.json({ templates, counts })
  } catch (err) {
      console.error(err)
    res.status(500).json({ error: 'Failed to fetch templates' })
  }
}
function extractBodyVariableNumbers(text:string) {
  // Returns array of variable numbers as strings, in order of appearance
  const matches = Array.from(text.matchAll(/\{\{(\d+)\}\}/g));
  return matches.map(m => m[1]);
}
function extractHeaderVariableNumbers(text:string) {
  // Returns array of variable numbers as strings, in order of appearance
  const matches = Array.from((text || "").matchAll(/\{\{(\d+)\}\}/g));
  return matches.map(m => m[1]);
}

export const createTemplate = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    
    // Check template creation limit based on package
    const limitCheck = await checkTemplateLimit(user.userId, 1);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: "Template creation limit exceeded for your package",
        details: limitCheck.message || "You have reached your template creation limit"
      });
    }

    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedWabaId: true },
    });
    const selectedWabaId = dbUser?.selectedWabaId;
    const WHATSAPP_GRAPH_API = `${process.env.META_BASE_URL}/${selectedWabaId}/message_templates`;

    const { name, category, language, draft } = req.body;
    const saveAsDraftInitial =
      draft === true || draft === 'true';

    const sampleContents = JSON.parse(req.body.sampleContents || "{}");
    const components = JSON.parse(req.body.components || "[]");
    const file = req.file;
    const filePath = file?.path || "";

    // Preprocess components (BODY, HEADER, etc.)
    const processedComponents = components.map(async (component: any) => {
      if (
        component.type === "HEADER" &&
        (!component.format || (!component.text?.trim() && !file))
      ) {
        return null;
      }

      if (component.type === "HEADER" && component.format === "TEXT") {
        const headerText = component.text || "";
        const variableNumbers = extractHeaderVariableNumbers(headerText);
        const headerExamples = variableNumbers.map(
          num => sampleContents[num] || ""
        );
        return {
          ...component,
          text: headerText,
          ...(headerExamples.length > 0
            ? { example: { header_text: headerExamples } }
            : {}),
        };
      }

      if (component.type === "BODY") {
        const processedText = preprocessHtmlForWhatsApp(
          component.text || ""
        );
        const variableNumbers = extractBodyVariableNumbers(
          processedText
        );
        const bodyExamples = variableNumbers.map(
          num => sampleContents[num] || ""
        );
        return {
          ...component,
          text: processedText,
          ...(bodyExamples.length > 0
            ? { example: { body_text: bodyExamples } }
            : {}),
        };
      }

      if (component.type === "HEADER" && file) {
        let fileUrl = "";
        try{ fileUrl = await uploadFileToDigitalOcean(file);}
        catch(error){
          console.error("Error uploading media to DigitalOcean:", error);
        }
        if(fileUrl){
        // upload media and return HEADER with example.header_handle
        const uploadRes = await axios.post(
          `${process.env.META_BASE_URL}/${process.env.META_APP_ID}/uploads`,
          null,
          {
            params: {
              file_name: file.originalname,
              file_length: file.size,
              file_type: file.mimetype,
              access_token: process.env.META_ACCESS_TOKEN,
            },
            headers: {
              Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
            },
          }
        );
        const mediaUploadId = uploadRes.data.id;
        const form = new FormData();
        form.append("file_offset", 0);
        form.append("file", fs.createReadStream(filePath));
        const headers = {
          Authorization: `OAuth ${process.env.META_ACCESS_TOKEN}`,
          file_offset: "0",
          "Content-Length": fs.statSync(filePath).size,
          ...form.getHeaders(),
        };
        const mediaIdRes = await axios.post(
          `${process.env.META_BASE_URL}/${mediaUploadId}`,
          form,
          { headers }
        );
        if (mediaIdRes.data?.h) {
          return {
            type: "HEADER",
            format: component.format,
            example: { header_handle: [mediaIdRes.data.h] },
            url: fileUrl,
          };
        }
        throw new Error("Failed to upload media to WhatsApp");
      } 
    }
      return component;
    });

    const resolvedComponents = await Promise.all(
      processedComponents
    );

    // Transform buttons
    const buttonsData: ButtonData[] = JSON.parse(
      req.body.buttons || "[]"
    );
    if (buttonsData.length > 0) {
      const metaButtons = buttonsData.map(button => {
        const {
          urlType,
          label,
          phone,
          url,
        } = button;
        switch (button.type) {
          case "Call Phone":
            return {
              type: "PHONE_NUMBER",
              text: label || "Call",
              phone_number: phone || "",
            };

          case "Visit Website": {
            const urlTemplate = url || "";
            const placeholderMatches = Array.from(
              urlTemplate.matchAll(/\{\{(\d+)\}\}/g)
            );
            const examples = placeholderMatches
              .map(m => sampleContents[m[1]])
              .filter((s): s is string => typeof s === "string");

            const btn: any = {
              type: "URL",
              text: label || "Visit us",
              url: urlTemplate,
            };
                if (
                    urlType === "Dynamic" &&
                    examples.length === placeholderMatches.length &&
                    examples.length > 0
                  ) {
                    // Graph API wants a single string, not an array:
                    btn.example = { url: examples[0] };
                 }
            return btn;
          }

          case "Copy offer code":
          case "Quick replies":
          default:
            return {
              type: "QUICK_REPLY",
              text: label || "Reply",
            };
        }
      });

      resolvedComponents.push({
        type: "BUTTONS",
        buttons: metaButtons,
      });
    }

    let response: any;
    let saveAsDraft = saveAsDraftInitial;

    if (!saveAsDraft) {
      try {
        response = await axiosInstance.post(
          WHATSAPP_GRAPH_API,
          {
            name,
            category,
            language,
            components: resolvedComponents,
          }
        );
      } catch (err: any) {
        console.warn(
          "Meta API call failed, saving template as DRAFT:",
          err.message
        );
        return res.status(500).json({
          error: "err.response?.data.error.message",
          details: err.response?.data.error.message || err.message,
        });
        saveAsDraft = true;
      }
    }

    const templateContent = {
      name,
      parameter_format: "POSITIONAL",
      components: resolvedComponents,
      language,
      status: saveAsDraft
        ? "DRAFT"
        : response?.data?.status || "PENDING",
      category,
      id: !saveAsDraft && response?.data?.id
        ? response.data.id.toString()
        : undefined,
    };
    let dbTemplate: any;
//if (templateContent.status !== "DRAFT"){
//update if already available
    dbTemplate = await prisma.template.upsert({
      where: { name: name, userId: user.userId, wabaId: selectedWabaId },
      update: {
        status: templateContent.status,
        content: JSON.stringify(templateContent),
      },
      create: {
        name,
        language,
        category,
        status: templateContent.status,
        content: JSON.stringify(templateContent),
        userId: user.userId,
        wabaId: selectedWabaId,
      },
    });
//  }
  // else{
  //   const dbTemplate = await prisma.template.update({
  //     where: { name: name, userId: user.userId, wabaId: selectedWabaId },
  //     data: {
  //       status: "PENDING",
  //     },
  //   });
  // }
    if (saveAsDraft) {
      return res.status(201).json(dbTemplate);
    }
    return res.status(201).json(response.data);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to create template",
      details: error.response?.data || error.message,
    });
  }
};

// **Delete a Template**
export const deleteTemplate = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { selectedWabaId: true },
    });
    const selectedWabaId = dbUser?.selectedWabaId;
    const WHATSAPP_GRAPH_API = `${process.env.META_BASE_URL}/${selectedWabaId}/message_templates?name=`;
    const { templateName } = req.params;
    const deleteURL = `${WHATSAPP_GRAPH_API}${templateName}`;
    const template = await prisma.template.findFirst({
      where: {
        name: templateName,
        userId: user.userId,
        wabaId: selectedWabaId,
      },
    });
    //if templates's selected status is draft, it should not delete in meta only in db
    if (template?.status === "DRAFT") {
      await prisma.template.delete({
        where: { id: template.id },
      });
      res.status(200).json({
        success: true,
        message: "Template deleted successfully!",
      });
    }
    else{
      const response = await axiosInstance.delete(deleteURL);
      if (response.status >= 200 && response.status < 300) {
        await prisma.template.deleteMany({
          where: {
            name: templateName,
            userId: user.userId,
            wabaId: selectedWabaId,
          },
        });
      }
      res.status(200).json(response.data);
    }

  } catch (error: any) {
    res.status(500).json({
      error: "Failed to delete template",
      details: error.response?.data || error.message,
    });
  }
};

export const createBroadcast = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    
    // Check broadcast access based on package
    const accessCheck = await checkBroadcastAccess(user.userId);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: accessCheck.message || "Access denied for broadcast features"
      });
    }

    const { broadcastName, templateName, userId, contacts, chatbotId, scheduledDateTime } = req.body;

    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { id: true, selectedPhoneNumberId: true },
    });
    const phoneNumberId = dbUser?.selectedPhoneNumberId;
    if (!phoneNumberId) {
      return res.status(400).json({ message: "No phone number selected." });
    }
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
    if (scheduledDateTime) {
      const scheduledDate = new Date(scheduledDateTime);

      // Schedule the broadcast using Agenda
      const agenda = (await import('../config/agenda')).default;
      await agenda.schedule(scheduledDate, 'sendScheduledBroadcast', {
        broadcastId: broadcast.id
      });

      // Update the broadcast with scheduling info
      await prisma.broadcast.update({
        where: { id: broadcast.id },
        data: {
          scheduledDateTime: scheduledDate,
          status: 'SCHEDULED'
        }
      });

      res.status(200).json({
        success: true,
        broadcastId: broadcast.id,
        message: "Broadcast scheduled successfully!",
        scheduledFor: scheduledDate
      });
    } else {
      // Send immediately if no scheduling requested
      for (const phoneNumber of contacts) {
        await brodcastTemplate(
          phoneNumber,
          templateName,
          chatbotId,
          broadcast.id,
          phoneNumberId
        );
      }

      // Update sent time
      await prisma.broadcast.update({
        where: { id: broadcast.id },
        data: {
          sentAt: new Date(),
          status: 'SENT'
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
      message: error.response?.data?.error?.error_data?.details || error.message,
      error: error.message,
    });
  }
};

export const updateBroadcast = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    
    // Check broadcast access based on package
    const accessCheck = await checkBroadcastAccess(user.userId);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: accessCheck.message || "Access denied for broadcast features"
      });
    }

    const { broadcastId } = req.params;
    const { scheduledDateTime } = req.body;
  
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: parseInt(broadcastId) },
  });
  if (!broadcast) {
    return res.status(404).json({ message: "Broadcast not found." });
  }


    // If scheduling is requested
    if (scheduledDateTime) {
      const scheduledDate = new Date(scheduledDateTime);

      // Schedule the broadcast using Agenda
      const agenda = (await import('../config/agenda')).default;
      //don't delete the existing job, just update the scheduled date
    // inside your update handler, after you compute `scheduledDate` and have `broadcast.id`…

// 1) fetch that single job
const [job] = await agenda.jobs({
  name: "sendScheduledBroadcast",
  "data.broadcastId": broadcast.id,
});

if (job) {
  // 2) move its run time
  job.schedule(scheduledDate);

  // 3) persist the change
  await job.save();
} else {
  // (unlikely) fallback to scheduling if it doesn't exist
  await agenda.schedule(scheduledDate, "sendScheduledBroadcast", {
    broadcastId: broadcast.id,
  });
}
      // Update the broadcast with scheduling info
      await prisma.broadcast.update({
        where: { id: broadcast.id },
        data: {
          scheduledDateTime: scheduledDate,
          status: 'SCHEDULED'
        }
      });

      res.status(200).json({
        success: true,
        broadcastId: broadcast.id,
        message: "Broadcast scheduled successfully!",
        scheduledFor: scheduledDate
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


  export const deleteBroadcast = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const broadcastId = parseInt(req.params.id, 10);
    if (isNaN(broadcastId)) {
      return res.status(400).json({ message: "Invalid broadcast ID." });
    }

    // 1) fetch the broadcast and ensure it belongs to this user
    const existing = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
      select: { id: true, userId: true, status: true },
    });
    if (!existing || existing.userId !== user.userId) {
      return res.status(404).json({ message: "Broadcast not found." });
    }

    // 2) if still scheduled, cancel the Agenda job
    if (existing.status === "SCHEDULED") {
      const agenda = (await import("../config/agenda")).default;
      await agenda.cancel({
        name: "sendScheduledBroadcast",
        "data.broadcastId": broadcastId,
      });
    }

    // 3) Delete all recipients first
    await prisma.broadcastRecipient.deleteMany({
      where: { broadcastId },
    });

    // 4) Now delete the broadcast
    await prisma.broadcast.delete({
      where: { id: broadcastId },
    });

    return res.status(200).json({
      success: true,
      message: "Broadcast and all recipients deleted successfully.",
      broadcastId,
    });
  } catch (err: any) {
    console.error("deleteBroadcast error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete broadcast.",
      error: err.message,
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
    const { startDate, endDate, dateRange, page = "1", limit = "10", search } = req.query;
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
    });
    const selectedPhoneNumberId = dbUser?.selectedPhoneNumberId;
    
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;
    const searchTerm = (search as string)?.trim();

    let where: any = {
      phoneNumberId: selectedPhoneNumberId,
      userId: user.userId,
      ...(searchTerm ? { name: { contains: searchTerm, mode: 'insensitive' } } : {})
    };

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

    const [broadcasts, total] = await prisma.$transaction([
      prisma.broadcast.findMany({
        where,
        include: { recipients: true },
        skip: offset,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.broadcast.count({
        where,
      }),
    ]);

    res.status(200).json({
      broadcasts,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
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

export const syncTemplatesController = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { id: true, selectedWabaId: true },
    });
    const wabaId = dbUser?.selectedWabaId;
    await syncTemplatesService(wabaId as string);
    res.status(200).json({
      success: true,
      message: "Templates synchronized successfully"
    });
  } catch (error: any) {
    console.error("Error syncing templates:", error);
    res.status(500).json({
      success: false,
      message: "Failed to sync templates",
      error: error.message
    });
  }
};

