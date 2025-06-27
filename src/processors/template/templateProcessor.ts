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
//         text: /* you’ll need to supply these at call-time */ ""
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
      const dbTpl = await prisma.template.findUnique({
        where: { name: selectedTemplate , wabaId:businessAccount?.metaWabaId },
      });
      if (!dbTpl || !dbTpl.content) {
        throw new Error(`Template "${selectedTemplate}" not found or has no content`);
      }

  // 2. parse its content JSON
  const tplDef: {
    components: Array<{
      type: string;
      text?: string;
      buttons?: Array<{
        type: string;
        text: string;
        url?: string;
        phone_number?: string;
      }>;
    } | null>;
    // we ignore header/example in this sample
  } = JSON.parse(dbTpl.content);

  // 3. build the send-payload components array
  const sendComponents: any[] = [];

  tplDef.components.forEach((c, idx) => {
    if (!c) return;

    if (c.type === "BODY" && c.text) {
      // extract all {{n}} placeholders
      const matches = Array.from(c.text.matchAll(/\{\{(\d+)\}\}/g));
      const params = matches.map(m => ({
        type: "text" as const,
        text: /* you’ll need to supply these at call-time */ ""
      }));
      sendComponents.push({
        type: "body",
        parameters: params
      });
    }

    if (c.type === "BUTTONS" && Array.isArray(c.buttons)) {
      c.buttons.forEach((btn, buttonIndex) => {
        if (btn.type === "URL" && btn.url) {
          // find URL placeholders
          const matches = Array.from(btn.url.matchAll(/\{\{(\d+)\}\}/g));
          const params = matches.map(m => ({
            type: "text" as const,
            text: /* supply the matching value for each {{n}} */
              ""
          }));

          sendComponents.push({
            type: "button",
            sub_type: "URL",
            index: buttonIndex.toString(),
            //parameters: params
          });
        }

        if (btn.type === "PHONE_NUMBER" && btn.phone_number) {
          sendComponents.push({
            type: "button",
            sub_type: "VOICE_CALL",
            index: buttonIndex.toString(),
          });
        }

        if (btn.type === "QUICK_REPLY") {
          sendComponents.push({
            type: "button",
            sub_type: "QUICK_REPLY",
            index: buttonIndex.toString(),
            // parameters: [
            //   { type: "text" as const, text: btn.text }
            // ]
          });
        }
      });
    }
  });
      const url = `${metaWhatsAppAPI.baseURL}/${phoneNumberId}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: recipient,
        biz_opaque_callback_data: broadcastId ? `broadcastId=${broadcastId}` : undefined,
        type: "template",
        template: {
          name: selectedTemplate,
          language: { code: dbTpl.language },
          components: sendComponents
        },
      };
  
      await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
          "Content-Type": "application/json",
        },
      });
     
    } catch (error: any) {
      console.error("Error sending template message:", error.response.data.error.message);
      throw error;
    }
  };