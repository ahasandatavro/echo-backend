import { google } from "googleapis";
import { prisma } from '../models/prismaClient';
import { BroadcastStatus } from "@prisma/client";
import { resolveVariables } from "../helpers/validation";
import { Rule } from "@prisma/client";
import {
  processChatFlow,
  processNode,
  sendMessage,
  sendMessageWithButtons,
  sendTemplate,
} from "../processors/metaWebhook/webhookProcessor";
import { processWebhookMessage } from "../processors/inboxProcessor";
import { processKeyword, sendDefaultMaterial } from "../processors/metaWebhook/keywordProcessor";
import { validateUserResponse } from "../helpers/validation";

export const performGoogleSheetAction = async (
  payload: {
    action: string;
    spreadsheetId: any;
    sheetName: string;
    updateInAndBy?: any[];
    referenceColumn?: { name: string; value: string };
    variables:any[]
  },
  currentNode:any
): Promise<any> => {
  try {
    // Step 1: Find the chatbot and its owner
    const chatbot = await prisma.chatbot.findUnique({
      where: { id: currentNode.chatId },
      include: { owner: true }, // Include the owner relation
    });

    if (!chatbot) {
      throw new Error("Chatbot not found.");
    }

    const ownerId = chatbot.ownerId;
    if (!ownerId) {
      throw new Error("Chatbot owner does not have a valid access token.");
    }

    const sheetOwner =  await prisma.user.findUnique({
      where: { id: ownerId },
    });
    const ownerAccessToken = await ensureValidAccessToken(sheetOwner);

    // Step 2: Authenticate with Google Sheets API
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: ownerAccessToken });

    const sheets = google.sheets({ version: "v4", auth });

    const { action, spreadsheetId, sheetName, updateInAndBy, referenceColumn, variables } = payload;

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
                const resolvedValue = await resolveVariables(variable.value, currentNode.chatId);
                return resolvedValue || ""; // Ensure resolvedValue is a valid string
              } catch (error) {
                console.error("Error resolving variable:", error);
                return ""; // Default to empty string on error
              }
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

        case "update":
          if (!referenceColumn || !referenceColumn.name || !referenceColumn.value) {
            console.error("Invalid payload: Reference column data is missing.");
            return false;
          }
        
          // Read existing rows
          const readResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId.id,
            range: spreadsheetId.sheetName,
          });
        
          const rows = readResponse.data.values || [];
          headerRow = rows[0];
          let refColumnIndex = headerRow.indexOf(referenceColumn.name);
        
          if (refColumnIndex === -1) {
            console.error("Reference column not found in the sheet.");
            return false;
          }
        
          // Find the row to update
          const rowIndex = rows.findIndex(
            (row: any) => row[refColumnIndex] === referenceColumn.value
          );
        
          if (rowIndex === -1) {
            console.error("Row not found for the reference column value.");
            return false;
          }
        
          // Update the row with resolved variables
          for (const update of updateInAndBy || []) {
            const updateIndex = headerRow.indexOf(update.name);
            if (updateIndex !== -1) {
              if (update.value.startsWith("@")) {
                // Resolve variable if it starts with '@'
                try {
                  const resolvedValue = await resolveVariables(update.value, currentNode.chatId);
                  rows[rowIndex][updateIndex] = resolvedValue || ""; // Replace with resolved value or empty string
                } catch (error) {
                  console.error("Error resolving variable:", error);
                  rows[rowIndex][updateIndex] = ""; // Default to empty string on error
                }
              } else {
                // If no '@', use the value directly
                rows[rowIndex][updateIndex] = update.value;
              }
            }
          }
        
          // Write updated rows back to the spreadsheet
          await sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId.id,
            range: `${spreadsheetId.sheetName}!A1:Z${rows.length}`, // Adjust range as needed
            valueInputOption: "USER_ENTERED",
            requestBody: { values: rows },
          });
        
          console.log("Rows successfully updated.");
          return true;
        
      case "delete":
        if (!referenceColumn || !referenceColumn.name || !referenceColumn.value) {
          throw new Error("Invalid payload: Reference column data is missing.");
        }

        // Read existing rows
        const deleteResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId.id,
          range: spreadsheetId.sheetName,
        });

        const rowsToDelete = deleteResponse.data.values || [];
         refColumnIndex = rowsToDelete[0].indexOf(referenceColumn.name);

        if (refColumnIndex === -1) {
          throw new Error("Reference column not found in the sheet.");
        }

        // Find the row to delete
        const rowIndexToDelete = rowsToDelete.findIndex(
          (row:any) => row[refColumnIndex] === referenceColumn.value
        );

        if (rowIndexToDelete === -1) {
          throw new Error("Row not found for deletion.");
        }

        rowsToDelete.splice(rowIndexToDelete, 1); // Remove the row

        // Write the updated rows back to the spreadsheet
         await sheets.spreadsheets.values.update({
          spreadsheetId:spreadsheetId.id,
          range: `${spreadsheetId.sheetName}!A1:Z${rowsToDelete.length}`, // Adjust range as needed
          valueInputOption: "USER_ENTERED",
          requestBody: { values: rowsToDelete },
        });
        console.log("Rows successfully deleted.");
        return true;

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
    auth.setCredentials({ refresh_token: refreshToken });

    const { token } = await auth.getAccessToken();

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
  if (user.access_token==undefined || isTokenExpired(user.accessTokenExpiresAt)) {
    console.log("Access token expired. Refreshing...");
    const newAccessToken = await refreshAccessToken(user.refreshToken);

    const expiresIn = 3600; // Token lifespan (1 hour)
    const expirationTimestamp = Math.floor(Date.now() / 1000) + expiresIn;

    // Update the database with the new token and expiration time
    await prisma.user.update({
      where: { id: user.id },
      data: { accessToken: newAccessToken, accessTokenExpiresAt: expirationTimestamp },
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

export const handleChatbotTrigger=async(text:string, recipient:string, phoneNumberId: string | undefined)=>{
  const chatbotName = text.split(":")[1].trim();

  const chatbot = await prisma.chatbot.findFirst({
    where: { name: chatbotName },
  });

  let conversation = await prisma.conversation.findFirst({
    where: { recipient },
    orderBy: {
      updatedAt: 'desc', // Orders by the most recently updated conversation
    },
  });
    if (!conversation) {
        
            conversation = await prisma.conversation.create({
              data: {
                recipient,
                chatbotId:chatbot?.id,
                answeringQuestion: true,
              },
            });
  
            console.log("New conversation created:", conversation);
          }
          
  if (chatbot) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { answeringQuestion: false },
    });
    await processChatFlow(chatbot.id, recipient, phoneNumberId);
  }
}

export async function processBroadcastStatus(statuses: any[]): Promise<void> {
  for (const statusObj of statuses) {
    const phoneNumber = statusObj.recipient_id; // e.g. "1234567890"
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
      await prisma.broadcastRecipient.updateMany({
        where: {
          broadcastId,
          contact: { phoneNumber }, // Using nested condition on the related Contact
        },
        data: {
          status: updatedStatus,
        },
      });
    }
  }
}

export const isValidWebhookRequest = (entry: any): boolean => {
  return entry && Array.isArray(entry);
};

export const processWebhookChange = async (change: any, io: any) => {
  const statuses = change.value?.statuses;
  if (statuses) await processBroadcastStatus(statuses);

  if (change.field === "message_template_status_update") {
    await updateTemplateInDb(change.value);
    return;
  }

  await processMessageUpdate(change.value, io);
};

export const processMessageUpdate = async (value: any, io: any) => {
  const agentPhoneNumber = value?.metadata?.display_phone_number;
  const phoneNumberId = value?.metadata?.phone_number_id;
  const message = value?.messages?.[0];
  const sender = message?.from;
  if (!sender) {
    //console.warn("Sender is undefined. Cannot query contact.");
    return;
  }
  const contact = await prisma.contact.findUnique({
    where: { phoneNumber: sender },
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
  finalContact = await prisma.contact.create({
    data: {
      phoneNumber: sender,
      source: "WhatsApp", // or you can dynamically set this
      subscribed: true,
    },
    include: {
      user: true,
      assignedTeams: {
        include: { users: true },
      },
    },
  });
}
if (!finalContact) return;

let notifyEmails: Set<string> = new Set();

if (finalContact.user?.email) {
  notifyEmails.add(finalContact.user.email);
}

for (const team of finalContact.assignedTeams) {
  for (const agent of team.users) {
    notifyEmails.add(agent.email);
  }
}
const finalRecipients = await prisma.user.findMany({
  where: {
    email: { in: Array.from(notifyEmails) },
    notificationSettings: {
      some: {
        OR: [
          { messageAssignedSound: true },
          { messageAssignedDesktop: true },
        ],
      },
    },
  },
  select: { email: true },
});

// 🔔 Step 4: Emit only to those eligible
const messageAssignedEmails = finalRecipients.map((u) => u.email);

if (messageAssignedEmails.length > 0) {
  io.emit("messageAssigned", {
    recipients: messageAssignedEmails,
    contactName: finalContact.name || finalContact.phoneNumber,
    contactId: finalContact.id,
    from: sender,
  });
}
  if (!sender) return;

  if (!isAllowedSender(sender)) {
    return;
  }

//create media url for media messages,otherwise directly save in db with creating conversation
  const processedMessage = await processWebhookMessage(
    sender,
    message,
    agentPhoneNumber,
    phoneNumberId
  );
  const agent = await prisma.user.findFirst({
    where: { selectedPhoneNumberId: phoneNumberId },
  });

  if (!agent) {
    console.warn("No agent found for phone number ID:", phoneNumberId);
    return;
  }
//rules checking first
// Fetch Active Rules for this agent/user
const activeRules = await prisma.rule.findMany({
  where: {
    userId: 1,
    status: "Active",
    triggerType: "whatsappMessage",
  },
});

if (activeRules.length > 0) {
  for (const rule of activeRules) {
    await processRuleForMessage(rule, sender, message, phoneNumberId);
  }
}

  //notification to the creator of the agent
  const creatorId = agent.createdById ?? agent.id;

  // 📢 Find all users created by the same creator (including the agent himself)
  const notifyUsers = await prisma.user.findMany({
    where: {
      OR: [
        { id: creatorId },
        { createdById: creatorId },
      ],
    },
    select: { email: true },
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
  phoneNumberId: string | undefined
) => {
  const actionType = rule.action;
  const actionData = rule.actionData as any;
  const conditions = rule.conditions as any;

  // Step 1: Evaluate Conditions FIRST
  const conditionsMet = await evaluateRuleConditions(conditions, sender, message);

  if (!conditionsMet) {
    console.log(`Rule "${rule.name}" skipped: Conditions not met`);
    return;
  }

  // Step 2: Perform the action (same as before)
  switch (actionType) {
    case "sendTemplate":
      await sendTemplate(sender, actionData.templateId, 0, {});
      break;
    case "sendMessage": {
      const { messageType, replyId } = actionData;
    
      if (messageType && replyId) {
        const materialType = messageType; // 'VIDEO', 'TEXT', etc.
        const materialId = parseInt(replyId, 10);
    
        const sent = await sendDefaultMaterial(materialType, materialId, sender,0,phoneNumberId);
        if (sent) {
          console.log(`sendMessage action executed successfully for rule ${rule.name}`);
        } else {
          console.warn(`Failed to send message for rule ${rule.name}`);
        }
      }
      break;
    }
    case "routeChat":
      // same logic...
      break;
    case "startChatbot":
      const chatbot = await prisma.chatbot.findFirst({
        where: {
          id: parseInt(actionData.chatbotId, 10),
        },
      });
      if (chatbot) {
        await handleChatbotTrigger("chatbot:"+chatbot.name,sender, phoneNumberId);
      }
      break;
    case "updateAttribute":
      // same logic...
      break;
    default:
      console.log(`Rule "${rule.name}" has an unknown action type.`);
  }

  // Increment rule's executed count
  await prisma.rule.update({
    where: { id: rule.id },
    data: { executed: { increment: 1 } },
  });
};

const evaluateRuleConditions = async (
  conditions: any,
  sender: string,
  message: any
): Promise<boolean> => {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  const contact = await prisma.contact.findUnique({
    where: { phoneNumber: sender },
  });

  if (!contact) return false;

  // 1️⃣ Keyword Filter
  if (conditions.keywordFilter) {
    const text = message?.text?.body || "";
    const keywords = conditions.keywordFilter.keywords?.split(",").map((k: string) => k.trim().toLowerCase());

    const matches = keywords?.some((k: string) => text.toLowerCase().includes(k));
    if (!matches) return false;
  }
  if (conditions.contactFilter) {
    const { operator, value } = conditions.contactFilter;
    const contactPhoneNumber = contact.phoneNumber;
  
    switch (operator) {
      case "exists":
        if (!contactPhoneNumber) return false;
        break;
  
      case "not_exists":
        if (contactPhoneNumber) return false;
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
  
  // 2️⃣ Contact Attribute Filter (Json attributes field)
  if (conditions.contactAttributeFilter) {
    const { attribute, operator, value } = conditions.contactAttributeFilter;
    
    const attributesObj = contact.attributes as Record<string, any>; // Fix typing
    const attrValue = attributesObj?.[attribute];
  
    if (attrValue === undefined) return false;
  
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

    const receivedAt = new Date(message.timestamp * 1000); // assuming UNIX timestamp in seconds
    const now = new Date();
    const diffMs = now.getTime() - receivedAt.getTime();
    const diffMinutes = diffMs / (1000 * 60);
    const diffHours = diffMinutes / 60;

    const compareValue = unit === "hours" ? diffHours : diffMinutes;

    switch (operator) {
      case "less_than":
        if (!(compareValue < value)) return false;
        break;
      case "greater_than":
        if (!(compareValue > value)) return false;
        break;
      default:
        return false;
    }
  }

  // 5️⃣ New Chat Filter
  if (conditions.newChatFilter) {
    const recentConversation = await prisma.conversation.findFirst({
      where: { recipient: sender },
      orderBy: { createdAt: "desc" },
    });

    const isNewChat = !recentConversation;
    if (conditions.newChatFilter.newChatValue === "true" && !isNewChat) return false;
    if (conditions.newChatFilter.newChatValue === "false" && isNewChat) return false;
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
  const conversation = await findOrCreateConversation(recipient, message);
  if (!conversation) return;

  const chatbotData = await getChatbotData(conversation.chatbotId);
  if (!chatbotData) return;

  if (message?.interactive) {
    await handleInteractiveMessage(message, chatbotData, recipient);
    return;
  }

  if (conversation.answeringQuestion) {
    await handleQuestionResponse(conversation, message, chatbotData, recipient,agentPhoneNumber);
    return;
  }

  const text = message?.text?.body?.toLowerCase();
  if (text) {
    await processKeyword(text, recipient, agentPhoneNumber);
  }
};

export const findOrCreateConversation = async (
  recipient: string,
  message: any
): Promise<any> => {
  // 1️⃣ Always start by fetching the latest convo (if any)
  let conversation = await prisma.conversation.findFirst({
    where: { recipient },
    orderBy: { updatedAt: "desc" },
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
  if(conversation && conversation.answeringQuestion){
    chatbotId = conversation.chatbotId;
  }
else chatbotId = text ? await findChatbotIdByKeyword(text) : null;

  if (!chatbotId &&  conversation && !conversation.answeringQuestion) {
    console.warn("No keyword match found. Unable to associate a chatbot.");
    await sendMessage(
      recipient,
      "Sorry, no chatbot is available for your query."
    );
    return null;
  }

  // 4️⃣ If a convo exists, update its chatbotId if it changed
  if (conversation) {
    if (conversation.chatbotId !== chatbotId) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { chatbotId, answeringQuestion: false },
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


export const getChatbotData = async (chatbotId: number): Promise<any> => {
  const chatbotData = await prisma.chatbot.findUnique({
    where: { id: chatbotId||1 },
    include: { nodes: true, edges: true },
  });

  if (!chatbotData) {
    console.warn(`Chatbot with ID ${chatbotId} not found.`);
    return null;
  }

  return chatbotData;
};

export const handleInteractiveMessage = async (
  message: any,
  chatbotData: any,
  recipient: string
) => {
  if (message?.interactive?.button_reply) {
    await handleButtonReply(message.interactive.button_reply, chatbotData, recipient);
  } else if (message?.interactive?.list_reply) {
    await handleListReply(message.interactive.list_reply, chatbotData, recipient);
  }
};

export const handleButtonReply = async (
  buttonReply: any,
  chatbotData: any,
  recipient: string
) => {
  const parts = buttonReply.id.split("_node_");
  const buttonId = "source_" + parts[0];
  const nodeId = parseInt(parts[1]);

  const selectedEdge = chatbotData.edges.find(
    (edge:any) => edge.sourceHandle === buttonId && edge.sourceId === nodeId
  );

  const nextNodeId = selectedEdge
    ? chatbotData.nodes.find((node:any) => node.id === selectedEdge.targetId)?.nodeId
    : null;

  const currentNode = chatbotData.nodes.find((node:any) => node.id === nodeId);

  if (currentNode?.data?.buttons_data?.saveAnswerVariable) {
    await saveButtonReplyVariable(
      currentNode,
      buttonReply.title,
      recipient
    );
  }

  if (nextNodeId) {
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient);
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
    where: { recipient, chatbotId: currentNode.chatId },
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
  recipient: string
) => {
  const listReplyId = listReply.id;
  const nodeId = parseInt(listReplyId.split("_node_")[1]);
  const buttonId = listReplyId.split("_node_")[0];
  const currentNode = chatbotData.nodes.find((node:any) => node.id === nodeId);

  if (currentNode?.data?.list_data?.saveAnswerVariable) {
    await saveListReplyVariable(
      currentNode,
      listReply.title,
      recipient
    );
  }

  const selectedEdge = chatbotData.edges.find(
    (edge:any) => edge.sourceId === currentNode?.id && edge.sourceHandle === buttonId
  );

  const nextNodeId = selectedEdge
    ? chatbotData.nodes.find((node:any) => node.id === selectedEdge.targetId)?.nodeId
    : null;

  if (nextNodeId) {
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient);
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
    where: { recipient, chatbotId: currentNode.chatId },
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
      where: { id: existingVariable.id },
      data: { value, nodeId },
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
    where: { id: conversation.currentNodeId },
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
      recipient
    );
  } else {
    await handleInvalidQuestionResponse(
      conversation,
      failureCount,
      validationFailureExitCount,
      validation,
      agentPhoneNumberId
    );
  }}
};

export const handleValidQuestionResponse = async (
  conversation: any,
  currentNode: any,
  text: string,
  saveAnswerVariable: string,
  chatbotData: any,
  recipient: string
) => {
  await prisma.conversation.update({
    where: { id: conversation.id },
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
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient);
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
      where: { id: conversation.id },
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
      where: { id: conversation.id },
      data: { validationFailureCount: failureCount },
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

export const updateTemplateInDb = async (data: any) => {
  const {
    event,
    message_template_id,
    message_template_name,
    message_template_language,
    reason,
  } = data;

  await prisma.template.update({
    where: { name: message_template_name },
    data: {
      status: event,
      language: message_template_language,
      updatedAt: new Date(),
    },
  });
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
  const keyword = await prisma.keyword.findFirst({
    where: {
      value: {
        contains: text,
        mode: "insensitive",
      },
    },
    include: { chatbot: true },
  });

  return keyword?.chatbot?.id || null;
};