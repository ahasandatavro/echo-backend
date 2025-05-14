import { metaWhatsAppAPI } from "../../config/metaConfig";
import axios from "axios";

export const brodcastTemplate = async (
    recipient: string,
    selectedTemplate: string,
    chatbotId: number,
    broadcastId: number,
    phoneNumberId?: string
  ) => {
    try {
      const url = `${metaWhatsAppAPI.baseURL}/${phoneNumberId}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: recipient,
        biz_opaque_callback_data: broadcastId ? `broadcastId=${broadcastId}` : undefined,
        type: "template",
        template: {
          name: selectedTemplate,
          language: { code: "en_US" }, // Set your default language or make it dynamic
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