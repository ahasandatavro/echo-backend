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
    const MAX_PAGES = 100; // Safety limit to prevent infinite loops

    do {
      pageCount++;
      
      // Safety check to prevent infinite loops
      if (pageCount > MAX_PAGES) {
        console.warn(`[syncTemplates] Reached maximum page limit (${MAX_PAGES}). Stopping sync to prevent infinite loop.`);
        break;
      }
      
      console.log(`[syncTemplates] Processing page ${pageCount}`);
      
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

      // Validate that we received data
      if (!data || !Array.isArray(data) || data.length === 0) {
        console.log(`[syncTemplates] No templates found on page ${pageCount}`);
        break; // Exit if no data received
      }

      console.log(`[syncTemplates] Processing ${data.length} templates on page ${pageCount}`);

      for (const tpl of data) {        
        totalTemplatesProcessed++;
        
        // const exists = await prisma.template.findFirst({
        //   where: {
        //     wabaId: wabaId,
        //     name: tpl.name,
        //     language: tpl.language,
        //   },
        // });
        const exists = await prisma.template.findFirst({
          where: {
            name: tpl.name,
            wabaId: wabaId,
          },
        });
        
        if (exists) {
          totalTemplatesSkipped++;
          continue;
        }

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
        } else {

        }
        
        await prisma.template.create({
          data,
        });
        
        totalTemplatesCreated++;
     
      }

      // Check if there's a next page
      if (!paging || !paging.cursors || !paging.cursors.after) {
        console.log(`[syncTemplates] No more pages available. Ending sync.`);
        break;
      }
      
      after = paging.cursors.after;
      console.log(`[syncTemplates] Moving to next page with cursor: ${after}`);
      
    } while (after);
    
    console.log(`[syncTemplates] Sync completed successfully:`);
    console.log(`  - Total pages processed: ${pageCount}`);
    console.log(`  - Total templates processed: ${totalTemplatesProcessed}`);
    console.log(`  - Total templates created: ${totalTemplatesCreated}`);
    console.log(`  - Total templates skipped: ${totalTemplatesSkipped}`);
    
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

