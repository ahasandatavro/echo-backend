import { prisma } from "../models/prismaClient";
//import { sendMessage} from "../processors/webhook";

let lastProcessedTime = new Date();


export const processWebhookMessage = async (recipient: string, message: any) => {
  try {

    let textMessage = "";
    
    // ✅ Handle Interactive Messages (Button Replies, List Replies)
    if (message.type === "interactive") {
      if (message.interactive?.button_reply) {
        const now = new Date();
        const timeDiff = now.getTime() - lastProcessedTime.getTime();
      
        // ✅ Prevent duplicates if they arrive within 2 seconds
        if (timeDiff < 2000) {
          console.warn("⚠️ Skipping duplicate event due to rapid trigger");
          return;
        }
        lastProcessedTime = now;

        textMessage = `Button: ${message.interactive.button_reply.title}`;
      } else if (message.interactive?.list_reply) {
        textMessage = `List Selection: ${message.interactive.list_reply.title}`;
      }
    } 
    // ✅ Handle Standard Text Messages
    else if (message.type === "text") {
      textMessage = message.text?.body || "";
    } 
    // ✅ Handle Media Messages (Future Support)
    else {
      textMessage = `Unsupported message type: ${message.type}`;
    }
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
        text: textMessage,
        time: new Date(), // Store correct timestamp
        status: "SENT",
      },
    });
    const newMessage = {
      id: message.id,
      sender: "them",
      time: new Date().toLocaleTimeString(),
      text: textMessage,
    };

    return newMessage;
  } catch (error) {
    console.error("Chatbot processing error:", error);
  }
};
