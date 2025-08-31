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



export async function syncTemplates(wabaId: string, reqUserId:number) {
  console.log(`[syncTemplates] Starting template sync for wabaId: ${wabaId}, userId: ${reqUserId}`);
  
  try {
    let after: string | undefined = undefined;
    let totalTemplatesProcessed = 0;
    let totalTemplatesCreated = 0;
    let totalTemplatesSkipped = 0;
    let pageCount = 0;

    do {
      pageCount++;
      console.log(`[syncTemplates] Fetching page ${pageCount} for wabaId: ${wabaId}`);
      
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

      console.log(`[syncTemplates] Page ${pageCount}: Retrieved ${data.length} templates`);

      for (const tpl of data) {
        totalTemplatesProcessed++;
        console.log(`[syncTemplates] Processing template: ${tpl.name} (${tpl.language}) - ID: ${tpl.id}`);
        
        const exists = await prisma.template.findFirst({
          where: {
            wabaId: wabaId,
            name: tpl.name,
            language: tpl.language,
          },
        });
        
        if (exists) {
          console.log(`[syncTemplates] Template ${tpl.name} (${tpl.language}) already exists, skipping`);
          totalTemplatesSkipped++;
          continue;
        }

        console.log(`[syncTemplates] Creating new template: ${tpl.name} (${tpl.language})`);

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
          where: { selectedWabaId: wabaId, id: reqUserId },
        });

        const data: any = {
          name: tpl.name,
          language: tpl.language,
          category: tpl.category,
          status: tpl.status,
          content: JSON.stringify(content),
          wabaId: wabaId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        
        if (user?.id !== undefined) {
          data.userId = user.id;
          console.log(`[syncTemplates] Assigning template to user: ${user.id}`);
        } else {
          console.log(`[syncTemplates] No user found for wabaId: ${wabaId}, creating template without user assignment`);
        }
        
        await prisma.template.create({
          data,
        });
        
        totalTemplatesCreated++;
        console.log(`[syncTemplates] Successfully created template: ${tpl.name} (${tpl.language})`);
      }

      after = paging?.cursors?.after;
      console.log(`[syncTemplates] Page ${pageCount} completed. After cursor: ${after || 'none'}`);
      
    } while (after);

    console.log(`[syncTemplates] Sync completed successfully!`);
    console.log(`[syncTemplates] Summary: ${totalTemplatesProcessed} templates processed, ${totalTemplatesCreated} created, ${totalTemplatesSkipped} skipped across ${pageCount} pages`);
    
  } catch (error: any) {
    console.error('[syncTemplates] Error syncing templates:', error.message);
    console.error('[syncTemplates] Error details:', {
      wabaId,
      reqUserId,
      error: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    throw error; // Re-throw to allow calling function to handle
  }
}

