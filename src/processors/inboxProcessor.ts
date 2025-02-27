//@ts-nocheck
import { prisma } from "../models/prismaClient";
import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import mime from "mime-types";

let lastProcessedTime = new Date();

export const processWebhookMessage = async (recipient: string, message: any, agentPhoneNumber?:string, businessPhoneNumberId?:string) => {
  try {
    let textMessage = "";
    let attachmentUrl: string | null = null;
    let mediaType: string | null = null;

    // ✅ Handle Interactive Messages (Button Replies, List Replies)
    if (message.type === "interactive") {
      const now = new Date();
      const timeDiff = now.getTime() - lastProcessedTime.getTime();

      // ✅ Prevent duplicates if they arrive within 2 seconds
      if (timeDiff < 2000) {
        console.warn("⚠️ Skipping duplicate event due to rapid trigger");
        return;
      }
      lastProcessedTime = now;

      textMessage = message.interactive.button_reply
        ? `Button: ${message.interactive.button_reply.title}`
        : `List Selection: ${message.interactive.list_reply.title}`;
    }
    // ✅ Handle Standard Text Messages
    else if (message.type === "text") {
      textMessage = message.text?.body || "";
    }
    // ✅ Handle Media Messages (image, video, audio, document)
    else if (["image", "video", "audio", "document"].includes(message.type)) {
      mediaType = message.type;

      if (message[message.type]?.id) {
        const localFilePath = await downloadMedia(message[message.type].id);
        if (localFilePath) {
          attachmentUrl = await uploadMediaToDigitalOcean(localFilePath);
          fs.unlinkSync(localFilePath); // ✅ Remove file after successful upload
        }
      }

      // ✅ Set message text based on media type
      switch (message.type) {
        case "image":
          textMessage = "📷 Image received";
          break;
        case "video":
          textMessage = "🎥 Video received";
          break;
        case "audio":
          textMessage = "🎵 Audio message received";
          break;
        case "document":
          textMessage = "📂 Document received";
          break;
      }
    }
    // ✅ Handle Unsupported Messages
    else {
      textMessage = `Unsupported message type: ${message.type}`;
    }

    // ✅ Find or Create Contact
    let contact = await prisma.contact.findFirst({
      where: { phoneNumber: recipient },
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          phoneNumber: recipient,
          name: "Unknown",
          source: "WhatsApp",
          subscribed: true,
          attributes: [],
          userId: userId ? parseInt(userId) : undefined,
        },
      });
    }

    // ✅ Find or Create Conversation
    let conversation = await prisma.conversation.findFirst({
      where: {
        recipient,
        ...(agentPhoneNumber && { 
          businessPhoneNumber: { phoneNumber: agentPhoneNumber } // ✅ Correct nested filtering
        }),
      },
      orderBy: { updatedAt: "desc" },
    });
    
    const businessPhone = await prisma.businessPhoneNumber.findFirst({
      where: { phoneNumber: agentPhoneNumber },
      select: { id: true },
    });
    
    if (!businessPhone) {
      throw new Error("Business phone number not found");
    }
    
    const businessPhoneNumberId = businessPhone.id;
    // if (!conversation) {
    //   conversation = await prisma.conversation.create({
    //     data: {
    //       recipient,
    //       contactId: contact.id,
    //       answeringQuestion: true,
    //     },
    //   });
    // } else if (!conversation.contactId) {
    //   conversation = await prisma.conversation.update({
    //     where: { id: conversation.id },
    //     data: { contactId: contact.id },
    //   });
    // }

    // ✅ Save the Message
    if (!conversation) {
      // ✅ Create a new conversation and set businessPhoneNumberId
      conversation = await prisma.conversation.create({
        data: {
          recipient,
          contactId: contact.id,
          answeringQuestion: false,
          businessPhoneNumberId, // ✅ Use the ID directly
        },
      });
    } else if (!conversation.contactId) {
      // ✅ Update existing conversation with contactId & businessPhoneNumberId
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          contactId: contact.id,
          businessPhoneNumberId, // ✅ Use the ID directly
        },
      });
    }
    
    const savedMessage = await prisma.message.create({
      data: {
        contactId: contact.id,
        conversationId: conversation.id,
        sender: "them",
        text: textMessage,
        time: new Date(),
        status: "SENT",
        attachment: attachmentUrl,
        messageType: mediaType || "text",
      },
    });

    return {
      id: message.id,
      sender: "them",
      time: new Date().toLocaleTimeString(),
      text: textMessage,
      attachment: attachmentUrl,
    };
  } catch (error) {
    console.error("Chatbot processing error:", error);
  }
};

// ✅ Fetch Media URL from Meta API
const fetchMediaUrl = async (mediaId: string) => {
  try {
    const response = await axios.get(`${process.env.META_BASE_URL}/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      },
    });

    return response.data; // ✅ This URL expires in 5 minutes
  } catch (error) {
    console.error("Error fetching media URL:", error);
    return null;
  }
};

// ✅ Download Media and Save Locally
const downloadMedia = async (mediaId: string) => {
  try {
    const mediaResponse = await fetchMediaUrl(mediaId);
    const mediaUrl=mediaResponse.url;
    if (!mediaUrl) return null;

    const response = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      },
      responseType: "arraybuffer",
    });

    const fileExtension = mime.extension(mediaResponse.mime_type) || "jpg"; // Get file extension
    const localFilePath = path.join(__dirname, "../../uploads", `${mediaId}.${fileExtension}`);

    fs.writeFileSync(localFilePath, response.data);
    return localFilePath;
  } catch (error) {
    console.error("Error downloading media:", error);
    return null;
  }
};

// ✅ Upload to DigitalOcean Spaces
const uploadMediaToDigitalOcean = async (localFilePath: string) => {
  try {
    const formData = new FormData();
    formData.append("file", fs.createReadStream(localFilePath));

    const response = await axios.post(`${process.env.BASE_URL}/upload`, formData, 
      { headers: { ...formData.getHeaders() } }
    );
    return response.data.fileUrl;
  } catch (error) {
    console.error("Error uploading to DigitalOcean:", error);
    return null;
  }
};
