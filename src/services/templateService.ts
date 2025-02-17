import { prisma } from "../models/prismaClient";
import axios from "axios";

export const syncTemplatesWithWhatsApp = async () => {
  console.log("🔄 Syncing templates with WhatsApp API...");

  try {
    const response = await axios.get(`${process.env.WHATSAPP_GRAPH_API}`, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    });

    const templatesData = response.data.data.map((template: any) => ({
      name: template.name,
      language: template.language.code,
      category: template.category || "default",
      status: template.status || "approved",
    }));

    for (const template of templatesData) {
      await prisma.template.upsert({
        where: { name: template.name },
        update: { status: template.status },
        create: template,
      });
    }

    console.log("✅ Templates updated in DB");
  } catch (error:any) {
    console.error("❌ Failed to sync templates:", error.message);
  }
};
