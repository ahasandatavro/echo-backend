import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import { preprocessHtmlForWhatsApp } from "../helpers";
import { resolveContactAttributes } from "../helpers/validation";
import fs from "fs";
import FormData from "form-data";
import { prisma } from "../models/prismaClient";
import { Readable } from "stream";
import { brodcastTemplate } from "../processors/template/templateProcessor";
import { uploadFileToDigitalOcean } from "../routes/replyMaterialRoute";
import { syncTemplates as syncTemplatesService } from "../services/templateService";
import { checkBroadcastAccess, checkTemplateLimit } from "../utils/packageUtils";
import { uploadFileToDigitalOceanHelper } from "../helpers";
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
        rejectedReason: tmpl.rejectionError||"",
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

export const getBroadcastById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: parseInt(id) },
    include: { recipients: { include: { contact: { select: { phoneNumber: true } } } } },
  });
  res.status(200).json(broadcast);
};
export const getAllApprovedTemplates = async (req: Request, res: Response) => {
  try {
    const user: any = req.user;
    const { search } = req.query;
    
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        selectedWabaId: true,
      },
    });
    
    // Build where clause for filtering
    const whereClause: any = { 
      userId: user.userId, 
      wabaId: userRecord?.selectedWabaId, 
      status: "APPROVED" 
    };
    
    // Add search filter if search parameter is provided
    if (search && typeof search === 'string') {
      whereClause.name = {
        contains: search,
        mode: 'insensitive' // Case-insensitive search
      };
    }
    
    //send latests templates first
    const templates = await prisma.template.findMany({
      where: whereClause,
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

function extractFooterVariableNumbers(text:string) {
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


    if (!selectedWabaId) {
      return res.status(400).json({
        error: "No WABA ID selected",
        details: "Please select a WhatsApp Business Account first"
      });
    }

    // Use the configured API version (v22.0)
    const WHATSAPP_GRAPH_API = `${process.env.META_BASE_URL}/${selectedWabaId}/message_templates`;
    console.log("=== DEBUG INFO ===");
    console.log("META_BASE_URL:", process.env.META_BASE_URL);
    console.log("selectedWabaId:", selectedWabaId);
    console.log("Full API URL:", WHATSAPP_GRAPH_API);
    console.log("==================");

    const { name, category, language, draft } = req.body;

    // Validate required parameters
    if (!name || !category || !language) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "name, category, and language are required"
      });
    }

    // Validate template name format
    if (name.length > 512) {
      return res.status(400).json({
        error: "Template name too long",
        details: "Template name must be 512 characters or less"
      });
    }

    // Check for invalid characters in template name
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(name)) {
      return res.status(400).json({
        error: "Invalid template name",
        details: "Template name contains invalid characters"
      });
    }

    // Additional Meta API requirements for template names
    // Template names must start with a letter and contain only alphanumeric characters, underscores, and hyphens
    const validNamePattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    if (!validNamePattern.test(name)) {
      return res.status(400).json({
        error: "Invalid template name format",
        details: "Template name must start with a letter and contain only alphanumeric characters, underscores, and hyphens"
      });
    }

    // Template names must be between 1-512 characters
    if (name.length < 1) {
      return res.status(400).json({
        error: "Template name too short",
        details: "Template name must be at least 1 character long"
      });
    }

    // Validate category
    const validCategories = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
    const normalizedCategory = category.toUpperCase();
    if (!validCategories.includes(normalizedCategory)) {
      return res.status(400).json({
        error: "Invalid category",
        details: `Category must be one of: ${validCategories.join(', ')}`
      });
    }

    // Validate language code format (ISO 639-1 format: xx_XX)
    const validLanguagePattern = /^[a-z]{2}_[A-Z]{2}$/;
    if (!validLanguagePattern.test(language)) {
      return res.status(400).json({
        error: "Invalid language code format",
        details: "Language must be in ISO 639-1 format (e.g., 'en_US', 'es_ES')"
      });
    }

   // console.log("Template parameters:", { name, category, language, draft });

    const saveAsDraftInitial =
      draft === true || draft === 'true';

    const components = JSON.parse(req.body.components || "[]");
    console.log("components",components);
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
const carouselFiles: Express.Multer.File[] = files?.["carouselFiles[]"] || [];



    const file = files?.["file"]?.[0] || null;
    const filePath = file?.path || "";

    // Preprocess components (BODY, HEADER, etc.)
  //  console.log("Processing components:", JSON.stringify(components, null, 2));
    const processedComponents = components.map(async (component: any) => {
      if (
        (component.type === "HEADER" || component.type === "header") &&
        (!component.format || (!component.text?.trim() && !file))
      ) {
        return null;
      }
      if (component.type === "CAROUSEL" || component.type === "carousel") {
        console.log("Processing CAROUSEL component with cards:", component.cards?.length || 0);

        if (!component.cards || !Array.isArray(component.cards) || component.cards.length === 0) {
          console.error("Invalid carousel: missing or empty cards array");
          return null;
        }

        const carouselCards = await Promise.all(component.cards.map(async (card: any, index: number) => {
          console.log(`Processing carousel card ${index}:`, card);

          if (!card.components || !Array.isArray(card.components)) {
            console.error(`Invalid carousel card ${index}: missing components array`);
            return null;
          }

          const cardComponents = await Promise.all(card.components.map(async (c: any) => {
            if ((c.type === "HEADER" || c.type === "header") && (c.format === "IMAGE" || c.format === "image")) {
              const cardFile = carouselFiles[index];

              if (!cardFile) {
                console.warn(`No carousel file found for card ${index}, using existing header_handle`);
                return c; // Return the component as-is if no file is provided
              }

              let fileUrl = "";
              try {
                fileUrl = await uploadFileToDigitalOceanHelper(cardFile);
              } catch (error) {
                console.error(`Error uploading carousel media for card ${index}:`, error);
              }

              const uploadRes = await axios.post(
                `${process.env.META_BASE_URL}/${process.env.META_APP_ID}/uploads`,
                null,
                {
                  params: {
                    file_name: cardFile.originalname,
                    file_length: cardFile.size,
                    file_type: cardFile.mimetype,
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
              //form.append("file", fs.createReadStream(cardFile.path));
              const stream = Readable.from(cardFile.buffer);
              form.append("file", stream, {
                filename: cardFile.originalname,
                contentType: cardFile.mimetype,
              });
              const headers = {
                Authorization: `OAuth ${process.env.META_ACCESS_TOKEN}`,
                file_offset: "0",
                "Content-Length": cardFile.size,
                ...form.getHeaders(),
              };

              const mediaIdRes = await axios.post(
                `${process.env.META_BASE_URL}/${mediaUploadId}`,
                form,
                { headers }
              );

              return {
                type: "HEADER",
                format: "IMAGE",
                example: {header_handle: [ mediaIdRes.data.h] },
              };
            }

            // for body use preprocessHtmlForWhatsApp
            if (c.type === "BODY" || c.type === "body") {
              c.text = preprocessHtmlForWhatsApp(c.text || "");
            }

            // Handle BUTTONS components in carousel cards
            if (c.type === "BUTTONS" || c.type === "buttons") {
              return c;
            }

            return c;
          }));

          return { components: cardComponents };
        }));

        // Filter out null cards
        const validCards = carouselCards.filter(card => card !== null);

        if (validCards.length === 0) {
          console.error("No valid cards in carousel");
          return null;
        }

        // Meta API v22.0 might not support CAROUSEL component type
        // Let's convert it to a regular template with the first card's HEADER component
        const firstCard = validCards[0];
        if (firstCard && firstCard.components && firstCard.components.length > 0) {
          const headerComponent = firstCard.components.find((c: any) => c.type === "HEADER");
          if (headerComponent) {
            console.log("Converting carousel to HEADER component");
            return headerComponent;
          }
        }

        console.log("No valid carousel components found, returning null");
        return null;
      }
      if ((component.type === "HEADER" || component.type === "header") && component.format === "TEXT") {
        const headerText = component.text || "";
        const variableNumbers = extractHeaderVariableNumbers(headerText);

        // If variables are detected in the text, always include example field
        // Meta API requires example field when variables are present
        const hasVariables = variableNumbers.length > 0;

        return {
          ...component,
          text: headerText,
          ...(component.example ? { example: component.example } : {}),
        };
      }

      if (component.type === "BODY" || component.type === "body") {
        let processedText = preprocessHtmlForWhatsApp(
          component.text || ""
        );
        const variableNumbers = extractBodyVariableNumbers(
          processedText
        );

        // Meta API requires BODY text to be between 1-1024 characters
        if (!processedText || processedText.trim().length === 0) {
          console.warn("BODY component has empty text, skipping");
          return null;
        }

        if (processedText.length > 1024) {
          console.warn("BODY text too long, truncating to 1024 characters");
          processedText = processedText.substring(0, 1024);
        }

        // If variables are detected in the text, always include example field
        // Meta API requires example field when variables are present
        const hasVariables = variableNumbers.length > 0;

        return {
          type: "BODY",
          text: processedText,
          ...(component.example ? { example: component.example } : {}),
        };
      }

      if ((component.type === "HEADER" || component.type === "header") && file) {
        let fileUrl = "";
        try{ fileUrl = await uploadFileToDigitalOceanHelper(file);}
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
        //form.append("file", fs.createReadStream(cardFile.path));
        const stream = Readable.from(file.buffer);
        form.append("file", stream, {
          filename: file.originalname,
          contentType: file.mimetype,
          });
        // form.append("file_offset", 0);
        // form.append("file", fs.createReadStream(filePath));
        const headers = {
          Authorization: `OAuth ${process.env.META_ACCESS_TOKEN}`,
          file_offset: "0",
          "Content-Length": file.size,
          ...form.getHeaders(),
        };
        const mediaIdRes = await axios.post(
          `${process.env.META_BASE_URL}/${mediaUploadId}`,
          form,
          { headers }
        );
        if (mediaIdRes.data?.h) {
          // Store fileUrl for later use in database (not sent to Meta API)
          const headerComponent = {
            type: "HEADER",
            format: component.format,
            example: { header_handle: [mediaIdRes.data.h] },
            _fileUrl: fileUrl // Internal property to store DigitalOcean URL
          };
          return headerComponent;
        }
        throw new Error("Failed to upload media to WhatsApp");
      }

      // Handle FOOTER component
      if (component.type === "FOOTER" || component.type === "footer") {
        const footerText = component.text || "";

        // Meta API requires FOOTER text to be between 1-60 characters
        if (!footerText || footerText.trim().length === 0) {
          console.warn("FOOTER component has empty text, skipping");
          return null;
        }

        if (footerText.length > 60) {
          console.warn("FOOTER text too long, truncating to 60 characters");
          const truncatedText = footerText.substring(0, 60);
          return {
            type: "FOOTER",
            text: truncatedText,
          };
        }

        // Extract variables from footer text
        const variableNumbers = extractFooterVariableNumbers(footerText);

        // If variables are detected in the text, always include example field
        // Meta API requires example field when variables are present
        const hasVariables = variableNumbers.length > 0;

        return {
          type: "FOOTER",
          text: footerText,
        };
      }
    }

    // Handle BUTTONS components
    if (component.type === "BUTTONS" || component.type === "buttons") {
      // Process buttons to add examples for dynamic URLs
      const processedButtons = component.buttons?.map((button: any) => {
        if (button.type === "URL" && button.url && /\{\{(\d+)\}\}/.test(button.url)) {
          // Extract variable numbers from URL
          const matches = button.url.match(/\{\{(\d+)\}\}/g);
          const variableNumbers = matches ? matches.map((match: string) => match.replace(/\{\{(\d+)\}\}/, '$1')) : [];

          // Get example values from component.example.button_url array
          let exampleValues = ["example-value"]; // fallback
          if (component.example && component.example.button_url && Array.isArray(component.example.button_url)) {
            // Use the button_url array values, matching by variable number index
            exampleValues = variableNumbers.map((num: string, index: number) => {
              return component.example.button_url[index] || `example-${num}`;
            });
          }
          button.example = exampleValues[0];
          return {
            ...button,
          };
        }
        return button;
      });
      // Remove example property from BUTTONS component
      const { example, ...componentWithoutExample } = component;
      return {
        ...componentWithoutExample,
        buttons: processedButtons || component.buttons,
      };
    }

    return component;
    });

    const resolvedComponents = await Promise.all(
      processedComponents
    );

    // Filter out null components
    const filteredComponents = resolvedComponents.filter(component => component !== null);

    console.log("Final filtered components:", JSON.stringify(filteredComponents, null, 2));

    if (filteredComponents.length === 0) {
      return res.status(400).json({
        error: "No valid components found",
        details: "All components were filtered out during processing"
      });
    }

    // Ensure we have at least one valid component
    const validComponents = filteredComponents.filter(comp => comp && comp.type);
    console.log("Components with fileUrl:", validComponents.filter(comp => comp._fileUrl).map(comp => ({ type: comp.type, fileUrl: comp._fileUrl })));
    if (validComponents.length === 0) {
      return res.status(400).json({
        error: "No valid components found",
        details: "All components are invalid or missing type"
      });
    }

    // Create clean components for Meta API (remove internal properties)
    const metaApiComponents = validComponents.map(comp => {
      if (comp._fileUrl) {
        // Remove _fileUrl from component sent to Meta API
        const { _fileUrl, ...cleanComponent } = comp;
        return cleanComponent;
      }
      return comp;
    });

    // Validate template structure according to Meta API requirements
    const headerComponents = metaApiComponents.filter(comp => comp.type === "HEADER");
    const bodyComponents = metaApiComponents.filter(comp => comp.type === "BODY");
    const footerComponents = metaApiComponents.filter(comp => comp.type === "FOOTER");
    const buttonComponents = metaApiComponents.filter(comp => comp.type === "BUTTONS");

    // Meta API requirements:
    // 1. Only one HEADER component allowed
    if (headerComponents.length > 1) {
      return res.status(400).json({
        error: "Invalid template structure",
        details: "Only one HEADER component allowed per template"
      });
    }

    // 2. Only one BODY component allowed
    if (bodyComponents.length > 1) {
      return res.status(400).json({
        error: "Invalid template structure",
        details: "Only one BODY component allowed per template"
      });
    }

    // 3. Only one FOOTER component allowed
    if (footerComponents.length > 1) {
      return res.status(400).json({
        error: "Invalid template structure",
        details: "Only one FOOTER component allowed per template"
      });
    }

    // 4. Only one BUTTONS component allowed
    if (buttonComponents.length > 1) {
      return res.status(400).json({
        error: "Invalid template structure",
        details: "Only one BUTTONS component allowed per template"
      });
    }

    // 5. Template must have at least one component
    if (metaApiComponents.length === 0) {
      return res.status(400).json({
        error: "Invalid template structure",
        details: "Template must have at least one component"
      });
    }

    // 6. For MARKETING templates, BODY is required
    if (normalizedCategory === "MARKETING" && bodyComponents.length === 0) {
      return res.status(400).json({
        error: "Invalid template structure",
        details: "MARKETING templates must have a BODY component"
      });
    }

    // 7. Validate component content
    for (const comp of metaApiComponents) {
      if (comp.type === "BODY" && (!comp.text || comp.text.trim().length === 0)) {
        return res.status(400).json({
          error: "Invalid BODY component",
          details: "BODY component must have non-empty text"
        });
      }

      if (comp.type === "FOOTER" && (!comp.text || comp.text.trim().length === 0)) {
        return res.status(400).json({
          error: "Invalid FOOTER component",
          details: "FOOTER component must have non-empty text"
        });
      }

      if (comp.type === "HEADER" && comp.format === "TEXT" && (!comp.text || comp.text.trim().length === 0)) {
        return res.status(400).json({
          error: "Invalid HEADER component",
          details: "TEXT HEADER component must have non-empty text"
        });
      }
    }

    // Transform buttons
    const buttonsData: ButtonData[] = JSON.parse(
      req.body.buttons || "[]"
    );
    console.log("Original buttons data:", buttonsData);

    if (buttonsData.length > 0) {
      // Validate button count (Meta API allows max 3 buttons)
      if (buttonsData.length > 3) {
        return res.status(400).json({
          error: "Too many buttons",
          details: "Maximum 3 buttons allowed per template"
        });
      }

      const metaButtons = buttonsData.map((button, index) => {
        const {
          urlType,
          label,
          phone,
          url,
        } = button;
        switch (button.type) {
          case "Call Phone":
            const phoneButtonText = label || "Call";

            // Validate button text length (Meta API limit is 25 characters)
            if (phoneButtonText.length > 25) {
              throw new Error(`Button text "${phoneButtonText}" is too long. Maximum 25 characters allowed.`);
            }

            return {
              type: "VOICE_CALL",
              text: phoneButtonText,
              phone_number: phone || "",
            };

          case "Visit Website": {
            const urlTemplate = url || "";
            const buttonText = label || "Visit us";

            // Validate button text length (Meta API limit is 25 characters)
            if (buttonText.length > 25) {
              throw new Error(`Button text "${buttonText}" is too long. Maximum 25 characters allowed.`);
            }
            // Extract variable numbers from URL
            const matches = urlTemplate.match(/\{\{(\d+)\}\}/g);
            const variableNumbers = matches ? matches.map((match: string) => match.replace(/\{\{(\d+)\}\}/, '$1')) : [];
            let exampleValues = ["example-value"]; // fallback
            if (components.example && components.example.button_url && Array.isArray(components.example.button_url)) {
              // Use the button_url array values, matching by variable number index
              exampleValues = variableNumbers.map((num: string, index: number) => {
                return components.example.button_url[index] || `example-${num}`;
              });
            }// fallback

            const btn: any = {
              type: "URL",
              text: buttonText,
              url: urlTemplate,
              example: exampleValues
            };
            return btn;
          }

          case "Copy offer code":
            const copyButtonText = label || "Copy Code";

            // Validate button text length (Meta API limit is 25 characters)
            if (copyButtonText.length > 25) {
              throw new Error(`Button text "${copyButtonText}" is too long. Maximum 25 characters allowed.`);
            }

            return {
              type: "COPY_CODE",
              text: copyButtonText,
            };

          case "Quick replies":
          default:
            const buttonText = label || "Reply";

            // Validate button text length (Meta API limit is 25 characters)
            if (buttonText.length > 25) {
              throw new Error(`Button text "${buttonText}" is too long. Maximum 25 characters allowed.`);
            }

            return {
              type: "QUICK_REPLY",
              text: buttonText,
            };
        }
      });

      console.log("Transformed meta buttons:", metaButtons);

      // Create BUTTONS component with example if needed
      const buttonsComponent: any = {
        type: "BUTTONS",
        buttons: metaButtons,
      };

      // Add example if any button has variables
      const hasButtonVariables = buttonsData.some(button => {
        if (button.type === "Visit Website" && button.url) {
          return /\{\{(\d+)\}\}/.test(button.url);
        }
        return false;
      });

      if (hasButtonVariables) {
        buttonsComponent.example = {
          button_text: ["example-value"]
        };
      }

      validComponents.push(buttonsComponent);
    }

    let response: any;
    let saveAsDraft = saveAsDraftInitial;

    if (!saveAsDraft) {
      console.log("Template payload being sent:\n", JSON.stringify({
        name,
        language,
        category,
        components: filteredComponents
      }, null, 2));

      try {
        // Test if the WABA ID is valid first
        console.log("Testing WABA ID validity...");

        // Try different API versions to see which one works
        const apiVersions = ['v17.0', 'v18.0', 'v19.0', 'v20.0', 'v21.0', 'v22.0'];
        let workingVersion = null;

        for (const version of apiVersions) {
          try {
            const testUrl = `https://graph.facebook.com/${version}/${selectedWabaId}?fields=id,name&access_token=${process.env.META_ACCESS_TOKEN}`;
            console.log(`Testing with API version ${version}:`, testUrl);
            const testResponse = await axios.get(testUrl);
            console.log(`API version ${version} works:`, testResponse.data);
            workingVersion = version;
            break;
          } catch (testErr: any) {
            console.log(`API version ${version} failed:`, testErr.response?.status);
          }
        }

        if (!workingVersion) {
          console.error("All API versions failed for WABA ID:", selectedWabaId);

          // Let's also check if this is actually a WABA ID by trying to get the user's WABAs
          try {
            const userWabasUrl = `https://graph.facebook.com/v17.0/me/accounts?access_token=${process.env.META_ACCESS_TOKEN}`;
            console.log("Checking user's WABAs:", userWabasUrl);
            const userWabasResponse = await axios.get(userWabasUrl);
            console.log("User's WABAs:", userWabasResponse.data);

            return res.status(400).json({
              error: "Invalid WABA ID",
              details: `WABA ID ${selectedWabaId} not found. Please check your WhatsApp Business Account selection.`
            });
          } catch (wabaErr: any) {
            return res.status(400).json({
              error: "Invalid WABA ID or access token",
              details: "Could not verify WhatsApp Business Account with any API version"
            });
          }
        }

        console.log("Using working API version:", workingVersion);
        // Update the API URL to use the working version
        const workingApiUrl = `https://graph.facebook.com/${workingVersion}/${selectedWabaId}/message_templates`;
        console.log("Updated API URL:", workingApiUrl);

        console.log("Making template creation request...");

        // Final validation of the payload
        const finalPayload = {
          name,
          category: normalizedCategory,
          language,
          components: metaApiComponents,
        };

        // Validate that all required fields are present
        if (!finalPayload.name || !finalPayload.category || !finalPayload.language || !finalPayload.components) {
          return res.status(400).json({
            error: "Missing required fields",
            details: "Template payload is missing required fields"
          });
        }

        // Validate components array is not empty
        if (!Array.isArray(finalPayload.components) || finalPayload.components.length === 0) {
          return res.status(400).json({
            error: "No components",
            details: "Template must have at least one component"
          });
        }

        console.log("Meta API payload:", JSON.stringify(finalPayload, null, 2));
        response = await axios.post(
          workingApiUrl,
          finalPayload,
          {
            headers: {
              Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 20000,
          }
        );
        console.log("Template created successfully:\n", JSON.stringify(response.data, null, 2));
      }
      catch (err: any) {
        console.error("Meta API call failed:");
        console.error("Error status:", err.response?.status);
        console.error("Error status text:", err.response?.statusText);
        console.error("Error headers:", err.response?.headers);
        console.error("Error data:", err.response?.data);
        console.error("Error message:", err.message);

        // Check for HTML response (usually indicates wrong URL or API version)
        if (err.response?.headers?.['content-type']?.includes('text/html')) {
          console.error("Received HTML response instead of JSON - likely wrong API URL or version");
          return res.status(400).json({
            error: "API Configuration Error",
            details: "Received HTML response. Please check API URL and version configuration."
          });
        }
        if (err.response?.status === 401) {
          return res.status(401).json({
            error: "Authentication failed",
            details: "Invalid or expired access token"
          });
        }

        if (err.response?.status === 403) {
          return res.status(403).json({
            error: "Permission denied",
            details: "Insufficient permissions to create templates"
          });
        }

        if (err.response?.status === 400) {
          const errorData = err.response?.data;
          console.error("Meta API 400 error details:", JSON.stringify(errorData, null, 2));

          // Extract specific error information
          let errorMessage = "Invalid template format";
          let errorDetails = "";

          if (errorData?.error?.message) {
            errorMessage = errorData.error.message;
          }

          if (errorData?.error?.error_data?.details) {
            errorDetails = errorData.error.error_data.details;
          } else if (errorData?.error?.error_subcode) {
            errorDetails = `Error subcode: ${errorData.error.error_subcode}`;
          }

          return res.status(400).json({
            error: errorMessage,
            details: errorDetails || "Please check template structure and content",
            metaErrorCode: errorData?.error?.code,
            metaErrorSubcode: errorData?.error?.error_subcode
          });
        }

        // For other errors, save as draft
        saveAsDraft = true;
        return res.status(400).json({
          error: "Template creation failed",
          details: err.response?.data?.error?.message || err.message,
        });
       }
    }

    // Create components for database storage (include fileUrl if available)
    const dbComponents = validComponents.map(comp => {
      if (comp._fileUrl) {
        // Include fileUrl in database storage
        return {
          ...comp,
          url: comp._fileUrl // Add url property for database storage
        };
      }
      return comp;
    });

    const templateContent = {
      name,
      parameter_format: "POSITIONAL",
      components: dbComponents,
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
      where: { name: name},
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
    if (saveAsDraft) {
      return res.status(201).json(dbTemplate);
    }
    return res.status(201).json(dbTemplate);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to create template",
      details: error.response?.data || "",
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

interface TemplateComponent {
  type: string;
  text?: string;
  format?: string;
  url?: string;
  buttons?: Array<{
    type: string;
    text: string;
    url?: string;
    phone_number?: string;
  }>;
}

interface TemplateData {
  components: TemplateComponent[];
}

/**
 * Substitute parameters in template components
 */
export function substituteTemplateParameters(
  templateContent: string,
  parameters: Record<string, string>
): string {
  try {
    const templateData: TemplateData = JSON.parse(templateContent);

    // Create a deep copy to avoid mutating the original
    const modifiedComponents = templateData.components.map(component => {
      const newComponent = { ...component };

      // Handle text components (HEADER, BODY, FOOTER)
      if (newComponent.text) {
        newComponent.text = substituteParametersInText(newComponent.text, parameters);
      }

      // Handle buttons with URL parameters
      if (newComponent.buttons) {
        newComponent.buttons = newComponent.buttons.map(button => {
          const newButton = { ...button };
          if (newButton.url) {
            newButton.url = substituteParametersInText(newButton.url, parameters);
          }
          return newButton;
        });
      }

      return newComponent;
    });

    return JSON.stringify({ ...templateData, components: modifiedComponents });
  } catch (error) {
    console.error("Error substituting template parameters:", error);
    return templateContent; // Return original if parsing fails
  }
}

/**
 * Substitute parameters in a text string
 */
function substituteParametersInText(text: string, parameters: Record<string, string>): string {
  let result = text;

  // Replace {{n}} placeholders with parameter values
  Object.entries(parameters).forEach(([key, value]) => {
    // Convert parameter keys to the format expected by the template
    // e.g., "header_0" -> "0", "body_1" -> "1"
    const paramIndex = key.split('_').pop();
    if (paramIndex) {
      const placeholder = `{{${paramIndex}}}`;
      result = result.replace(new RegExp(placeholder, 'g'), value);
    }
  });

  return result;
}

/**
 * Extract parameter placeholders from template content
 */
export function extractTemplateParameters(templateContent: string): string[] {
  try {
    const templateData: TemplateData = JSON.parse(templateContent);
    const parameters = new Set<string>();

    templateData.components?.forEach(component => {
      // Extract from text components
      if (component.text) {
        const matches = component.text.match(/\{\{(\d+)\}\}/g);
        matches?.forEach(match => parameters.add(match));
      }

      // Extract from button URLs
      component.buttons?.forEach(button => {
        if (button.url) {
          const matches = button.url.match(/\{\{(\d+)\}\}/g);
          matches?.forEach(match => parameters.add(match));
        }
      });
    });

    return Array.from(parameters).sort();
  } catch (error) {
    console.error("Error extracting template parameters:", error);
    return [];
  }
}

/**
 * Validate that all required parameters are provided
 */
export function validateTemplateParameters(
  templateContent: string,
  parameters: Record<string, string>
): { isValid: boolean; missingParams: string[] } {
  const requiredParams = extractTemplateParameters(templateContent);
  const providedParams = Object.keys(parameters).map(key => {
    const paramIndex = key.split('_').pop();
    return paramIndex ? `{{${paramIndex}}}` : null;
  }).filter(Boolean) as string[];

  const missingParams = requiredParams.filter(param => !providedParams.includes(param));

  return {
    isValid: missingParams.length === 0,
    missingParams
  };
}
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

    const {
      broadcastName,
      templateName,
      userId,
      contacts,
      chatbotId,
      scheduledDateTime,
      templateParameters
    } = req.body;
    let fileUrl = "";
    if (req.file) {
      fileUrl = await uploadFileToDigitalOceanHelper(req.file);
    }
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
      select: { id: true, selectedPhoneNumberId: true },
    });

    const phoneNumberId = dbUser?.selectedPhoneNumberId;
    if (!phoneNumberId) {
      return res.status(400).json({ message: "No phone number selected." });
    }

    // Get the template to validate parameters
    const bp = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: phoneNumberId }
    });

    const businessAccount = await prisma.businessAccount.findFirst({
      where: { id: bp?.businessAccountId }
    });

    const dbTpl = await prisma.template.findUnique({
      where: { name: templateName, wabaId: businessAccount?.metaWabaId },
    });

    if (!dbTpl || !dbTpl.content) {
      return res.status(400).json({
        success: false,
        message: `Template "${templateName}" not found or has no content`
      });
    }

    // Validate template parameters if provided
    if (templateParameters && Object.keys(templateParameters).length > 0) {
      const validation = validateTemplateParameters(dbTpl.content, templateParameters);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          message: `Missing required template parameters: ${validation.missingParams.join(', ')}`
        });
      }
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
        broadcastId: broadcast.id,
        templateParameters,
        fileUrl
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
        await broadcastTemplate(
          phoneNumber,
          templateName,
          chatbotId,
          broadcast.id,
          phoneNumberId,
          templateParameters,
          fileUrl // Pass parameters to broadcast function
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

export const broadcastTemplate = async (
  recipient: string,
  selectedTemplate: string,
  chatbotId: number,
  broadcastId: number,
  phoneNumberId?: string,
  templateParameters?: Record<string, string>,
  fileUrl?: string
) => {
  try {
    if(typeof templateParameters === 'string') {
      templateParameters = JSON.parse(templateParameters);
    }

    const bp = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: phoneNumberId }
    });

    const businessAccount = await prisma.businessAccount.findFirst({
      where: { id: bp?.businessAccountId }
    });

    const dbTpl = await prisma.template.findUnique({
      where: { name: selectedTemplate, wabaId: businessAccount?.metaWabaId },
    });

    if (!dbTpl || !dbTpl.content) {
      throw new Error(`Template "${selectedTemplate}" not found or has no content`);
    }

    // Substitute template parameters if provided
    let processedTemplateContent = dbTpl.content;
    if (templateParameters && Object.keys(templateParameters).length > 0) {
      processedTemplateContent = substituteTemplateParameters(dbTpl.content, templateParameters);
    }

    // Parse the processed template content
    const tplDef: {
      components: Array<{
        type: string;
        text?: string;
        format?: string;
        url?: string;
        example?: {
          header_handle?: string[];
          header_text?: string[];
          url?: string;
        };
        buttons?: Array<{
          type: string;
          text: string;
          url?: string;
          phone_number?: string;
        }>;
      } | null>;
    } = JSON.parse(processedTemplateContent);

    // Build the send-payload components array
    const sendComponents: any[] = [];

    for (const c of tplDef.components) {
      if (!c) continue;

      if (c.type === "HEADER") {
        if (c.format === "IMAGE" && c.example?.header_handle) {
          // Only add header component if we have a fileUrl or URL
          if (fileUrl || c.url) {
            sendComponents.push({
              type: "header",
              parameters: [
                {
                  type: "image",
                  image: {
                    link: fileUrl || c.url
                  }
                }
              ]
            });
          }
        } else if (c.format === "TEXT" && c.text) {
          const matches = Array.from(c.text.matchAll(/\{\{(\d+)\}\}/g));
          if (matches.length > 0) {
            const params = matches.map(async m => {
              const paramNum = m[1];
              const key = `header_${paramNum}`;
              const paramText = templateParameters?.[key] ?? "";
              const resolvedText = await resolveContactAttributes(paramText, recipient);
              return {
                type: "text" as const,
                text: resolvedText
              };
            });
            // Only add header component if we have parameters
            const resolvedParams = await Promise.all(params);
            if (resolvedParams.some(param => param.text && param.text.trim() !== "")) {
              sendComponents.push({
                type: "header",
                parameters: resolvedParams
              });
            }
          }
        }
      }

      if (c.type === "BODY" && c.text && c.text.trim().length > 0) {
        const matches = Array.from(c.text.matchAll(/\{\{(\d+)\}\}/g));
        if (matches.length > 0) {
          const params = matches.map(async m => {
            const paramNum = m[1];
            const key = `body_${paramNum}`;
            const paramText = templateParameters?.[key] ?? "";
            const resolvedText = await resolveContactAttributes(paramText, recipient);
            return {
              type: "text" as const,
              text: resolvedText
            };
          });
          // Only add body component if we have parameters
          const resolvedParams = await Promise.all(params);
          if (resolvedParams.some(param => param.text && param.text.trim() !== "")) {
            sendComponents.push({
              type: "body",
              parameters: resolvedParams
            });
          }
        }
        // Don't add body component if no parameters - let WhatsApp use the template as-is
      }

      if (c.type === "FOOTER" && c.text) {
        const matches = Array.from(c.text.matchAll(/\{\{(\d+)\}\}/g));
        if (matches.length > 0) {
          const params = matches.map(async m => {
            const paramNum = m[1];
            const key = `footer_${paramNum}`;
            const paramText = templateParameters?.[key] ?? "";
            const resolvedText = await resolveContactAttributes(paramText, recipient);
            return {
              type: "text" as const,
              text: resolvedText
            };
          });
          // Only add footer component if we have parameters
          const resolvedParams = await Promise.all(params);
          if (resolvedParams.some(param => param.text && param.text.trim() !== "")) {
            sendComponents.push({
              type: "footer",
              parameters: resolvedParams
            });
          }
        }
        // Don't add footer component if no parameters
      }

      if (c.type === "BUTTONS" && Array.isArray(c.buttons) && c.buttons.length > 0) {
        c.buttons.forEach((btn, buttonIndex) => {
          if (btn.type === "URL" && btn.url) {
            const matches = Array.from(btn.url.matchAll(/\{\{(\d+)\}\}/g));
            if (matches.length > 0) {
              const params = matches.map(m => {
                const paramNum = m[1];
                const key = `button_${buttonIndex}_${paramNum}`;
                return {
                  type: "text" as const,
                  text: templateParameters?.[key] ?? ""
                };
              });
              // Only add button component if we have parameters
              if (params.some(param => param.text && param.text.trim() !== "")) {
                sendComponents.push({
                  type: "button",
                  sub_type: "url",
                  index: buttonIndex.toString(),
                  parameters: params
                });
              }
            }
          }

          if ((btn.type === "PHONE_NUMBER" || btn.type === "VOICE_CALL") && btn.phone_number) {
            // For phone buttons, we don't need parameters, so we can add them
            sendComponents.push({
              type: "button",
              sub_type: "voice_call",
              index: buttonIndex.toString()
            });
          }

          if (btn.type === "QUICK_REPLY" || btn.type === "Quick replies") {
            // For quick reply buttons, we don't need parameters, so we can add them
            sendComponents.push({
              type: "button",
              sub_type: "quick_reply",
              index: buttonIndex.toString()
            });
          }

          if (btn.type === "COPY_CODE" || btn.type === "Copy offer code") {
            // For copy code buttons, we don't need parameters, so we can add them
            sendComponents.push({
              type: "button",
              sub_type: "copy_code",
              index: buttonIndex.toString()
            });
          }
        });
      }
    }

    const templatePayload: any = {
      name: selectedTemplate,
      language: { code: dbTpl.language }
    };

    if (sendComponents.length > 0) {
      templatePayload.components = sendComponents;
    }

    const url = `${process.env.META_BASE_URL}/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: recipient,
      biz_opaque_callback_data: broadcastId ? `broadcastId=${broadcastId}` : undefined,
      type: "template",
      template: templatePayload
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

  } catch (error: any) {
    console.error("Error sending template message:", error.response?.data?.error?.message || error.message);
    console.error("Full error response:", JSON.stringify(error.response?.data, null, 2));
    return {
      success: false,
      message: error.response?.data?.error?.message || error.message,
      error: error.response?.data
    }
    throw error;
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

    const { id } = req.params;
    const { scheduledDateTime, name } = req.body;

  const broadcast = await prisma.broadcast.findUnique({
    where: { id: parseInt(id) },
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
    else {
      if (name) {
      await prisma.broadcast.update({
        where: { id: broadcast.id },
          data: { name }
        });
      }
    }
  } catch (error: any) {
    console.error("Error updating broadcast:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update broadcast",
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
    const { startDate, endDate, dateRange, page = "1", limit = "10", search, sortBy = "Latest", status } = req.query;
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
      ...(searchTerm ? { name: { contains: searchTerm, mode: 'insensitive' } } : {}),
      ...(status ? { status } : {})
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
      else if (dateRange === "Last6months") {
        start = new Date(today);
        start.setMonth(today.getMonth() - 6);
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
    //send contact phoneNumber for those who have broadcasted

    // Determine sort order based on sortBy parameter
    const sortOrder = sortBy === "Oldest" ? 'asc' : 'desc';

    const [broadcasts, total] = await prisma.$transaction([
      prisma.broadcast.findMany({
        where,
        include: { recipients: { include: { contact: { select: { phoneNumber: true } } } } },
        skip: offset,
        take: limitNum,
        orderBy: { createdAt: sortOrder },
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
    await syncTemplatesService(wabaId as string, dbUser?.id as number);
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

export const trackTemplateClick = async (req: Request, res: Response) => {
  try {
    const { templateId, url } = req.query;

    if (!templateId || !url) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "templateId and url are required"
      });
    }

    const templateIdNum = parseInt(templateId as string, 10);
    if (isNaN(templateIdNum)) {
      return res.status(400).json({
        error: "Invalid template ID",
        details: "templateId must be a valid number"
      });
    }

    // Check if template exists
    const template = await prisma.template.findUnique({
      where: { id: templateIdNum }
    });

    if (!template) {
      return res.status(404).json({
        error: "Template not found",
        details: `Template with ID ${templateIdNum} does not exist`
      });
    }

    // Increment click count
    await prisma.templateClick.upsert({
      where: { templateId: templateIdNum },
      update: {
        clickCount: {
          increment: 1
        }
      },
      create: {
        templateId: templateIdNum,
        clickCount: 1
      }
    });

    // Decode the URL and redirect
    const decodedUrl = decodeURIComponent(url as string);

    // Redirect to the original URL
    res.redirect(decodedUrl);

  } catch (error: any) {
    console.error("Error tracking template click:", error);
    res.status(500).json({
      error: "Failed to track template click",
      details: error.message
    });
  }
};

