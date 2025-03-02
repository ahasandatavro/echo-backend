import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import { preprocessHtmlForWhatsApp } from "../helpers";
import fs from "fs";
import FormData from "form-data";
import { prisma } from "../models/prismaClient";
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
        selectedWabaId: true
      }
    });
    const templates = await prisma.template.findMany({
      where: { userId: user.userId,
        wabaId: userRecord?.selectedWabaId
       },
    });

    const formattedTemplates = templates.map((tmpl:any) => {
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
export const createTemplate = async (req: Request, res: Response) => {
  try {
    const user:any=req.user;
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
