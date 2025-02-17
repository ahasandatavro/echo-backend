import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import { preprocessHtmlForWhatsApp } from "../helpers";
import fs from "fs";
import FormData from "form-data";

dotenv.config();


const WHATSAPP_GRAPH_API = `${process.env.META_BASE_URL}/${process.env.META_WHATSAPP_BUSINESS_ID}/message_templates`;

// Axios instance with headers
const axiosInstance = axios.create({
  headers: {
    Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
});

// **Get All Templates**
export const getAllTemplates = async (_req: Request, res: Response) => {
  try {
    const response = await axiosInstance.get(WHATSAPP_GRAPH_API);
    res.status(200).json(response.data);
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
