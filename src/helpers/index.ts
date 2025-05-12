import { htmlToText } from "html-to-text";
import { prisma } from "../models/prismaClient";
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



export const bump = async (
  chatbotId: number,
  field: "triggered" | "stepsFinished" | "finished",
  by = 1
) => {
  // 1) log what you’re about to do
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
    // optionally re-throw if you want the outer code’s catch to see it:
   // throw err;
  }
};
