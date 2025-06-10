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



export async function syncTemplates(wabaId: string) {
  try {
    let after: string | undefined = undefined;

    do {
      const resp: any = await axios.get(
        `https://graph.facebook.com/v22.0/${wabaId}/message_templates`,
        {
          params: {
            access_token: process.env.META_ACCESS_TOKEN,
            fields: 'id,name,language,category,status,components,created_time,updated_time',
            limit: 50,
            ...(after && { after }),
          },
        }
      );

      const {
        data,
        paging,
      }: {
        data: any[];
        paging: { cursors: { after?: string; before?: string } };
      } = resp.data;

      for (const tpl of data) {
        const exists = await prisma.template.findFirst({
          where: {
            wabaId: wabaId,
            name: tpl.name,
            language: tpl.language,
          },
        });
        if (exists) continue;

        const content = {
          name: tpl.name,
          parameter_format: 'POSITIONAL',
          components: tpl.components,
          language: tpl.language,
          status: tpl.status,
          category: tpl.category,
          id: tpl.id.toString(),
        };

        const user = await prisma.user.findFirst({
          where: { selectedWabaId: wabaId },
        });

        await prisma.template.create({
          data: {
            name: tpl.name,
            language: tpl.language,
            category: tpl.category,
            status: tpl.status,
            content: JSON.stringify(content),
            userId: user?.id,
            wabaId: wabaId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      after = paging?.cursors?.after;
    } while (after);
  } catch (error: any) {
    console.error('Error syncing templates:', error.message);
  }
}

