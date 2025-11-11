import { htmlToText } from "html-to-text";
import { prisma } from "../models/prismaClient";
import { s3 } from "../config/s3Config";
/**
 * Preprocesses HTML to replace specific tags (e.g., <strong>) with WhatsApp-compatible markdown.
 *
 * @param {string} html - The HTML string to preprocess.
 * @returns {string} - The preprocessed HTML string.
 */
export const preprocessHtmlForWhatsApp = (html: string): string => {
  return html
    .replace(/<strong>(.*?)<\/strong>/g, "*$1*") // Bold
    .replace(/<b>(.*?)<\/b>/g, "*$1*") // Bold
    .replace(/<em>(.*?)<\/em>/g, "_$1_") // Italic
    .replace(/<i>(.*?)<\/i>/g, "_$1_") // Italic
    .replace(/<u>(.*?)<\/u>/g, "$1") // Underline (no equivalent in WhatsApp)
    .replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, "$2 ($1)") // Links
    .replace(/<s>(.*?)<\/s>/g, "~$1~") // Strikethrough
    .replace(/<del>(.*?)<\/del>/g, "~$1~") // Strikethrough
    .replace(/<[^>]*>?/gm, '').trim()
};

/**
 * Converts HTML to WhatsApp-compatible formatted text.
 *
 * @param {string} html - The HTML string to convert.
 * @returns {string} - The converted text with WhatsApp formatting.
 */
export const convertHtmlToWhatsAppText = (html: string): string => {
  let preprocessedHtml = "";
  if(html) preprocessedHtml = preprocessHtmlForWhatsApp(html);

  return htmlToText(preprocessedHtml, {
    wordwrap: 130, // Optional: Wrap lines after 130 characters
    preserveNewlines: true, // Preserve line breaks for WhatsApp formatting
  });
};


export const uploadFileToDigitalOceanHelper = async (
  file: Express.Multer.File,
  userId: number
): Promise<string> => {
  const fileKey = `${Date.now()}-${file.originalname}`;
  const uploadParams = {
    Bucket: process.env.DO_SPACES_BUCKET || "",
    Key: fileKey,
    Body: file.buffer,
    ACL: "public-read",
    ContentType: file.mimetype,
  };

  try {
    // Upload to Digital Ocean Spaces
    const result = await s3.upload(uploadParams).promise();
    const fileUrl = result.Location;

    // Save to media table
    await prisma.media.create({
      data: {
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        url: fileUrl,
        userId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return fileUrl;
  } catch (error) {
    console.error("Error uploading to DigitalOcean Spaces:", error);
    throw new Error("File upload failed");
  }
};

export const bump = async (
  chatbotId: number,
  field: "triggered" | "stepsFinished" | "finished",
  by = 1
) => {
  // 1) log what you're about to do
  //console.log(`[bump] called → chatbotId=${chatbotId} field=${field} by=${by}`);

  try {
    // 2) perform the update and capture the result
    const updated = await prisma.chatbot.update({
      where: { id: chatbotId },
      data: { [field]: { increment: by } },
      select: { id: true, [field]: true }
    });
    // 3) log what came back
   // console.log(`[bump] success →`, updated);
    return updated;
  } catch (err) {
    // 4) make sure you actually see the error
    console.error(`[bump] failed → chatbotId=${chatbotId} field=${field}`, err);
    // optionally re-throw if you want the outer code's catch to see it:
   // throw err;
  }
};

export const notifyAgent = async (
  io: any,
  assignedToEmail: string,
  assignedByEmail: string,
  contactName: string
): Promise<void> => {
  const assignee = await prisma.user.findUnique({
    where: { email: assignedByEmail },
    include: { createdBy: true },
  });

  if (!assignee) return;

  let recipients: string[] = [];

  if (!assignee.agent) {
    // Creator: notify all their agents
    const createdAgents = await prisma.user.findMany({
      where: {
        createdById: assignee.id,
        agent: true,
      },
      select: { email: true },
    });

    recipients = createdAgents.map((u) => u.email);
  } else if (assignee.createdById) {
    // Agent: notify sibling agents and the creator
    const otherAgents = await prisma.user.findMany({
      where: {
        createdById: assignee.createdById,
        agent: true,
        NOT: { email: assignedToEmail },
      },
      select: { email: true },
    });

    const creator = await prisma.user.findUnique({
      where: { id: assignee.createdById },
      select: { email: true },
    });

    recipients = [
      ...otherAgents.map((a) => a.email),
      ...(creator?.email ? [creator.email] : []),
    ];
  }

  for (const email of recipients) {
    io.emit("chatAssignedToAgent", {
      email,
      assignedToEmail,
      assignedByEmail,
      contactName,
    });
  }
};
