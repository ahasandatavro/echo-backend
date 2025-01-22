import { htmlToText } from "html-to-text";

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
  const preprocessedHtml = preprocessHtmlForWhatsApp(html);

  return htmlToText(preprocessedHtml, {
    wordwrap: 130, // Optional: Wrap lines after 130 characters
    preserveNewlines: true, // Preserve line breaks for WhatsApp formatting
  });
};
