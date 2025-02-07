import { prisma } from "../models/prismaClient";
//import { sendMessage} from "../processors/webhook";

export const processWebhookMessage = async (recipient: string, message: any) => {
  try {

    const text = message?.text?.body?.toLowerCase();
    let contact = await prisma.contact.findFirst({
      where: { phoneNumber: recipient },
    });
   
    if (!contact) {
      console.log(`Creating new contact for ${recipient}...`);
      contact = await prisma.contact.create({
        data: {
          phoneNumber: recipient,
          name: "Unknown", // Default until name is set
          source: "WhatsApp", // Adjust based on platform
          subscribed: true, // Default value
          attributes: [],
        },
      });
    }

    // ✅ Find or create the conversation
    let conversation = await prisma.conversation.findFirst({
      where: { recipient },
      orderBy: { updatedAt: "desc" },
    });
    if (!conversation) {
      console.log(`Creating new conversation for ${recipient}...`);
      conversation = await prisma.conversation.create({
        data: {
          recipient,
          contactId: contact.id, // Link newly created contact
          answeringQuestion: true,
        },
      });
    } else if (!conversation.contactId) {
      // ✅ If conversation exists but has no contactId, update it
      console.log(`Linking existing conversation ${conversation.id} to contact ${contact.id}...`);
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { contactId: contact.id },
      });
    }
    const savedMessage = await prisma.message.create({
      data: {
        contactId: contact.id, // Ensure message links to a contact
        conversationId: conversation.id,
        sender: "them",
        text: text,
        time: new Date(), // Store correct timestamp
        status: "SENT",
      },
    });
    const newMessage = {
      id: message.id,
      sender: "them",
      time: new Date().toLocaleTimeString(),
      text: text,
    };

    return newMessage;
  } catch (error) {
    console.error("Chatbot processing error:", error);
  }
};
