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




export async function syncTemplates() {
  let after: string|undefined = undefined
  do {
    const phoneNumberIds=await prisma.businessPhoneNumber.findMany({select:{metaPhoneNumberId:true}})//find all phone numbers Ids in phoneNumber table
   //for each phone number id, sync the templates
   for(const phoneNumberId of phoneNumberIds){
    const url = `https://graph.facebook.com/22.0/${phoneNumberId.metaPhoneNumberId}/message_templates`
    const params: any = {
      access_token: process.env.META_ACCESS_TOKEN,
      fields: 'name,language,category,status,components,created_time,updated_time',
      limit: 50,
    }
    if (after) params.after = after

    const resp = await axios.get(url, { params })
    const { data, paging } = resp.data 

    for (const template of data) {
      // upsert by your unique key: (wabaId + name + language)
      await prisma.template.upsert({
        where: { name: template.name },
        update: { status: template.status },
        create: template,
      });
    }

    after = paging?.cursors?.after
  }} while (after)}
