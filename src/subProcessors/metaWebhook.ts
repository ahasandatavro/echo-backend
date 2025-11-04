import {google} from "googleapis";
import {prisma} from '../models/prismaClient';
import {BroadcastStatus, Rule, Prisma} from "../models/prismaClient";
import {resolveContactAttributes, resolveVariables} from "../helpers/validation";
import {processBroadcastInteraction} from "../processors/mmLiteAnalytics"
import {
  processChatFlow,
  processNode,
  sendMessage,
  sendMessageWithButtons,
  sendTemplate,
} from "../processors/metaWebhook/webhookProcessor";
import {processWebhookMessage} from "../processors/inboxProcessor";
import {
  handleFallbackMaterial,
  isWithinWorkingHours,
  processKeyword,
  sendDefaultMaterial
} from "../processors/metaWebhook/keywordProcessor";
import {validateUserResponse} from "../helpers/validation";
import {findMatchingKeyword} from "../utils/keywordMatcher";
import axios from "axios";
import {bump} from "../helpers";

// Webhook Logging Functions
export const logWebhookCall = async (
  webhook: any,
  payload: any,
  eventType: string,
  businessPhoneNumberId: number
) => {
  try {
    // Create initial log entry
    const logEntry = await prisma.webhookLog.create({
      data: {
        webhookId: webhook.id,
        requestUrl: webhook.url,
        requestBody: payload,
        eventType,
        businessPhoneNumberId,
        status: 'PENDING'
      }
    });

    return logEntry;
  } catch (error) {
    console.error('Error creating webhook log entry:', error);
    return null;
  }
};

export async function getBroadcastRecipientHistory(broadcastRecipientId: number) {
  return await prisma.broadcastRecipientHistory.findMany({
    where: {broadcastRecipientId},
    orderBy: {createdAt: 'asc'},
    include: {
      broadcastRecipient: {
        include: {
          contact: true,
          broadcast: true,
        },
      },
    },
  });
}

export async function getBroadcastRecipientHistoryByContact(broadcastId: number, contactId: number) {
  const broadcastRecipient = await prisma.broadcastRecipient.findFirst({
    where: {
      broadcastId,
      contactId,
    },
  });

  if (!broadcastRecipient) {
    return null;
  }

  return await getBroadcastRecipientHistory(broadcastRecipient.id);
}

export const updateWebhookLog = async (
  logId: number,
  updateData: {
    status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRYING' | 'MAX_RETRIES_EXCEEDED';
    responseStatus?: number;
    responseHeaders?: any;
    responseBody?: string;
    responseTime?: number;
    errorMessage?: string;
    errorType?: string;
    retryCount?: number;
  }
) => {
  try {
    await prisma.webhookLog.update({
      where: {id: logId},
      data: updateData
    });
  } catch (error) {
    console.error('Error updating webhook log:', error);
  }
};

export const executeWebhookWithLogging = async (
  webhook: any,
  payload: any,
  eventType: string,
  businessPhoneNumberId: number,
  maxRetries: number = 3
) => {
  // Create initial log entry
  const logEntry = await logWebhookCall(webhook, payload, eventType, businessPhoneNumberId);

  if (!logEntry) {
    console.error('Failed to create webhook log entry for webhook:', webhook.id);
    return;
  }

  let retryCount = 0;
  const startTime = Date.now();

  while (retryCount <= maxRetries) {
    try {
      // Update status to RETRYING if this is a retry
      if (retryCount > 0) {
        await updateWebhookLog(logEntry.id, {
          status: 'RETRYING',
          retryCount
        });
      }

      // Make the webhook call
      const response = await axios.post(webhook.url, payload, {
        timeout: 10000, // 10 second timeout
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ZiloChat-Webhook/1.0'
        }
      });

      const responseTime = Date.now() - startTime;

      // Check if response status indicates success (2xx range)
      if (response.status >= 200 && response.status < 300) {
        // Update log with success
        let responseBodyToStore: any;
        if (typeof response.data === 'object') {
          responseBodyToStore = response.data;
        } else {
          try {
            responseBodyToStore = JSON.parse(response.data);
          } catch {
            responseBodyToStore = {raw: response.data};
          }
        }

        await updateWebhookLog(logEntry.id, {
          status: 'SUCCESS',
          responseStatus: response.status,
          responseHeaders: response.headers,
          responseBody: responseBodyToStore,
          responseTime
        });

        console.log(`Webhook ${webhook.id} → ${webhook.url} succeeded (${responseTime}ms)`);
        return;
      } else {
        // HTTP status code indicates failure (4xx, 5xx)
        const responseTime = Date.now() - startTime;
        retryCount++;

        // Store the failed response details
        let responseBodyToStore: any;
        if (typeof response.data === 'object') {
          responseBodyToStore = response.data;
        } else {
          try {
            responseBodyToStore = JSON.parse(response.data);
          } catch {
            responseBodyToStore = {raw: response.data};
          }
        }

        // Determine error type based on status code
        let errorType = 'HTTP_ERROR';
        if (response.status >= 400 && response.status < 500) {
          errorType = `HTTP_${response.status}_CLIENT_ERROR`;
        } else if (response.status >= 500) {
          errorType = `HTTP_${response.status}_SERVER_ERROR`;
        }

        // Update log with failure details
        await updateWebhookLog(logEntry.id, {
          status: retryCount > maxRetries ? 'MAX_RETRIES_EXCEEDED' : 'FAILED',
          responseStatus: response.status,
          responseHeaders: response.headers,
          responseBody: responseBodyToStore,
          errorMessage: `HTTP ${response.status}: ${response.statusText}`,
          errorType,
          responseTime,
          retryCount
        });

        if (retryCount > maxRetries) {
          console.error(`Webhook ${webhook.id} → ${webhook.url} failed after ${maxRetries} retries. Final status: ${response.status}`);
          return;
        }

        // Wait before retrying (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000); // Max 10 seconds
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      retryCount++;

      // Determine error type
      let errorType = 'UNKNOWN';
      if (error.code === 'ECONNABORTED') {
        errorType = 'TIMEOUT';
      } else if (error.code === 'ENOTFOUND') {
        errorType = 'DNS_ERROR';
      } else if (error.code === 'ECONNREFUSED') {
        errorType = 'CONNECTION_REFUSED';
      } else if (error.response) {
        // This handles cases where we get a response but it's an error
        errorType = `HTTP_${error.response.status}`;

        // Store the error response details
        let responseBodyToStore: any;
        if (typeof error.response.data === 'object') {
          responseBodyToStore = error.response.data;
        } else {
          try {
            responseBodyToStore = JSON.parse(error.response.data);
          } catch {
            responseBodyToStore = {raw: error.response.data};
          }
        }

        await updateWebhookLog(logEntry.id, {
          status: retryCount > maxRetries ? 'MAX_RETRIES_EXCEEDED' : 'FAILED',
          responseStatus: error.response.status,
          responseHeaders: error.response.headers,
          responseBody: responseBodyToStore,
          errorMessage: error.message,
          errorType,
          responseTime,
          retryCount
        });
      } else {
        // Network or other errors
        await updateWebhookLog(logEntry.id, {
          status: retryCount > maxRetries ? 'MAX_RETRIES_EXCEEDED' : 'FAILED',
          errorMessage: error.message,
          errorType,
          responseTime,
          retryCount
        });
      }

      if (retryCount > maxRetries) {
        console.error(`Webhook ${webhook.id} → ${webhook.url} failed after ${maxRetries} retries:`, error.message);
        return;
      }

      // Wait before retrying (exponential backoff)
      const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000); // Max 10 seconds
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

export const performGoogleSheetAction = async (
  payload: {
    action: string;
    spreadsheetId: any;
    sheetName: string;
    updateInAndBy?: any[];
    referenceColumn?: { name: string; value: string };
    variables: any[]
  },
  currentNode: any,
  recipient: string,
  agentPhoneNumberId: string | undefined
): Promise<any> => {
  try {
    // Step 1: Find the chatbot and its owner
    const chatbot = await prisma.chatbot.findUnique({
      where: {id: currentNode.chatId},
      include: {owner: true}, // Include the owner relation
    });

    if (!chatbot) {
      throw new Error("Chatbot not found.");
    }

    const ownerId = chatbot.ownerId;
    if (!ownerId) {
      throw new Error("Chatbot owner does not have a valid access token.");
    }

    const sheetOwner = await prisma.user.findUnique({
      where: {id: ownerId},
    });
    const ownerAccessToken = await ensureValidAccessToken(sheetOwner);

    // Step 2: Authenticate with Google Sheets API
    const auth = new google.auth.OAuth2();
    auth.setCredentials({access_token: ownerAccessToken});

    const sheets = google.sheets({version: "v4", auth});
    let refColumnIndex: any;
    const {action, spreadsheetId, sheetName, updateInAndBy, referenceColumn, variables} = payload;

    // Step 3: Perform the specified action
    switch (action) {
      case "add":
        if (!variables || variables.length === 0) {
          throw new Error("Invalid payload: No data provided for adding rows.");
        }

        // Read existing header row to match columns
        const readHeaderResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId.id,
          range: `${spreadsheetId.sheetName}!A1:Z1`, // Fetch the header row
        });

        let headerRow = readHeaderResponse.data.values?.[0]; // Get the header row

        if (!headerRow) {
          throw new Error("Sheet is missing a header row.");
        }

        const newRow = await Promise.all(
          headerRow.map(async (columnName: string) => {
            const variable = variables.find((v: any) => v.name === columnName);

            if (!variable) return ""; // If no matching variable, leave blank

            // Resolve variable if it contains "@"
            if (typeof variable.value === "string" && variable.value.includes("@")) {
              try {
                const resolvedValue = await resolveVariables(variable.value, currentNode.chatId, recipient, agentPhoneNumberId);
                return resolvedValue || ""; // Ensure resolvedValue is a valid string
              } catch (error) {
                console.error("Error resolving variable:", error);
                return ""; // Default to empty string on error
              }
            } else if (variable.value.includes("{{")) {
              const resolvedValue = await resolveContactAttributes(variable.value, recipient);
              return resolvedValue || ""; // Ensure resolvedValue is a valid string
            }
            // Ensure variable.value is a string or valid primitive
            return typeof variable.value === "string" || typeof variable.value === "number"
              ? variable.value
              : ""; // Default to empty string for invalid values
          })
        );


        // Append the new row to the sheet
        await sheets.spreadsheets.values.append({
          spreadsheetId: spreadsheetId.id,
          range: `${spreadsheetId.sheetName}!A1`, // Target the sheet to append rows
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [newRow], // Wrap the new row in an array to match API format
          },
        });

        console.log("Row successfully added.");
        return true;

      case "update": {
        if (!referenceColumn || !referenceColumn.name || !referenceColumn.value) {
          console.error("Invalid payload: Reference column data is missing.");
          return false;
        }

        const tabName = spreadsheetId.sheetName || sheetName;

        // Read all rows once (small sheets) — or narrow to A1:Z if you prefer
        const readResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId.id,
          range: `${tabName}!A1:Z100000`,
        });

        const rows = readResponse.data.values || [];
        if (!rows.length) return false;

        const headerRow = rows[0];
        const refColumnIndex = headerRow.indexOf(referenceColumn.name);
        if (refColumnIndex === -1) {
          console.error(`Reference column "${referenceColumn.name}" not found. Available: ${headerRow.join(", ")}`);
          return false;
        }

        // Normalize comparison (stringify + trim) so "123" === 123 and whitespace doesn't break it
        const refVal = String(referenceColumn.value).trim();
        const rowIndex = rows.findIndex((row, i) =>
          i > 0 && String((row?.[refColumnIndex] ?? "")).trim() === refVal
        );
        if (rowIndex === -1) {
          console.error("Row not found for the reference column value.");
          return false;
        }

        // Ensure the target row has at least header length
        const target = Array.from({length: headerRow.length}, (_, i) => rows[rowIndex]?.[i] ?? "");

        // Apply updates; resolve @vars / {{contactAttrs}} like in your "add" case
        for (const update of updateInAndBy || []) {
          const updateIndex = headerRow.indexOf(update.name);
          if (updateIndex === -1) continue;

          let newVal = update.value;
          try {
            if (typeof newVal === "string" && newVal.startsWith("@")) {
              newVal = await resolveVariables(newVal, currentNode.chatId, recipient, agentPhoneNumberId);
            } else if (typeof newVal === "string" && newVal.includes("{{")) {
              newVal = await resolveContactAttributes(newVal, recipient);
            }
          } catch (e) {
            console.error("Error resolving variable:", e);
            newVal = "";
          }
          target[updateIndex] = (typeof newVal === "string" || typeof newVal === "number") ? newVal : "";
        }

        // Update ONLY the target row (1-based A1 notation)
        const rowNumber = rowIndex + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId.id,
          range: `${tabName}!A${rowNumber}:Z${rowNumber}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {values: [target]},
        });

        console.log("Row successfully updated.");
        return true;
      }

      case "delete": {
        if (!referenceColumn || !referenceColumn.name || !referenceColumn.value) {
          throw new Error("Invalid payload: Reference column data is missing.");
        }

        const tabName = spreadsheetId.sheetName || sheetName;

        // 1) Get the real sheetId (gid) for this tab
        const meta = await sheets.spreadsheets.get({spreadsheetId: spreadsheetId.id});
        const theSheet = meta.data.sheets?.find(
          s => s.properties?.title === tabName
        );

        const theSheetId = theSheet?.properties?.sheetId;
        if (theSheetId === undefined) {
          throw new Error(`Sheet "${tabName}" not found in spreadsheet.`);
        }

        // 2) Read all rows from the tab
        const read = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId.id,
          range: `${tabName}!A1:Z100000`,
        });
        const rows = read.data.values || [];
        if (rows.length === 0) return true; // nothing to do

        // 3) Find the reference column index in the header
        const header = rows[0];
        const refColIdx = header.indexOf(referenceColumn.name);
        if (refColIdx === -1) {
          throw new Error(`Reference column "${referenceColumn.name}" not found. Available: ${header.join(", ")}`);
        }

        // 4) Collect all data-row indices (grid indices) that match the value
        // grid index is 0-based including header; header is row 0 -> data starts at 1
        const toDeleteGridIdx: number[] = [];
        for (let i = 1; i < rows.length; i++) {
          const cell = rows[i]?.[refColIdx];
          // normalize both sides to string to avoid "123" vs 123 mismatches
          if (String(cell) === String(referenceColumn.value)) {
            toDeleteGridIdx.push(i);
          }
        }
        if (toDeleteGridIdx.length === 0) return true;

        // 5) Build deleteDimension requests in DESC order so indices don’t shift
        toDeleteGridIdx.sort((a, b) => b - a);
        const requests = toDeleteGridIdx.map(idx => ({
          deleteDimension: {
            range: {
              sheetId: theSheetId,
              dimension: "ROWS",
              startIndex: idx,       // inclusive
              endIndex: idx + 1,     // exclusive
            },
          },
        }));

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheetId.id,
          requestBody: {requests},
        });

        // 6) Optional verification
        const verify = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId.id,
          range: `${tabName}!A1:Z100000`,
        });
        const vrows = verify.data.values || [];
        const remain = vrows.filter((r, i) => i > 0 && String(r?.[refColIdx]) === String(referenceColumn.value));
        console.log(`Verification: ${remain.length} rows remain with "${referenceColumn.value}"`);
        return remain.length === 0;
      }

      default:
        console.error(`Invalid action "${action}" specified.`);
        return false;
    }
  } catch (error) {
    console.error(error);
    return false;
  }
};

export const refreshAccessToken = async (refreshToken: string): Promise<string> => {
  try {

    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.BASE_URL}/auth/google-callback`
    );
    auth.setCredentials({refresh_token: refreshToken});

    const {token} = await auth.getAccessToken();

    if (!token) {
      throw new Error("Failed to refresh access token.");
    }

    return token;
  } catch (error) {
    console.error("Error refreshing access token:");
    throw error;
  }
};

export const ensureValidAccessToken = async (user: any): Promise<string> => {
  if (user.access_token == undefined || isTokenExpired(user.accessTokenExpiresAt)) {
    console.log("Access token expired. Refreshing...");
    const newAccessToken = await refreshAccessToken(user.refreshToken);

    const expiresIn = 3600; // Token lifespan (1 hour)
    const expirationTimestamp = Math.floor(Date.now() / 1000) + expiresIn;

    // Update the database with the new token and expiration time
    await prisma.user.update({
      where: {id: user.id},
      data: {accessToken: newAccessToken, accessTokenExpiresAt: expirationTimestamp},
    });

    return newAccessToken;
  }

  return user.accessToken; // Return valid token
};

// Helper function to check if the token is expired
export const isTokenExpired = (expirationTimestamp: number): boolean => {
  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  return now >= expirationTimestamp; // Token is expired if current time is past the expiration time
};

export const handleChatbotTrigger = async (text: string, recipient: string, phoneNumberId: string | undefined) => {
  const chatbotName = text.split(":")[1].trim();

  const chatbot = await prisma.chatbot.findFirst({
    where: {name: chatbotName},
  });
  if (chatbot) {
    await bump(chatbot.id, "triggered");
  }
  const bp = await prisma.businessPhoneNumber.findFirst({
    where: {metaPhoneNumberId: phoneNumberId},
  });
  let conversation = await prisma.conversation.findFirst({
    where: {recipient, businessPhoneNumberId: bp?.id},
    orderBy: {
      updatedAt: 'desc', // Orders by the most recently updated conversation
    },
  });
  if (!conversation) {

    conversation = await prisma.conversation.create({
      data: {
        recipient,
        chatbotId: chatbot?.id,
        answeringQuestion: true,
        businessPhoneNumberId: bp?.id,
      },
    });

    console.log("New conversation created:", conversation);
  }
  let contact = await prisma.contact.findUnique({
    where: {phoneNumber: recipient}
  });
  if (!contact) {
    return {
      ok: false,
      status: 400,
      message: "Please open a conversation by sending a message to this number first."
    };
  }
  const lastMsg = await prisma.message.findFirst({
    where: {
      conversationId: conversation?.id,
      contactId: contact?.id,
      sender: "them"
    },
    orderBy: {time: 'desc'}
  });
  // 2) if no message or older than 24h → error
  const WINDOW = 24 * 60 * 60 * 1000; // ms
  if (!lastMsg || Date.now() - lastMsg.time.getTime() > WINDOW) {
    return {
      ok: false,
      status: 400,
      message: "Please open a conversation by sending a message to this number first."
    };
  }
  if (chatbot) {
    await prisma.conversation.update({
      where: {id: conversation.id},
      data: {answeringQuestion: false, chatbotId: chatbot.id},
    });
    await processChatFlow(chatbot.id, recipient, phoneNumberId);
  }
  return {ok: true};
}

export async function processBroadcastStatus(statuses: any[]): Promise<void> {
  for (const statusObj of statuses) {
    const phoneNumber = statusObj.recipient_id; // e.g. "1234567890"
    const dbContact = await prisma.contact.findFirst({
      where: {phoneNumber},
    });
    if (!dbContact) {
      continue;
    }
    const newStatus = statusObj.status;         // e.g. "delivered", "read", "failed"
    // If you included "biz_opaque_callback_data" in the message
    const broadcastIdString = statusObj.biz_opaque_callback_data;
    // e.g. "broadcastId=123"
    let broadcastId: number | undefined;

    if (broadcastIdString && broadcastIdString.startsWith("broadcastId=")) {
      broadcastId = parseInt(broadcastIdString.replace("broadcastId=", ""), 10);
    }

    // Convert WhatsApp status to your enum
    let updatedStatus: BroadcastStatus = "SENT";
    switch (newStatus) {
      case "delivered":
        updatedStatus = "DELIVERED";
        break;
      case "read":
        updatedStatus = "READ";
        break;
      case "failed":
        updatedStatus = "FAILED";
        break;
      // Add more cases if needed
    }

    if (broadcastId && phoneNumber) {
      // Update the BroadcastRecipient record matching broadcastId and phoneNumber
      await prisma.broadcast.update({
        where: {id: broadcastId},
        data: {status: updatedStatus},
      });
      await prisma.broadcastRecipient.updateMany({
        where: {
          broadcastId,
          contactId: dbContact.id,
        },
        data: {
          status: updatedStatus,
          errorMessage: statusObj.errors?.[0]?.message,
        },
      });
    }
  }
}

export const isValidWebhookRequest = (entry: any): boolean => {
  return entry && Array.isArray(entry);
};

export const  processWebhookChange = async (change: any, io: any) => {
  // console.log("Meta event:", JSON.stringify(change, null, 2));
  switch (change.field) {
    case "message_template_status_update":
      if (change.value.reason) {
        console.log(change.value.reason);
      }
      await updateTemplateInDb(change.value, change.value.reason);
      break;

    case "messages":
      await processMessageUpdate(change.value, io);
      await processBroadcastInteraction(change.value);
      break;

    case "account_update":
      // Handle account update
      console.log("Account update event:", change.value);
      break;

    case "history":
      // Handle history event
      console.log("History event:", change.value);
      break;
      case "business_capability_update": 
        const v = change.value || {};
  
        // detect current and previous limits
        const currentLimit =
          v.messaging_limit ||
          v.max_daily_conversations_per_business ||
          v.new_limit ||
          "UNKNOWN";
        const previousLimit =
          v.previous_limit ||
          v.previous_max_daily_conversations_per_business ||
          "N/A";
  
        const summary = `🚀 WhatsApp messaging limit changed: ${previousLimit} ➜ ${currentLimit}`;
        console.log(summary);
        
        // Store the messaging limit tier in the database
        try {
          // Get phone number ID from metadata if available
          const phoneNumberId = change.value?.metadata?.phone_number_id;
          
          if (phoneNumberId && currentLimit !== "UNKNOWN") {
            // Find the business phone number and update the messaging limit tier
            const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
              where: { metaPhoneNumberId: phoneNumberId }
            });
            
            if (businessPhoneNumber) {
              await prisma.businessPhoneNumber.update({
                where: { id: businessPhoneNumber.id },
                data: { messagingLimitTier: currentLimit }
              });
              console.log(`Updated messaging limit tier for phone number ${phoneNumberId}: ${currentLimit}`);
            } else {
              console.warn(`Business phone number not found for phone number ID: ${phoneNumberId}`);
            }
          } else {
            console.log("No phone number ID found in metadata or current limit is unknown");
          }
        } catch (error) {
          console.error("Error updating messaging limit tier:", error);
        }
        
        break;
    case "template_category_update":
      // Handle template category update
      await updateTemplateCategoryInDb(change.value);
      break;

    // Add more cases for other fields you subscribe to

    default:
      // Catch-all for unhandled fields
      console.log("Unhandled webhook field:", change.field, change.value);
  }
};

// in your triggerMyWebhooks helper
const graphFieldMap: Record<string, string> = {
  MSG_RECEIVED: "messages",
  NEW_CONTACT_MSG: "messages",
  SESSION_MSG_SENT: "messages",
  TEMPLATE_MSG_SENT: "messages",
  MSG_DELIVERED: "messages",  // statuses come under messages for WhatsApp
  MSG_READ: "messages",
  MSG_REPLIED: "messages",
  SESSION_MSG_SENT_V2: "messages",
  TEMPLATE_MSG_SENT_V2: "messages",
  MSG_DELIVERED_V2: "messages",
  PAYMENT_CAPTURED: "payments",
  TEMPLATE_MSG_FAILED: "message_template_status_update",
  TEMPLATE_CATEGORY_UPDATE: "template_category_update",
};

/**
 * Check if there are any previous messages between the contact and business phone number
 */
async function hasPreviousMessages(contactPhoneNumber: string, businessPhoneNumberId: string): Promise<boolean> {
  try {
    // Get the business phone number record
    const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: businessPhoneNumberId }
    });

    if (!businessPhoneNumber) {
      return false;
    }

    // Find the contact
    const contact = await prisma.contact.findUnique({
      where: { phoneNumber: contactPhoneNumber }
    });

    if (!contact) {
      return false;
    }

    // Check for any previous messages in conversations associated with this business phone number
    const previousMessages = await prisma.message.findFirst({
      where: {
        contactId: contact.id,
        conversation: {
          businessPhoneNumberId: businessPhoneNumber.id
        }
      }
    });

    return !!previousMessages;
  } catch (error) {
    console.error('Error checking previous messages:', error);
    return false;
  }
}

/**
 * Decide whether this payload should trigger the hook for the given UI-code.
 */
async function matchesEvent(uiCode: string, value: any): Promise<boolean> {
  const msgs = Array.isArray(value.messages) ? value.messages : [];
  const statuses = Array.isArray(value.statuses) ? value.statuses : [];

  switch (uiCode) {
    case "MSG_RECEIVED":
      // any inbound (non-template) message
      return msgs.some((m: any) =>
        m.from !== value.metadata.display_phone_number &&
        m.type !== "template"
      );

    case "NEW_CONTACT_MSG":
      // Check if this is an inbound non-template message AND if there are no previous messages
      const hasInboundMessage = msgs.some((m: any) =>
        m.from !== value.metadata.display_phone_number &&
        m.type !== "template"
      );
      
      if (!hasInboundMessage) {
        return false;
      }

      // Get the first inbound message to check contact
      const inboundMessage = msgs.find((m: any) =>
        m.from !== value.metadata.display_phone_number &&
        m.type !== "template"
      );

      if (!inboundMessage) {
        return false;
      }

      // Check if there are any previous messages between this contact and business
      const phoneNumberId = value?.metadata?.phone_number_id;
      const contactPhoneNumber = inboundMessage.from;
      
      if (!phoneNumberId || !contactPhoneNumber) {
        return false;
      }

      const hasPrevious = await hasPreviousMessages(contactPhoneNumber, phoneNumberId);
      return !hasPrevious; // Only trigger for NEW contacts (no previous messages)

    case "MSG_REPLIED":
      // user reply (inbound), template or text
      return msgs.some((m: any) =>
        m.from !== value.metadata.display_phone_number
      );

    case "SESSION_MSG_SENT":
      // "sent" plus no type=template flag → this is a session/text message
      return statuses.some((s: any) =>
        s.status === "sent" &&
        (
          !s.biz_opaque_callback_data ||             // no biz data at all
          /chatId=\d+/.test(s.biz_opaque_callback_data)  // or data present but no type=template
        )
      );

    case "TEMPLATE_MSG_SENT":
      // "sent" plus type=template → this is a template message
      return statuses.some((s: any) =>
        s.status === "sent" &&
        typeof s.biz_opaque_callback_data === "string" &&
        /broadcastId=\d+/.test(s.biz_opaque_callback_data)
      );

    case "MSG_DELIVERED":
      return statuses.some((s: any) => s.status === "delivered");

    case "MSG_READ":
      return statuses.some((s: any) => s.status === "read");

    case "TEMPLATE_CATEGORY_UPDATE":
      // Always return true for template category updates as they don't have messages/statuses
      return true;

    default:
      // payments & template failures come via other Graph fields,
      // so we shouldn't get here for those
      return false;
  }
}

export const triggerMyWebhooks = async (change: any) => {
  const graphField = change.field;                                 // e.g. "messages"
  const agentPhoneNumber = change.value?.metadata?.display_phone_number;

  // 1) find which UI codes subscribe to this Graph field
  const matchingUiCodes = Object.entries(graphFieldMap)
    .filter(([, gf]) => gf === graphField)
    .map(([ui]) => ui);
  if (!matchingUiCodes.length) return;

  // 2) load hooks whose eventTypes is one of those UI-codes
  const hooks = await prisma.webhook.findMany({
    where: {
      status: 'Enabled',
      eventTypes: {in: matchingUiCodes},
      businessPhoneNumber: {phoneNumber: agentPhoneNumber},
    },
  });
  if (!hooks.length) return;

  // 3) for each hook, only fire if matchesEvent says "yes"
  await Promise.all(hooks.map(async hook => {
    if (!(await matchesEvent(hook.eventTypes, change.value))) {
      return; // skip it
    }
    // Use the new logging function
    await executeWebhookWithLogging(
      hook,
      {
        eventType: graphField,
        exactEventType: hook.eventTypes,
        agentPhoneNumber: agentPhoneNumber,
        contact: change.value?.contacts?.[0]?.profile?.name||change.value?.statuses?.[0]?.recipient_id,
        message: change.value?.messages?.[0],
        wamid: change.value?.statuses?.[0]?.id,
        timestamp: change.value?.statuses?.[0]?.timestamp
      },
      graphField,
      hook.businessPhoneNumberId
    );
  }));
};


export const processMessageUpdate = async (value: any, io: any) => {
  const agentPhoneNumber = value?.metadata?.display_phone_number;

  const phoneNumberId = value?.metadata?.phone_number_id;
  const bp = await prisma.businessPhoneNumber.findFirst({
    where: {metaPhoneNumberId: phoneNumberId || ""},
  });
  const dbUser = await prisma.user.findFirst({
    where: {selectedPhoneNumberId: phoneNumberId},
  });
  const packageSubscription = await prisma.packageSubscription.findFirst({
    where: {userId: dbUser?.id, isActive: true},
  });

  const message = value?.messages?.[0];
  const senderName = value?.contacts?.[0]?.profile?.name;
  const sender = message?.from;
  if (!sender) {
    //console.warn("Sender is undefined. Cannot query contact.");
    return;
  }


  const contact = await prisma.contact.findUnique({
    where: {phoneNumber: sender},
    include: {
      user: true,
      assignedTeams: {
        include: {
          users: true,
        },
      },
    },
  });
  let finalContact = contact;

  if (!finalContact) {
    const botUser = await prisma.user.findFirst({
      where: {
        email: "bot",
      },
    });
    finalContact = await prisma.contact.create({
      data: {
        phoneNumber: sender,
        name: senderName,
        source: "WhatsApp", // or you can dynamically set this
        subscribed: true,
        sendSMS: true,
        createdById: dbUser?.id,
        userId: botUser?.id
      },
      include: {
        user: true,
        assignedTeams: {
          include: {users: true},
        },
      },
    });

    await prisma.chatStatusHistory.create({
      data: {
        contactId: finalContact.id,
        newStatus: "Assigned",
        type: "assignmentChanged",
        note: `Assigned to bot`,
        assignedToUserId: botUser?.id,
        changedById: null,
        changedAt: new Date(),
      }
    })
  }
  if (!finalContact) return;
  if (packageSubscription) {
    if (packageSubscription.packageName === "Free") {
      const messageLength = await prisma.message.count({
        where: {
          contactId: finalContact?.id,
        },
      });
      if (messageLength >= parseInt(process.env.FREE_PACKAGE_MESSAGE_LIMIT || "100") || sender !== dbUser?.phoneNumber) {
        return;
      }
    }
  }
  let notifyEmails: Set<string> = new Set();

  if (finalContact.user?.email) {
    notifyEmails.add(finalContact.user.email);
  }

  for (const team of finalContact.assignedTeams) {
    for (const agent of team.users) {
      notifyEmails.add(agent.email);
    }
  }
// For now, let's simplify and get all users with notification settings
  const finalRecipients = await prisma.user.findMany({
    where: {
      email: {in: Array.from(notifyEmails)},
    },
    select: {email: true},
  });

// 🔔 Step 4: Emit only to those eligible
  const messageAssignedEmails = finalRecipients.map((u) => u.email);

  if (!sender) return;


//create media url for media messages,otherwise directly save in db with creating conversation
  const processedMessage = await processWebhookMessage(
    sender,
    message,
    agentPhoneNumber,
    phoneNumberId,
    finalContact.id
  );
  const agent = await prisma.user.findFirst({
    where: {selectedPhoneNumberId: phoneNumberId},
  });
  console.log("agent?.email", agent?.email);
  if (!agent) {
    console.warn("No agent found for phone number ID:", phoneNumberId);
    return;
  }
//rules checking first
// Fetch Active Rules for this agent/user
  const activeRules = await prisma.rule.findMany({
    where: {
      businessPhoneNumberId: bp?.id,
      status: "Active",
      triggerType: "whatsappMessage",
    },
  });

  if (activeRules.length > 0) {
    for (const rule of activeRules) {
      await processRuleForMessage(rule, sender, message, phoneNumberId, dbUser?.id);
    }
  }

  //notification to the creator of the agent
  const creatorId = agent.createdById ?? agent.id;
  console.log("creatorId", creatorId);
  // 📢 Find all users created by the same creator (including the agent himself)
  const notifyUsers = await prisma.user.findMany({
    where: {
      OR: [
        {id: creatorId},
        {createdById: creatorId},
      ],
    },
    select: {email: true},
  });

  const recipients = notifyUsers.map((u) => u.email);
  io.emit("newMessage", {
    recipients, // ✅ Emit to team-level
    recipient: sender,//from which contact
    message: processedMessage,
  });

//cheks whether the message is a text/button reply/list reply/question response/matches to existing keyword and transfer to logics accordingly
  await handleConversationFlow(sender, message, phoneNumberId);
};

export const isAllowedSender = (sender: string): boolean => {
  const allowedTestNumbers = process.env.ALLOWED_TEST_NUMBERS
    ? process.env.ALLOWED_TEST_NUMBERS.split(",").map((num) => num.trim())
    : [];

  return allowedTestNumbers.includes(sender);
};

const processRuleForMessage = async (
  rule: Rule,
  sender: string,
  message: any,
  phoneNumberId: string | undefined,
  agentId: number | undefined
) => {
  const actionType = rule.action;
  const actionData = rule.actionData as any;
  const conditions = rule.conditions as any;
  const contact = await prisma.contact.findUnique({
    where: {phoneNumber: sender,},
  });

  // Step 1: Evaluate Conditions FIRST
  const conditionsMet = await evaluateRuleConditions(conditions, sender, message, phoneNumberId);

  if (!conditionsMet) {
    console.log(`Rule "${rule.name}" skipped: Conditions not met`);
    return;
  }

  // Step 2: Perform the action (same as before)
  switch (actionType) {
    case "sendTemplate":
      await sendTemplate(sender, actionData.templateId, 0, {}, phoneNumberId);
      break;
    case "sendMessage": {
      const {messageType, replyId} = actionData;

      if (messageType && replyId) {
        const materialType = messageType; // 'VIDEO', 'TEXT', etc.
        const materialId = parseInt(replyId, 10);

        const sent = await sendDefaultMaterial(materialType, materialId, sender, 0, phoneNumberId);
        if (sent) {
          console.log(`sendMessage action executed successfully for rule ${rule.name}`);
        } else {
          console.warn(`Failed to send message for rule ${rule.name}`);
        }
      }
      break;
    }
    case "routeChat": {
      const {routingType, selectedOptions} = actionData;

      if (!routingType || !Array.isArray(selectedOptions) || selectedOptions.length === 0) {
        console.log("❌ Invalid routeChat action data");
        break;
      }

      const selected = selectedOptions[0]; // We're assuming single-select

      if (routingType === "agent") {
        await prisma.contact.update({
          where: {id: contact?.id},
          data: {userId: selected.id},
        });
        if (contact) {
          await prisma.chatStatusHistory.create({
            data: {
              contactId: contact?.id,
              previousStatus: contact?.ticketStatus,
              newStatus: "Assigned",
              type: "assignmentChanged",
              note: `Assigned to agent ${selected.name}`,
              assignedToUserId: selected.id,
              changedById: null,
              changedAt: new Date(),
            },
          });

          console.log(`✅ Assigned agent ${selected.name} to contact ${sender}`);
        }

        if (routingType === "team") {
          // Fetch current assigned teams
          const fullContact = await prisma.contact.findUnique({
            where: {id: contact?.id},
            include: {assignedTeams: true},
          });

          const alreadyAssigned = fullContact?.assignedTeams.some((team) => team.id === selected.id);

          if (!alreadyAssigned) {
            await prisma.contact.update({
              where: {id: contact?.id},
              data: {
                assignedTeams: {
                  connect: {id: selected.id},
                },
              },
            });
            if (contact) {
              await prisma.chatStatusHistory.create({
                data: {
                  contactId: contact?.id,
                  previousStatus: contact?.ticketStatus,
                  newStatus: "TeamAssigned",
                  type: "assignmentChanged",
                  note: `Assigned to team ${selected.name}`,
                  changedById: null,
                  changedAt: new Date(),
                  timerStartTime: contact?.ticketStatus === "Open" ? new Date() : contact?.timerStartTime,
                },
              });

              console.log(`✅ Assigned team ${selected.name} to contact ${sender}`);
            }
          }

          break;
        }

      }
      break;
    }
    case "startChatbot": {
      const chatbot = await prisma.chatbot.findFirst({
        where: {
          id: parseInt(actionData.chatbotId, 10),
        },
      });
      if (chatbot) {
        await handleChatbotTrigger("chatbot:" + chatbot.name, sender, phoneNumberId);
      }
      break;
    }
    case "updateAttribute": {
      const material = await prisma.replyMaterial.findFirst({
        where: {
          id: parseInt(actionData.attributeId, 10)
        }
      });

      if (!material?.content) break;

      let parsedAttributes: { attribute: string; value: string }[] = [];

      try {
        parsedAttributes = JSON.parse(material.content);
      } catch (e) {
        console.error("Failed to parse attributes JSON:", e);
        break;
      }

      const contact = await prisma.contact.findFirst({
        where: {phoneNumber: sender}
      });

      const normalizeBool = (val: string | null) =>
        val?.toLowerCase() === "true" ? true : false;

      const directFields: any = {};
      const flatAttributes: Record<string, string> = {};

      parsedAttributes.forEach(({attribute, value}) => {
        switch (attribute) {
          case "allowbrodcast":
            directFields.subscribed = normalizeBool(value);
            break;
          case "allowsms":
            directFields.sendSMS = normalizeBool(value);
            break;
          case "Source":
          case "Channel":
            directFields.source = value || "Unknown";
            break;
          default:
            flatAttributes[attribute] = value;
        }
      });

      if (contact) {
        const existingAttrs = (contact.attributes || {}) as Prisma.JsonObject;

        await prisma.contact.update({
          where: {id: contact.id},
          data: {
            ...directFields,
            attributes: {
              ...existingAttrs,
              ...flatAttributes,
            },
          },
        });

        console.log(`Contact ${contact.id} updated with attributes`);
      } else {
        await prisma.contact.create({
          data: {
            phoneNumber: sender,
            attributes: flatAttributes,
            ...directFields,
            createdById: agentId,
          },
        });

        console.log(`Contact ${sender} created with attributes`);
      }

      break;
    }
    default:
      console.log(`Rule "${rule.name}" has an unknown action type.`);
  }

  // Increment rule's executed count
  await prisma.rule.update({
    where: {id: rule.id},
    data: {executed: {increment: 1}},
  });
};

const evaluateRuleConditions = async (
  conditions: any,
  sender: string,
  message: any,
  phoneNumberId: string | undefined
): Promise<boolean> => {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  const contact = await prisma.contact.findUnique({
    where: {phoneNumber: sender},
  });

  if (!contact) return false;

  // 1️⃣ Keyword Filter
  if (conditions.keywordFilter) {
    const text = message?.text?.body || "";
    const { keywords, threshold, matchType } = conditions.keywordFilter;

    if (keywords) {
      // Parse comma-separated keywords and create keyword objects
      const keywordArray = keywords.split(',').map((kw: string, index: number) => ({
        id: index,
        value: kw.trim(),
        matchType: matchType || 'FUZZY',
        fuzzyPercent: threshold || 80
      }));

      // Use the matching logic to find if any keyword matches
      const matchResult = findMatchingKeyword(text, keywordArray);


      // Return false if NO match found (condition not met)
      if (!matchResult) {
        return false;
      }
    }
  }
  if (conditions.selectedFilter === "contact") {
    const {operator, value} = conditions.contactFilter;
    const contactPhoneNumber = contact.phoneNumber;
    const contactCreationTime = contact.createdAt;

    // Calculate time difference in seconds since contact creation
    const now = new Date();
    const timeDifferenceInSeconds = (now.getTime() - new Date(contactCreationTime).getTime()) / 1000;

    switch (operator) {
      case "exists":
        // Contact "exists" if it was created more than 30 seconds ago
        if (timeDifferenceInSeconds < 0.20) return false;
        break;

      case "not_exists":
        // Contact "not_exists" if it was created less than 30 seconds ago (new contact)
        if (timeDifferenceInSeconds >= 0.20) return false;
        break;

      case "equals":
        if (contactPhoneNumber !== value) return false;
        break;

      case "not_equals":
        if (contactPhoneNumber === value) return false;
        break;

      case "contains":
        if (!contactPhoneNumber.includes(value)) return false;
        break;

      case "not_contains":
        if (contactPhoneNumber.includes(value)) return false;
        break;

      default:
        return false; // Unknown operator, fail-safe
    }
  }
  if (conditions.selectedFilter === "noKeyword") {
    const text = message?.text?.body || "";

    // Get all keywords to perform advanced matching
    const allKeywords = await prisma.keyword.findMany();

    // Use the new matching logic to find the best matching keyword
    const matchResult = findMatchingKeyword(text, allKeywords);
    const keyword = matchResult?.keyword;

    if (!keyword) {
      return false;

    }
  }
  // 2️⃣ Contact Attribute Filter (Json attributes field)
  if (conditions.contactAttributeFilter) {
    const {attribute, operator, value} = conditions.contactAttributeFilter;

    // Check direct fields first
    const directFields = ["allowbrodcast", "allowsms", "Source", "Channel"];
    let attrValue: any;

    if (directFields.includes(attribute)) {
      switch (attribute) {
        case "allowbrodcast":
          attrValue = contact.subscribed;
          break;
        case "allowsms":
          attrValue = contact.sendSMS;
          break;
        case "Source":
          attrValue = contact.source;
          break;
        case "Channel":
          attrValue = contact.source;
          break;
      }
    } else {
      const attributesObj = contact.attributes as Record<string, any>;
      attrValue = attributesObj?.[attribute];
    }

    if (attrValue === undefined || attrValue === null) return false;

    const attrStr = attrValue.toString().toLowerCase();
    const filterVal = value.toString().toLowerCase();

    switch (operator) {
      case "equals":
        if (attrStr !== filterVal) return false;
        break;
      case "not_equals":
        if (attrStr === filterVal) return false;
        break;
      case "contains":
        if (!attrStr.includes(filterVal)) return false;
        break;
      case "not_contains":
        if (attrStr.includes(filterVal)) return false;
        break;
      default:
        return false;
    }
  }

  // 3️⃣ Tags Filter (You can add a new type if you like)
  if (conditions.tagsFilter) {
    const requiredTags = conditions.tagsFilter.tags?.map((t: string) => t.trim().toLowerCase());
    const contactTags = contact.tags.map((t: string) => t.toLowerCase());

    const tagMatches = requiredTags.every((tag: string) => contactTags.includes(tag));
    if (!tagMatches) return false;
  }

  // 4️⃣ Timestamp Filter
  if (conditions.timestampFilter) {
    const operator = conditions.timestampFilter.operator;
    const value = parseInt(conditions.timestampFilter.value, 10);
    const unit = conditions.timestampFilter.unit;
    const now = new Date();

    // ⬇️ If working hour related, fetch DefaultActionSettings from Prisma
    if (operator === "is_within" || operator === "not_within") {
      const bp = await prisma.businessPhoneNumber.findFirst({where: {metaPhoneNumberId: phoneNumberId}});
      const defaultActionSettings = await prisma.defaultActionSettings.findUnique({
        where: {
          businessPhoneNumberId: bp?.id, // ⬅️ Make sure you have this available
        },
        select: {
          workingHours: true,
        },
      });

      const workingHours: any = defaultActionSettings?.workingHours || {};

      console.log(`🕐 Rule processing: Checking working hours for timezone filter...`);

      // Get user's timezone for working hours check
      const user = await prisma.user.findFirst({
        where: {selectedPhoneNumberId: phoneNumberId},
        include: {businessAccount: true}
      });
      const userTimezone = user?.businessAccount?.[0]?.timeZone || 'UTC';

      console.log(`🌍 Rule timezone information:`);
      console.log(`   - User ID: ${user?.id || 'NOT FOUND'}`);
      console.log(`   - Business Account ID: ${user?.businessAccount?.[0]?.id || 'NOT FOUND'}`);
      console.log(`   - User Timezone: ${userTimezone}`);
      console.log(`   - Rule Operator: ${operator}`);
      console.log(`   - Working Hours:`, JSON.stringify(workingHours, null, 2));

      // Use the enhanced isWithinWorkingHours function with timezone support
      const {isWithinWorkingHours} = await import('../processors/metaWebhook/keywordProcessor');
      const isWithin = isWithinWorkingHours(workingHours, userTimezone);

      console.log(`📊 Rule working hours check result: ${isWithin ? 'WITHIN HOURS' : 'OUTSIDE HOURS'}`);

      if (operator === "is_within" && !isWithin) return false;
      if (operator === "not_within" && isWithin) return false;
    }

    // ⬇️ Continue with time difference comparisons
    if (operator === "less_than" || operator === "greater_than") {
      const receivedAt = new Date(message.timestamp * 1000); // UNIX timestamp
      const diffMs = now.getTime() - receivedAt.getTime();
      const diffMinutes = diffMs / (1000 * 60);
      const diffHours = diffMinutes / 60;

      const compareValue = unit === "hours" ? diffHours : diffMinutes;

      if (operator === "less_than" && !(compareValue < value)) return false;
      if (operator === "greater_than" && !(compareValue > value)) return false;
    }
  }


  // 5️⃣ New Chat Filter
  if (conditions.selectedFilter === "newChat") {
    const bp = await prisma.businessPhoneNumber.findFirst({where: {metaPhoneNumberId: phoneNumberId}});
    const recentConversation = await prisma.conversation.findFirst({
      where: {recipient: sender, businessPhoneNumberId: bp?.id},
      orderBy: {createdAt: "desc"},
    });
    const messageCount = await prisma.message.count({
      where: {conversationId: recentConversation?.id},
    });
    if (messageCount < 2) return true;
    else return false;
  }

  // 6️⃣ Condition Blocks (Advanced: skip or implement later)
  if (conditions.conditionBlocks && Array.isArray(conditions.conditionBlocks)) {
    // Let's skip for now unless you want to handle complex logic
    // return false;
  }

  // ✅ All conditions passed
  return true;
};


export const handleConversationFlow = async (
  recipient: string,
  message: any,
  agentPhoneNumber: string
) => {
  const conversation = await findOrCreateConversation(recipient, message, agentPhoneNumber);
  //if (!conversation) return;


  if (message?.interactive) {
    const chatbotData = await getChatbotData(conversation.lastNodeId ? conversation.lastNodeId : conversation.currentNodeId);
    if (!chatbotData) return;
    await handleInteractiveMessage(message, chatbotData, recipient, agentPhoneNumber);
    return;
  }

  if (conversation && conversation.answeringQuestion) {
    const chatbotData = await getChatbotData(conversation.currentNodeId);
    if (!chatbotData) return;
    await handleQuestionResponse(conversation, message, chatbotData, recipient, agentPhoneNumber);
    return;
  }

  const text = message?.text?.body?.toLowerCase();
  if (text) {
    await processKeyword(text, recipient, agentPhoneNumber);
  }
};
type TimeSlot = {
  from: string;
  to: string;
};

type DaySchedule = {
  open: boolean;
  times: TimeSlot[];
};

type WorkingHours = {
  [day: string]: DaySchedule;
};

export const findOrCreateConversation = async (
  recipient: string,
  message: any,
  agentPhoneNumberId: string | undefined
): Promise<any> => {
  // 1️⃣ Always start by fetching the latest convo (if any)
  let conversation = await prisma.conversation.findFirst({
    where: {recipient},
    orderBy: [{updatedAt: 'desc'}, {createdAt: 'desc'}],

  });

  // 2️⃣ If this is an interactive message, just return that convo
  if (message?.interactive) {
    if (!conversation) {
      console.warn(
        `No existing conversation found for interactive message from ${recipient}`
      );
      return null;
    }
    return conversation;
  }

  // 3️⃣ Otherwise (text) — extract keyword and lookup chatbotId
  const text = message?.text?.body?.toLowerCase();
  let chatbotId = null;
  if (conversation && conversation.answeringQuestion) {
    chatbotId = conversation.chatbotId;
  } else chatbotId = text ? await findChatbotIdByKeyword(text) : null;

  if (!chatbotId && conversation && !conversation.answeringQuestion) {
    const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
      where: {metaPhoneNumberId: agentPhoneNumberId},
      select: {
        id: true,
        fallbackEnabled: true,
        fallbackMessage: true,
        fallbackTriggerCount: true,
        defaultActionSettings: true,  // your existing logic
        fallbackHitCount: true,
      }
    });

    // inside working hours fallback
    if (businessPhoneNumber?.fallbackEnabled && businessPhoneNumber.fallbackMessage) {
      const {
        id,
        fallbackTriggerCount,
        fallbackHitCount,
        fallbackMessage
      } = businessPhoneNumber;

      const nextHitCount = fallbackHitCount + 1;

      if (nextHitCount > fallbackTriggerCount) {
        // threshold reached → reset counter and send
        await prisma.businessPhoneNumber.update({
          where: {id},
          data: {fallbackHitCount: 0}
        });

        console.log(
          `No keyword match—hit ${nextHitCount}/${fallbackTriggerCount}, sending fallback.`
        );

      } else {
        await sendMessage(
          recipient,
          {type: "text", message: fallbackMessage},
          1, 1, true, agentPhoneNumberId
        );
        // below threshold → just increment counter
        await prisma.businessPhoneNumber.update({
          where: {id},
          data: {fallbackHitCount: nextHitCount}
        });

        console.log(
          `No keyword match—hit ${nextHitCount}/${fallbackTriggerCount}, not sending yet.`
        );
      }

      return true;
    }
    return false;
  }

  // 4️⃣ If a convo exists, update its chatbotId if it changed
  if (conversation) {
    if (conversation.chatbotId !== chatbotId) {
      conversation = await prisma.conversation.update({
        where: {id: conversation.id},
        data: {chatbotId, answeringQuestion: false},
      });
      //   console.log("Existing conversation updated:", conversation);
    }
  } else {
    // 5️⃣ Otherwise create a brand-new conversation
    conversation = await prisma.conversation.create({
      data: {
        recipient,
        chatbotId,
        answeringQuestion: true,
      },
    });
    console.log("New conversation created:", conversation);
  }

  return conversation;
};


export const getChatbotData = async (nodeId: number): Promise<any> => {

  if (!nodeId) return null;

  const nodeWithChatbot = await prisma.node.findUnique({
    where: {id: nodeId},
    include: {
      chatbot: {
        include: {
          nodes: true,
          edges: true,
        }
      }
    }
  })

  if (!nodeWithChatbot) {
    throw new Error(`Node ${nodeId} not found`)
  }

  // now you have the full chatbotData
  const chatbotData = nodeWithChatbot.chatbot;

  if (!chatbotData) {
    console.warn(`Chatbot with ID  not found.`);
    return null;
  }

  return chatbotData;
};

export const handleInteractiveMessage = async (
  message: any,
  chatbotData: any,
  recipient: string,
  agentPhoneNumberId: string | undefined
) => {
  if (message?.interactive?.button_reply) {
    await handleButtonReply(message.interactive.button_reply, chatbotData, recipient, agentPhoneNumberId);
  } else if (message?.interactive?.list_reply) {
    await handleListReply(message.interactive.list_reply, chatbotData, recipient, agentPhoneNumberId);
  }
};

export const handleButtonReply = async (
  buttonReply: any,
  chatbotData: any,
  recipient: string,
  agentPhoneNumberId: string | undefined
) => {
  const parts = buttonReply.id.split("_node_");
  const buttonId = "source_" + parts[0];
  const nodeId = parseInt(parts[1]);
  const nodeWithChatbot = await prisma.node.findUnique({
    where: {id: nodeId},
    include: {
      chatbot: {
        include: {
          nodes: true,
          edges: true,
        }
      }
    }
  })

  if (!nodeWithChatbot) {
    throw new Error(`Node ${nodeId} not found`)
  }

  // now you have the full chatbotData
  chatbotData = nodeWithChatbot.chatbot;
  const selectedEdge = chatbotData.edges.find(
    (edge: any) => edge.sourceHandle === buttonId && edge.sourceId === nodeId
  );

  const nextNodeId = selectedEdge
    ? chatbotData.nodes.find((node: any) => node.id === selectedEdge.targetId)?.nodeId
    : null;

  const currentNode = chatbotData.nodes.find((node: any) => node.id === nodeId);

  if (currentNode?.data?.buttons_data?.saveAnswerVariable) {
    await saveButtonReplyVariable(
      currentNode,
      buttonReply.title,
      recipient
    );
  }

  if (nextNodeId) {
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient, agentPhoneNumberId);
  } else {
    await bump(chatbotData.id, "finished");
  }
};

export const saveButtonReplyVariable = async (
  currentNode: any,
  buttonTitle: string,
  recipient: string
) => {
  const variableName = currentNode.data.buttons_data.saveAnswerVariable.startsWith("@")
    ? currentNode.data.buttons_data.saveAnswerVariable.slice(1)
    : currentNode.data.buttons_data.saveAnswerVariable;

  const conversation = await prisma.conversation.findFirst({
    where: {recipient, chatbotId: currentNode.chatId},
  });

  if (conversation) {
    await saveOrUpdateVariable(
      variableName,
      buttonTitle,
      currentNode.chatId,
      conversation.id,
      currentNode.id
    );
  }
};

export const handleListReply = async (
  listReply: any,
  chatbotData: any,
  recipient: string,
  agentPhoneNumberId: string | undefined
) => {
  const listReplyId = listReply.id;
  const nodeId = parseInt(listReplyId.split("_node_")[1]);
  const buttonId = listReplyId.split("_node_")[0];
  const nodeWithChatbot = await prisma.node.findUnique({
    where: {id: nodeId},
    include: {
      chatbot: {
        include: {
          nodes: true,
          edges: true,
        }
      }
    }
  })

  if (!nodeWithChatbot) {
    throw new Error(`Node ${nodeId} not found`)
  }


  // now you have the full chatbotData
  chatbotData = nodeWithChatbot.chatbot;

  const currentNode = chatbotData.nodes.find((node: any) => node.id === nodeId);
  if (currentNode?.data?.list_data?.saveAnswerVariable) {
    await saveListReplyVariable(
      currentNode,
      listReply.title,
      recipient
    );
  }
  const selectedEdge = chatbotData.edges.find(
    (edge: any) => edge.sourceId === currentNode?.id && edge.sourceHandle === buttonId
  );

  const nextNodeId = selectedEdge
    ? chatbotData.nodes.find((node: any) => node.id === selectedEdge.targetId)?.nodeId
    : null;

  if (nextNodeId) {
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient, agentPhoneNumberId);
  } else {
    await bump(chatbotData.id, "finished");
  }
};

export const saveListReplyVariable = async (
  currentNode: any,
  listTitle: string,
  recipient: string
) => {
  const variableName = currentNode.data.list_data.saveAnswerVariable.startsWith("@")
    ? currentNode.data.list_data.saveAnswerVariable.slice(1)
    : currentNode.data.list_data.saveAnswerVariable;

  const conversation = await prisma.conversation.findFirst({
    where: {recipient, chatbotId: currentNode.chatId},
  });

  if (conversation) {
    await saveOrUpdateVariable(
      variableName,
      listTitle,
      currentNode.chatId,
      conversation.id,
      currentNode.id
    );
  }
};

export const saveOrUpdateVariable = async (
  variableName: string,
  value: string,
  chatbotId: number,
  conversationId: number,
  nodeId: number
) => {
  const existingVariable = await prisma.variable.findFirst({
    where: {
      name: variableName,
      chatbotId,
      conversationId,
    },
  });

  if (existingVariable) {
    await prisma.variable.update({
      where: {id: existingVariable.id},
      data: {value, nodeId},
    });
  } else {
    await prisma.variable.create({
      data: {
        name: variableName,
        value,
        chatbotId,
        conversationId,
      },
    });
  }
};

export const handleQuestionResponse = async (
  conversation: any,
  message: any,
  chatbotData: any,
  recipient: string,
  agentPhoneNumberId: string | undefined
) => {
  const currentNode = await prisma.node.findFirst({
    where: {id: conversation.currentNodeId},
  });

  if (currentNode?.type !== "question") return;
  if (typeof currentNode.data === 'object' && currentNode.data !== null && !Array.isArray(currentNode.data)) {
    const {
      validation,
      validationFailureExitCount = 3,
      saveAnswerVariable,
    } = (currentNode.data as { question_data?: any }).question_data ?? {};


    let failureCount = conversation.validationFailureCount;
    const text = message?.text?.body?.toLowerCase();

    if (message?.type !== "text" || !text) return;

    const isValid = validateUserResponse(text, validation);

    if (isValid) {
      await handleValidQuestionResponse(
        conversation,
        currentNode,
        text,
        saveAnswerVariable,
        chatbotData,
        recipient,
        agentPhoneNumberId
      );
    } else {
      await handleInvalidQuestionResponse(
        conversation,
        failureCount,
        validationFailureExitCount,
        validation,
        agentPhoneNumberId
      );
    }
  }
};

export const handleValidQuestionResponse = async (
  conversation: any,
  currentNode: any,
  text: string,
  saveAnswerVariable: string,
  chatbotData: any,
  recipient: string,
  agentPhoneNumberId: string | undefined
) => {
  await prisma.conversation.update({
    where: {id: conversation.id},
    data: {
      answeringQuestion: false,
      validationFailureCount: 0,
    },
  });

  if (saveAnswerVariable) {
    const variableName = saveAnswerVariable.startsWith("@")
      ? saveAnswerVariable.slice(1)
      : saveAnswerVariable;

    await saveOrUpdateVariable(
      variableName,
      text,
      currentNode.chatId,
      conversation.id,
      currentNode.id
    );
  }

  console.log("Text response is valid. Proceeding to the next node...");
  const nextNodeId = getNextNodeIdFromQuestion(
    chatbotData,
    null,
    currentNode.id
  );

  if (nextNodeId) {
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient, agentPhoneNumberId);
  } else {
    await bump(chatbotData.id, "finished");
  }
};

export const handleInvalidQuestionResponse = async (
  conversation: any,
  failureCount: number,
  validationFailureExitCount: number,
  validation: any,
  agentPhoneNumberId: string | undefined
) => {
  failureCount += 1;

  if (failureCount >= validationFailureExitCount) {
    await prisma.conversation.update({
      where: {id: conversation.id},
      data: {
        answeringQuestion: false,
        validationFailureCount: 0,
      },
    });

    await sendMessage(
      conversation.recipient,
      {
        type: "text",
        message: `You have given incorrect answers ${validationFailureExitCount} times. Closing chatflow.`,
      },
      conversation.chatbotId,
      conversation.userId,
      true,
      agentPhoneNumberId
    );

    console.warn("Chatflow ended due to repeated invalid responses.");
  } else {
    await prisma.conversation.update({
      where: {id: conversation.id},
      data: {validationFailureCount: failureCount},
    });

    console.warn(`Response is invalid. Failure count: ${failureCount}`);
    await sendMessage(
      conversation.recipient,
      {
        type: "text",
        message: validation?.errorMessage || "Invalid response. Please try again.",
      },
      conversation.chatbotId,
      conversation.userId,
      true,
      agentPhoneNumberId
    );
  }
};

export const updateTemplateInDb = async (data: any, reason: string) => {
  const {
    event,
    message_template_id,
    message_template_name,
    message_template_language,
  } = data;

  await prisma.template.update({
    where: {name: message_template_name},
    data: {
      status: event,
      language: message_template_language,
      updatedAt: new Date(),
      rejectionError: reason || "",
    },
  });
};

export const updateTemplateCategoryInDb = async (data: any) => {
  const {
    message_template_id,
    message_template_name,
    message_template_language,
    new_category,
  } = data;

  try {


    if (!message_template_id) {
      console.log('No template ID found in webhook data, skipping category update');
      return;
    }

    // First check if template exists by searching in the content field
    const existingTemplate = await prisma.template.findFirst({
      where: {
        content: {
          contains: `"id":"${message_template_id}"`
        }
      },
    });

    if (!existingTemplate) {
      console.log(`Template with ID ${message_template_id} not found in database, skipping category update`);
      return;
    }

    await prisma.template.update({
      where: {id: existingTemplate.id},
      data: {
        category: new_category,
        updatedAt: new Date(),
      },
    });

    console.log(`Template category updated for template ID ${message_template_id}: ${new_category}`);
  } catch (error) {
    console.error(`Error updating template category for template ID ${message_template_id}:`, error);
  }
};

export const getNextNodeIdFromQuestion = (
  chatbotData: any,
  buttonId: string | null,
  currentNodeId: number
): string | null => {
  const outgoingEdge = chatbotData.edges.find((edge: any) => {
    return (
      edge.sourceId === currentNodeId &&
      (!buttonId || edge.sourceHandle === buttonId)
    );
  });

  if (!outgoingEdge) {
    console.warn(`No outgoing edge found for node ID: ${currentNodeId}`);
    return null;
  }

  const nextNode = chatbotData.nodes.find(
    (node: any) => node.id === outgoingEdge.targetId
  );

  if (!nextNode) {
    console.warn(
      `No target node found for edge from node ID: ${currentNodeId}`
    );
    return null;
  }

  return nextNode.nodeId;
};

export const findChatbotIdByKeyword = async (text: string): Promise<number | null> => {
  // Get all keywords to perform advanced matching
  const allKeywords = await prisma.keyword.findMany({
    include: {chatbot: true},
  });

  // Use the new matching logic to find the best matching keyword
  const matchResult = findMatchingKeyword(text, allKeywords);
  const keyword = matchResult?.keyword;

  return keyword?.chatbot?.id || null;
};

export const checkRulesForNodeAction = async (
  recipient: string,
  nodeType: "attributeChanged" | "attributeAdded",
  phoneNumberId: string | undefined,
  agentId: number | undefined
) => {
  try {
    // Get business phone number
    const bp = await prisma.businessPhoneNumber.findFirst({
      where: {metaPhoneNumberId: phoneNumberId},
    });

    if (!bp) {
      console.warn("No business phone number found for phone number ID:", phoneNumberId);
      return;
    }

    // Fix triggerType
    const activeRules = await prisma.rule.findMany({
      where: {
        businessPhoneNumberId: bp.id,
        status: "Active",
        triggerType: {
          in: [nodeType]
        }
      },
    });

    if (activeRules.length === 0) {
      return; // No rules to process
    }

    // Create a mock message object for rule evaluation
    const mockMessage = {
      type: "text",
      text: {body: `Node action: ${nodeType}`},
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Process each rule
    for (const rule of activeRules) {
      await processRuleForNodeAction(rule, recipient, mockMessage, phoneNumberId, agentId, nodeType);
    }
  } catch (error) {
    console.error("Error checking rules for node action:", error);
  }
};

const processRuleForNodeAction = async (
  rule: Rule,
  recipient: string,
  message: any,
  phoneNumberId: string | undefined,
  agentId: number | undefined,
  nodeType: string
) => {
  const actionType = rule.action;
  const actionData = rule.actionData as any;
  const conditions = rule.conditions as any;

  const contact = await prisma.contact.findUnique({
    where: {phoneNumber: recipient},
  });

  if (!contact) {
    console.log(`Contact not found for recipient ${recipient}`);
    return;
  }

  // Step 1: Evaluate Conditions
  const conditionsMet = await evaluateRuleConditionsForNodeAction(conditions, recipient, message, phoneNumberId, nodeType);

  if (!conditionsMet) {
    console.log(`Rule "${rule.name}" skipped: Conditions not met for node action ${nodeType}`);
    return;
  }

  // Step 2: Perform the action
  switch (actionType) {
    case "sendTemplate":
      await sendTemplate(recipient, actionData.templateId, 0, {}, phoneNumberId);
      break;
    case "sendMessage": {
      const {messageType, replyId} = actionData;

      if (messageType && replyId) {
        const materialType = messageType;
        const materialId = parseInt(replyId, 10);

        const sent = await sendDefaultMaterial(materialType, materialId, recipient, 0, phoneNumberId);
        if (sent) {
          console.log(`sendMessage action executed successfully for rule ${rule.name} (${nodeType})`);
        } else {
          console.warn(`Failed to send message for rule ${rule.name} (${nodeType})`);
        }
      }
      break;
    }
    case "routeChat": {
      const {routingType, selectedOptions} = actionData;

      if (!routingType || !Array.isArray(selectedOptions) || selectedOptions.length === 0) {
        console.log("❌ Invalid routeChat action data");
        break;
      }

      const selected = selectedOptions[0];

      if (routingType === "agent") {
        await prisma.contact.update({
          where: {id: contact.id},
          data: {userId: selected.id},
        });

        await prisma.chatStatusHistory.create({
          data: {
            contactId: contact.id,
            previousStatus: contact.ticketStatus,
            newStatus: "Assigned",
            type: "assignmentChanged",
            note: `Assigned to agent ${selected.name} via rule (${nodeType})`,
            assignedToUserId: selected.id,
            changedById: null,
            changedAt: new Date(),
          },
        });

        console.log(`✅ Assigned agent ${selected.name} to contact ${recipient} via rule (${nodeType})`);
      }

      if (routingType === "team") {
        const fullContact = await prisma.contact.findUnique({
          where: {id: contact.id},
          include: {assignedTeams: true},
        });

        const alreadyAssigned = fullContact?.assignedTeams.some((team) => team.id === selected.id);

        if (!alreadyAssigned) {
          await prisma.contact.update({
            where: {id: contact.id},
            data: {
              assignedTeams: {
                connect: {id: selected.id},
              },
            },
          });

          await prisma.chatStatusHistory.create({
            data: {
              contactId: contact.id,
              previousStatus: contact.ticketStatus,
              newStatus: "TeamAssigned",
              type: "assignmentChanged",
              note: `Assigned to team ${selected.name} via rule (${nodeType})`,
              changedById: null,
              changedAt: new Date(),
              timerStartTime: contact.ticketStatus === "Open" ? new Date() : contact.timerStartTime,
            },
          });

          console.log(`✅ Assigned team ${selected.name} to contact ${recipient} via rule (${nodeType})`);
        }
      }
      break;
    }
    case "startChatbot": {
      const chatbot = await prisma.chatbot.findFirst({
        where: {
          id: parseInt(actionData.chatbotId, 10),
        },
      });
      if (chatbot) {
        await handleChatbotTrigger("chatbot:" + chatbot.name, recipient, phoneNumberId);
      }
      break;
    }
    case "updateAttribute": {
      const material = await prisma.replyMaterial.findFirst({
        where: {
          id: parseInt(actionData.attributeId, 10)
        }
      });

      if (!material?.content) break;

      let parsedAttributes: { attribute: string; value: string }[] = [];

      try {
        parsedAttributes = JSON.parse(material.content);
      } catch (e) {
        console.error("Failed to parse attributes JSON:", e);
        break;
      }

      const normalizeBool = (val: string | null) =>
        val?.toLowerCase() === "true" ? true : false;

      const directFields: any = {};
      const flatAttributes: Record<string, string> = {};

      parsedAttributes.forEach(({attribute, value}) => {
        switch (attribute) {
          case "allowbrodcast":
            directFields.subscribed = normalizeBool(value);
            break;
          case "allowsms":
            directFields.sendSMS = normalizeBool(value);
            break;
          case "Source":
          case "Channel":
            directFields.source = value || "Unknown";
            break;
          default:
            flatAttributes[attribute] = value;
        }
      });

      const existingAttrs = (contact.attributes || {}) as Prisma.JsonObject;

      await prisma.contact.update({
        where: {id: contact.id},
        data: {
          ...directFields,
          attributes: {
            ...existingAttrs,
            ...flatAttributes,
          },
        },
      });

      console.log(`Contact ${contact.id} updated with attributes via rule (${nodeType})`);
      break;
    }
    default:
      console.log(`Rule "${rule.name}" has an unknown action type for node action ${nodeType}.`);
  }

  // Increment rule's executed count
  await prisma.rule.update({
    where: {id: rule.id},
    data: {executed: {increment: 1}},
  });
};

const evaluateRuleConditionsForNodeAction = async (
  conditions: any,
  recipient: string,
  message: any,
  phoneNumberId: string | undefined,
  nodeType: string
): Promise<boolean> => {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  const contact = await prisma.contact.findUnique({
    where: {phoneNumber: recipient},
  });

  if (!contact) return false;

  // 1️⃣ Keyword Filter - Skip for node actions since there's no text input
  if (conditions.keywordFilter) {
    return false; // Node actions don't have keyword input
  }

  // 2️⃣ Contact Filter
  if (conditions.contactFilter) {
    const {operator, value} = conditions.contactFilter;
    const contactPhoneNumber = contact.phoneNumber;
    const contactCreationTime = contact.createdAt;

    // Calculate time difference in seconds since contact creation
    const now = new Date();
    const timeDifferenceInSeconds = (now.getTime() - new Date(contactCreationTime).getTime()) / 1000;

    switch (operator) {
      case "exists":
        // Contact "exists" if it was created more than 30 seconds ago
        if (timeDifferenceInSeconds < 0.20) return false;
        break;
      case "not_exists":
        // Contact "not_exists" if it was created less than 30 seconds ago (new contact)
        if (timeDifferenceInSeconds >= 0.20) return false;
        break;
      case "equals":
        if (contactPhoneNumber !== value) return false;
        break;
      case "not_equals":
        if (contactPhoneNumber === value) return false;
        break;
      case "contains":
        if (!contactPhoneNumber.includes(value)) return false;
        break;
      case "not_contains":
        if (contactPhoneNumber.includes(value)) return false;
        break;
      default:
        return false;
    }
  }

  // 3️⃣ No Keyword Filter - Skip for node actions
  if (conditions.selectedFilter === "noKeyword") {
    return false; // Node actions don't have keyword input
  }

  // 4️⃣ Contact Attribute Filter
  if (conditions.contactAttributeFilter) {
    const {attribute, operator, value} = conditions.contactAttributeFilter;

    const directFields = ["allowbrodcast", "allowsms", "Source", "Channel"];
    let attrValue: any;

    if (directFields.includes(attribute)) {
      switch (attribute) {
        case "allowbrodcast":
          attrValue = contact.subscribed;
          break;
        case "allowsms":
          attrValue = contact.sendSMS;
          break;
        case "Source":
          attrValue = contact.source;
          break;
        case "Channel":
          attrValue = contact.source;
          break;
      }
    } else {
      const attributesObj = contact.attributes as Record<string, any>;
      attrValue = attributesObj?.[attribute];
    }

    if (attrValue === undefined || attrValue === null) return false;

    const attrStr = attrValue.toString().toLowerCase();
    const filterVal = value.toString().toLowerCase();

    switch (operator) {
      case "equals":
        if (attrStr !== filterVal) return false;
        break;
      case "not_equals":
        if (attrStr === filterVal) return false;
        break;
      case "contains":
        if (!attrStr.includes(filterVal)) return false;
        break;
      case "not_contains":
        if (attrStr.includes(filterVal)) return false;
        break;
      default:
        return false;
    }
  }

  // 5️⃣ Tags Filter
  if (conditions.tagsFilter) {
    const requiredTags = conditions.tagsFilter.tags?.map((t: string) => t.trim().toLowerCase());
    const contactTags = contact.tags.map((t: string) => t.toLowerCase());

    const tagMatches = requiredTags.every((tag: string) => contactTags.includes(tag));
    if (!tagMatches) return false;
  }

  // 6️⃣ Timestamp Filter - Skip for node actions
  if (conditions.timestampFilter) {
    return false; // Node actions don't have message timestamps
  }

  // 7️⃣ New Chat Filter - Skip for node actions
  if (conditions.selectedFilter === "newChat") {
    return false; // Node actions are not new chat triggers
  }

  // ✅ All conditions passed
  return true;
};
