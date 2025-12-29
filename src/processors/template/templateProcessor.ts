import { metaWhatsAppAPI } from "../../config/metaConfig";
import axios from "axios";
import { prisma } from "../../models/prismaClient";


// export const brodcastTemplate = async (
//   recipient: string,
//   selectedTemplate: string,    // this is the Template.name
//   chatbotId: number,
//   broadcastId: number,
//   phoneNumberId?: string
// ) => {
//   // 1. fetch the saved template record
//   const dbTpl = await prisma.template.findUnique({
//     where: { name: selectedTemplate },
//   });
//   if (!dbTpl || !dbTpl.content) {
//     throw new Error(`Template "${selectedTemplate}" not found or has no content`);
//   }

//   // 2. parse its content JSON
//   const tplDef: {
//     components: Array<{
//       type: string;
//       text?: string;
//       buttons?: Array<{
//         type: string;
//         text: string;
//         url?: string;
//         phone_number?: string;
//       }>;
//     } | null>;
//     // we ignore header/example in this sample
//   } = JSON.parse(dbTpl.content);

//   // 3. build the send-payload components array
//   const sendComponents: any[] = [];

//   tplDef.components.forEach((c, idx) => {
//     if (!c) return;

//     if (c.type === "BODY" && c.text) {
//       // extract all {{n}} placeholders
//       const matches = Array.from(c.text.matchAll(/\{\{(\d+)\}\}/g));
//       const params = matches.map(m => ({
//         type: "text" as const,
//         text: /* you'll need to supply these at call-time */ ""
//       }));
//       sendComponents.push({
//         type: "body",
//         parameters: params
//       });
//     }

//     if (c.type === "BUTTONS" && Array.isArray(c.buttons)) {
//       c.buttons.forEach((btn, buttonIndex) => {
//         if (btn.type === "URL" && btn.url) {
//           // find URL placeholders
//           const matches = Array.from(btn.url.matchAll(/\{\{(\d+)\}\}/g));
//           const params = matches.map(m => ({
//             type: "text" as const,
//             text: /* supply the matching value for each {{n}} */
//               "today"
//           }));

//           sendComponents.push({
//             type: "button",
//             sub_type: "url",
//             index: buttonIndex.toString(),
//             parameters: params
//           });
//         }

//         if (btn.type === "PHONE_NUMBER" && btn.phone_number) {
//           sendComponents.push({
//             type: "button",
//             sub_type: "phone_number",
//             index: buttonIndex.toString(),
//             parameters: [
//               { type: "phone_number" as const, phone_number: btn.phone_number }
//             ]
//           });
//         }

//         if (btn.type === "QUICK_REPLY") {
//           sendComponents.push({
//             type: "button",
//             sub_type: "quick_reply",
//             index: buttonIndex.toString(),
//             parameters: [
//               { type: "text" as const, text: btn.text }
//             ]
//           });
//         }
//       });
//     }
//   });

//   // 4. assemble full send payload
//   const payload: any = {
//     messaging_product: "whatsapp",
//     to: recipient,
//     type: "template",
//     template: {
//       name: selectedTemplate,
//       language: { code: dbTpl.language },
//       components: sendComponents
//     }
//   };
//   if (broadcastId) {
//     payload.biz_opaque_callback_data = `broadcastId=${broadcastId}`;
//   }

//   // 5. send it
//   const url = `${process.env.META_BASE_URL}/${phoneNumberId}/messages`;
//   await axios.post(url, payload, {
//     headers: {
//       Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
//       "Content-Type": "application/json"
//     }
//   });
//   //add try catch
//   try {
//     await axios.post(url, payload, {
//       headers: {
//         Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
//         "Content-Type": "application/json"  
//       }
//     });
//   } catch (error: any) {
//     console.error("Error sending template message:", error.response.data.error.message);
//     throw error;
//   }
  
// };

export const brodcastTemplate = async (
    recipient: string,
    selectedTemplate: string,
    chatbotId: number,
    broadcastId: number,
    phoneNumberId?: string
  ) => {
    try {
      const bp=await prisma.businessPhoneNumber.findFirst({
        where:{
          metaPhoneNumberId:phoneNumberId
        }
      });
      const businessAccount= await prisma.businessAccount.findFirst({
        where:{
          id:bp?.businessAccountId
        }
      })
      const dbTpl = await prisma.template.findFirst({
        where: { name: selectedTemplate, wabaId: businessAccount?.metaWabaId },
      });
      if (!dbTpl || !dbTpl.content) {
        throw new Error(`Template "${selectedTemplate}" not found or has no content`);
      }

  // 2. parse its content JSON
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
  } = JSON.parse(dbTpl.content);

  // 3. build the send-payload components array
  const sendComponents: any[] = [];
  
  console.log("Template components to process:", tplDef.components);

  tplDef.components.forEach((c, idx) => {
    if (!c) return;

    if (c.type === "HEADER") {
      if (c.format === "IMAGE" && c.example?.header_handle) {
        // Handle image header - use header_handle from Meta API
        sendComponents.push({
          type: "header",
          parameters: [
            {
              type: "image",
              image: {
                link: c.url // Use the header_handle from Meta API
              }
            }
          ]
        });
      } else if (c.format === "TEXT" && c.text) {
        // Handle text header
        const matches = Array.from(c.text.matchAll(/\{\{(\d+)\}\}/g));
        const params = matches.map(m => ({
          type: "text" as const,
          text: /* you'll need to supply these at call-time */ ""
        }));
        sendComponents.push({
          type: "header",
          parameters: params
        });
      }
    }

    if (c.type === "BODY" && c.text && c.text.trim().length > 0) {
      // extract all {{n}} placeholders
      const matches = Array.from(c.text.matchAll(/\{\{(\d+)\}\}/g));
      if (matches.length > 0) {
        const params = matches.map(m => ({
          type: "text" as const,
          text: /* you'll need to supply these at call-time */ ""
        }));
        sendComponents.push({
          type: "body",
          parameters: params
        });
      } else {
        // No placeholders, just send body without parameters
        sendComponents.push({
          type: "body"
        });
      }
    }

    if (c.type === "FOOTER" && c.text) {
      // Handle footer component
      const matches = Array.from(c.text.matchAll(/\{\{(\d+)\}\}/g));
      const params = matches.map(m => ({
        type: "text" as const,
        text: /* you'll need to supply these at call-time */ ""
      }));
      sendComponents.push({
        type: "footer",
        parameters: params
      });
    }

    if (c.type === "BUTTONS" && Array.isArray(c.buttons) && c.buttons.length > 0) {
      // Valid Meta API button sub_types: CATALOG, COPY_CODE, FLOW, MPM, ORDER_DETAILS, QUICK_REPLY, REMINDER, URL, VOICE_CALL
      console.log("Processing buttons:", c.buttons);
      c.buttons.forEach((btn, buttonIndex) => {
        console.log(`Processing button ${buttonIndex}:`, btn);
        if (btn.type === "URL" && btn.url) {
          // For URL buttons, we need to provide the URL as a parameter
          sendComponents.push({
            type: "button",
            sub_type: "url",
            index: buttonIndex.toString(),
            parameters: [
              {
                type: "text",
                text: btn.url // Use the actual URL from the template
              }
            ]
          });
        }

        if ((btn.type === "PHONE_NUMBER" || btn.type === "VOICE_CALL") && btn.phone_number) {
          sendComponents.push({
            type: "button",
            sub_type: "voice_call",
            index: buttonIndex.toString()
            // VOICE_CALL buttons don't need parameters - phone number is defined in template
          });
        }

        if (btn.type === "QUICK_REPLY" || btn.type === "Quick replies") {
          sendComponents.push({
            type: "button",
            sub_type: "quick_reply",
            index: buttonIndex.toString()
            // QUICK_REPLY buttons don't need parameters - text is defined in template
          });
        }

        if (btn.type === "COPY_CODE" || btn.type === "Copy offer code") {
          sendComponents.push({
            type: "button",
            sub_type: "copy_code",
            index: buttonIndex.toString()
            // COPY_CODE buttons don't need parameters - text is defined in template
          });
        }
      });
    }
  });
  
  console.log("Send components built:", sendComponents);
  
  // Only include components if there are any
  const templatePayload: any = {
    name: selectedTemplate,
    language: { code: dbTpl.language }
  };
  
  if (sendComponents.length > 0) {
    templatePayload.components = sendComponents;
  }
  
  const url = `${metaWhatsAppAPI.baseURL}/${phoneNumberId}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: recipient,
        biz_opaque_callback_data: broadcastId ? `broadcastId=${broadcastId}` : undefined,
        type: "template",
        template: templatePayload
      };
  
      await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
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