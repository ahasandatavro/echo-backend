import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_WHATSAPP_BUSINESS_ID = process.env.META_WHATSAPP_BUSINESS_ID;
const WHATSAPP_GRAPH_API = `https://graph.facebook.com/v18.0/${META_WHATSAPP_BUSINESS_ID}/message_templates`;

// Axios instance with headers
const axiosInstance = axios.create({
  headers: {
    Authorization: `Bearer ${META_ACCESS_TOKEN}`,
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
    const { name, category, language, components } = req.body;

    const response = await axiosInstance.post(WHATSAPP_GRAPH_API, {
      name,
      category,
      language,
      components,
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
