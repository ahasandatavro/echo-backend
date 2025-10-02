import {prisma} from "../../models/prismaClient";
import axios from "axios";
import {metaWhatsAppAPI} from "../../config/metaConfig";
import {bump, convertHtmlToWhatsAppText} from "../../helpers/index";
import {resolveContactAttributes, resolveVariables} from "../../helpers/validation";
import {ListMessage} from "../../interphases";
import {performGoogleSheetAction, checkRulesForNodeAction} from "../../subProcessors/metaWebhook";
import {MessageStatus} from "../../interphases"; // ✅ Import the correct enum
import {Prisma} from "../../models/prismaClient"; // ✅ Import Prisma types
import {io} from "../../app";
import {validateUserResponse} from "../../helpers/validation";
import {processWebhookMessage} from "../inboxProcessor";
import {processBroadcastStatus} from "../../subProcessors/metaWebhook";
import fs from 'fs';
import path from 'path';
import {uploadMediaToDigitalOcean} from "../inboxProcessor";
import {findMatchingKeyword} from "../../utils/keywordMatcher";
import {scheduleChatbotTimers} from "../../utils/chatbotTimerUtils";
import {
  getContactIdByPhoneNumber,
  closePreviousNodeVisit,
  createNodeVisit
} from '../../utils/nodeVisitUtils';

export const processChatFlow = async (chatbotId: number, recipient: string, agentPhoneNumberId: string | undefined) => {
  try {
    const chatbotData = await prisma.chatbot.findUnique({
      where: {id: chatbotId},
      include: {nodes: true, edges: true},
    });

    if (chatbotData) {
      const startNode = chatbotData.nodes.find((node) => node.type === "start");
      if (!startNode) {
        await sendMessage(recipient, "Chatbot start node not configured.", chatbotData?.id, 1);
        return;
      }
      // Fetch all conversations for the recipient
      const recipientConversations = await prisma.conversation.findMany({
        where: {recipient},
      });

      // Check for a matching conversation with the same chatbotId
      const matchingConversation = recipientConversations.find(
        (conversation) => conversation.chatbotId === chatbotId
      );

      if (!matchingConversation) {
        // Create a new conversation if no match found
        console.log(`No matching conversation for recipient ${recipient} and chatbotId ${chatbotId}. Creating a new one.`);
        await prisma.conversation.create({
          data: {
            recipient,
            chatbotId,
            currentNodeId: startNode.id,
            lastNodeId: null,
          },
        });
      } else {
        // Update the existing conversation
        console.log(`Matching conversation found for recipient ${recipient} and chatbotId ${chatbotId}. Updating it.`);
        await prisma.conversation.update({
          where: {id: matchingConversation.id},
          data: {
            currentNodeId: startNode.id,
            lastNodeId: null, // Reset lastNodeId
          },
        });
      }

      // Start processing the chatbot flow
      await processNode(
        startNode.nodeId,
        chatbotData.nodes,
        chatbotData.edges,
        recipient,
        agentPhoneNumberId
      );
    }


  } catch (error) {
    console.error("Error processing chatbot flow:", error);
  }
};

export const processNode = async (
  nodeId: string,
  nodes: any[],
  edges: any[],
  recipient: string,
  agentPhoneNumberId?: string
) => {
  try {
    const currentNode = nodes.find((node) => node.nodeId === nodeId);

    if (!currentNode) {
      console.error(`Node with ID ${nodeId} not found.`);
      return;
    }
    // Fetch conversation once at the root
    const conversation = await prisma.conversation.findFirst({
      where: {
        recipient: recipient,
        chatbotId: currentNode.chatId,
      },
      include: {businessPhoneNumber: true},
    });
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    // Node visit tracking
    const conversationId = conversation.id;
    let contactId = conversation.contactId;
    if (!contactId) {
      contactId = await getContactIdByPhoneNumber(conversation.recipient);
    }
    await closePreviousNodeVisit(conversationId, contactId);
    await createNodeVisit(conversationId, currentNode.id, contactId);
    await bump(currentNode.chatId, "stepsFinished");
    await prisma.conversation.update({
      where: {id: conversationId},
      data: {lastNodeId: currentNode.id},
    });
    if (currentNode.type === "start") {
      const outgoingEdge = edges.find(
        (edge) => edge.sourceId === currentNode.id
      );
      if (outgoingEdge) {
        const nextNodeId = nodes.find(
          (node) => node.id === outgoingEdge.targetId
        )?.nodeId;
        if (nextNodeId) {
          await processNode(nextNodeId, nodes, edges, recipient, agentPhoneNumberId);
        }
      }
      if (!outgoingEdge) {
        await bump(currentNode.chatId, "finished");
        await closePreviousNodeVisit(conversationId, contactId);
        return;
      }
      return;
    }

    if (currentNode.type === "message") {
      const messageData = currentNode.data?.message_data?.messages;

      if (messageData && messageData.length > 0) {
        for (const message of messageData) {
          await sendMessage(recipient, message, currentNode?.chatId, 1, false, agentPhoneNumberId);
          // Reset timer after sending a message
          await scheduleChatbotTimers(conversation);

        }
      }

      const outgoingEdge = edges.find(
        (edge) => edge.sourceId === currentNode.id
      );
      if (outgoingEdge) {
        const nextNodeId = nodes.find(
          (node) => node.id === outgoingEdge.targetId
        )?.nodeId;
        if (nextNodeId) {
          const conversation = await prisma.conversation.findFirst({
            where: {
              recipient: recipient,
              chatbotId: currentNode.chatbotId,
            },
          });
          if (!conversation) {
            throw new Error("Conversation not found");
          }
          await prisma.conversation.update({
            where: {id: conversation.id},
            data: {
              lastNodeId: currentNode.id,
              currentNodeId: currentNode.id + 1,
            },
          });
          await processNode(nextNodeId, nodes, edges, recipient, agentPhoneNumberId);
        }
      }
      if (!outgoingEdge) {
        await bump(currentNode.chatId, "finished");
        await closePreviousNodeVisit(conversationId, contactId);
        return;
      }
    }

    if (currentNode.type === "template") {
      try {
        // Extract template data from the node
        const templateData = currentNode.data?.template_data;
        if (!templateData || !templateData.selectedTemplate) {
          throw new Error("No selectedTemplate provided in template_data.");
        }
        const selectedTemplate: string = templateData.selectedTemplate;
        if (selectedTemplate) {
          const dbTemplate = await prisma.template.findFirst({
            where: {name: selectedTemplate},
          });


          let templateId = dbTemplate?.id || 1;
          // Call the sendTemplate function
          await sendTemplate(recipient, selectedTemplate, currentNode.chatbotId, dbTemplate, agentPhoneNumberId);

          // Find and process the outgoing edge on success (handle "source_1")
          const nextEdge = edges.find(
            (edge) => edge.sourceId === currentNode.id
          );
          if (nextEdge) {
            const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
            if (nextNode) {
              console.log(`Transitioning to next node: ${nextNode.id}`);
              await processNode(nextNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
            }
          }
          if (!nextEdge) {
            await bump(currentNode.chatId, "finished");
            await closePreviousNodeVisit(conversationId, contactId);
            return;
          }
        }
      } catch (error) {
        console.error("Error in template node:", error);

        // On error, route to the error branch (handle "source_2")
        const errorEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
        );
        if (errorEdge) {
          const errorNode = nodes.find((node) => node.id === errorEdge.targetId);
          if (errorNode) {
            console.log(`Transitioning to error node: ${errorNode.id}`);
            await processNode(errorNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
      }
      return; // Stop further processing for this node.
    }

    if (currentNode.type === 'buttons') {
      const buttonData = currentNode.data?.buttons_data;
      if (!buttonData) return;

      let headerPayload: any;
      let headerAttachmentUrl: string | null = null;

      if (buttonData.mediaHeader && buttonData.headerMedia) {
        // 1) Decode base64 and write to your uploads folder
        const uploadsDir = path.join(__dirname, "../../uploads");
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, {recursive: true});
        }

        const [meta, base64] = buttonData.headerMedia.url.split(",");
        const mime = meta.match(/^data:(.+);base64$/)?.[1] ?? "application/octet-stream";
        const ext = mime.split("/")[1] ?? "bin";
        const tmpPath = path.join(uploadsDir, `${currentNode.id}.${ext}`);

        fs.writeFileSync(tmpPath, Buffer.from(base64, "base64"));

        // 2) Upload to DigitalOcean (or wherever) and grab a public URL
        try {
          headerAttachmentUrl = await uploadMediaToDigitalOcean(tmpPath);
        } catch (err) {
          console.error("DO upload failed:", err);
        } finally {
          fs.unlinkSync(tmpPath);
        }

        if (mime.startsWith("image/")) {
          headerPayload = {type: "image", image: {link: headerAttachmentUrl!}};
        } else if (mime.startsWith("video/")) {
          headerPayload = {type: "video", video: {link: headerAttachmentUrl!}};
        } else {
          // any other extension → document
          headerPayload = {
            type: "document",
            document: {
              link: headerAttachmentUrl!,
              filename: buttonData.headerMedia.name,
            },
          };
        }
      } else {
        // fallback to plain-text header
        const txt = convertHtmlToWhatsAppText(buttonData.headerText ?? "");
        headerPayload = txt ? {type: "text", text: txt} : undefined;
      }


      // Build buttons
      const buttons = (buttonData.buttons || []).map((btn: any, i: number) => ({
        type: 'reply',
        reply: {id: `${i}_node_${currentNode.id}`, title: btn.button},
      }));

      // Assemble the interactive payload
      const interactive = {
        type: 'button',
        header: headerPayload,
        body: {text: convertHtmlToWhatsAppText(buttonData.bodyText)},
        footer: buttonData.footerText ? {text: buttonData.footerText} : undefined,
        action: {buttons},
      };

      try {
        // Send to WhatsApp
        await sendMessageWithButtons(recipient, {
          ...interactive,
          chatId: currentNode.chatbotId,
        }, agentPhoneNumberId);

        // Persist the sent message, including any DO‐hosted header media
        await storeMessage({
          recipient,
          chatbotId: currentNode.chatbotId!,
          messageType: 'button',
          text: convertHtmlToWhatsAppText(buttonData.bodyText),
          buttonOptions: buttons.map((b: any) => ({id: b.reply.id, title: b.reply.title})),
          //attachment: headerAttachmentUrl,
        }, agentPhoneNumberId);
        // Reset timer after sending buttons
        await scheduleChatbotTimers(conversation);
      } catch (err) {
        console.error('Error sending button message:', err);
      }
    }
    if (currentNode.type === "list") {
      const listData = currentNode.data?.list_data;
      if (listData) {
        // Resolve variables in header text
        let resolvedHeaderText = listData?.headerText;
        if (resolvedHeaderText && resolvedHeaderText.includes("@")) {
          resolvedHeaderText = await resolveVariables(resolvedHeaderText, currentNode?.chatId || currentNode?.chatbotId, recipient, agentPhoneNumberId);
        }
        if (resolvedHeaderText && resolvedHeaderText.includes("{{")) {
          resolvedHeaderText = await resolveContactAttributes(resolvedHeaderText, recipient);
        }

        // Resolve variables in body text
        let resolvedBodyText = listData.bodyText;
        if (resolvedBodyText && resolvedBodyText.includes("@")) {
          resolvedBodyText = await resolveVariables(resolvedBodyText, currentNode?.chatId || currentNode?.chatbotId, recipient, agentPhoneNumberId);
        }
        if (resolvedBodyText && resolvedBodyText.includes("{{")) {
          resolvedBodyText = await resolveContactAttributes(resolvedBodyText, recipient);
        }

        const listMessage: ListMessage = {
          text: convertHtmlToWhatsAppText(resolvedBodyText) || "Please select an option:",
          header: resolvedHeaderText,
          footer: listData?.footerText,
          buttonText: listData?.buttonText || "Options",
          sections: listData?.sections || [],
          saveAnswerVariable: listData?.saveAnswerVariable,
        };

        try {
          // Send list message
          await sendMessageWithList(recipient, listMessage, currentNode.id, agentPhoneNumberId, currentNode?.chatId || currentNode?.chatbotId);
          // Reset timer after sending list
          await scheduleChatbotTimers(conversation);

          // Update the Variable table after successful message sending
          if (listData?.saveAnswerVariable) {
            const variableName = listData.saveAnswerVariable.startsWith("@")
              ? listData.saveAnswerVariable.slice(1)
              : listData.saveAnswerVariable;

            // Find the conversation using recipient and chatId
            const conversation = await prisma.conversation.findFirst({
              where: {
                recipient: recipient,
                chatbotId: currentNode?.chatId || currentNode?.chatbotId,
              },
            });

            if (conversation) {
              // Check if the variable already exists
              const existingVariable = await prisma.variable.findFirst({
                where: {
                  name: variableName,
                  chatbotId: currentNode.chatbotId,
                  conversationId: conversation?.id,
                },
              });

              if (existingVariable) {
                // Update the existing variable
                await prisma.variable.update({
                  where: {id: existingVariable?.id},
                  data: {updatedAt: new Date()}, // Update timestamp
                });
              } else {
                // Create a new variable
                await prisma.variable.create({
                  data: {
                    name: variableName,
                    chatbotId: currentNode.chatbotId,
                    conversationId: conversation?.id,
                  },
                });
              }

              console.log(
                `Variable "${variableName}" saved for conversation ID ${conversation?.id} and chatbot ID ${currentNode.chatbotId}.`
              );
            } else {
              console.warn(
                `No conversation found for recipient ${recipient} and chatbot ID ${currentNode.chatbotId}.`
              );
            }
          }
        } catch (error) {
          console.error(
            "Error sending list message or updating variable table:",
            error
          );
        }
      }
    }

    if (currentNode.type === "googleSheet") {
      const gsheetData = currentNode.data?.gsheet_data;

      if (gsheetData) {
        try {
          const {action, selectedSpreadsheet, updateInAndBy, referenceColumn, variables} = gsheetData;

          // Prepare the payload for the Google Sheets API
          const payload: any = {
            action,
            spreadsheetId: selectedSpreadsheet,
            updateInAndBy,
            referenceColumn,
            variables,
          };

          // Simulate or perform Google Sheet operation
          const googleSheetResult: boolean = await performGoogleSheetAction(payload, currentNode, recipient, agentPhoneNumberId); // Define this function
          let nextEdge: any;
          if (googleSheetResult == true) {
            nextEdge = edges.find(
              (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_1"
            );

          } else {
            nextEdge = edges.find(
              (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
            );

          }

          if (nextEdge) {
            const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
            if (nextNode) {
              console.log(`Transitioning to next node (source1): ${nextNode.id}`);
              await processNode(nextNode.nodeId, nodes, edges, recipient, agentPhoneNumberId); // Call the same function for the next node
            }
          }
          if (!nextEdge) {
            await bump(currentNode.chatId, "finished");
            await closePreviousNodeVisit(conversationId, contactId);
            return;
          }
        } catch (error) {
          console.error("Google Sheet action failed:", error);

          // On error, find the `source2` edge and transition to its target node
          const errorEdge = edges.find(
            (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
          );

          if (errorEdge) {
            const errorNode = nodes.find((node) => node.id === errorEdge.targetId);
            if (errorNode) {
              console.log(`Transitioning to error node (source2): ${errorNode.id}`);
              await processNode(errorNode.nodeId, nodes, edges, recipient, agentPhoneNumberId); // Call the same function for the next node
            }
          }
        }
      }
      return; // Stop further execution for this node
    }

    if (currentNode.type === "condition") {
      const conditionData = currentNode.data?.condition_data;

      if (conditionData) {
        try {
          const {conditions, logicOperator} = conditionData;

          // Function to evaluate a single condition
          const evaluateCondition = async (condition: any) => {
            let {variable, operator, value} = condition;

            // Resolve variables if they start with "@", otherwise keep them as is
            if (variable.startsWith("@")) {
              variable = await resolveVariables(variable, currentNode?.chatId, recipient, agentPhoneNumberId);
            }
            if (variable.includes("{{")) {
              variable = await resolveContactAttributes(variable, recipient);
            }

            // Fetch the actual value of the variable (if it's an object lookup, resolve it)
            let actualValue = variable;

            switch (operator) {
              case "Equal to":
                return actualValue == value;
              case "Not equal to":
                return actualValue != value;
              case "Greater than":
                return Number(actualValue) > Number(value);
              case "Less than":
                return Number(actualValue) < Number(value);
              case "Contains":
                return typeof actualValue === "string" && actualValue.includes(value);
              case "Does not contain":
                return typeof actualValue === "string" && !actualValue.includes(value);
              case "Starts with":
                return typeof actualValue === "string" && actualValue.startsWith(value);
              case "Does not start with":
                return typeof actualValue === "string" && !actualValue.startsWith(value);
              default:
                return false;
            }
          };

          // Evaluate all conditions asynchronously
          const conditionResults = await Promise.all(conditions.map(evaluateCondition));

          // Combine results based on AND/OR logic
          const isConditionMet =
            logicOperator === "AND"
              ? conditionResults.every((result) => result === true)
              : conditionResults.some((result) => result === true);

          // Determine the next node based on the condition result
          let nextEdge: any;
          if (isConditionMet) {
            nextEdge = edges.find(
              (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_1"
            );
          } else {
            nextEdge = edges.find(
              (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
            );
          }

          // Move to the next node if found
          if (nextEdge) {
            const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
            if (nextNode) {
              console.log(`Transitioning to next node: ${nextNode.id}`);
              await processNode(nextNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
            }
          }
          if (!nextEdge) {
            await bump(currentNode.chatId, "finished");
            await closePreviousNodeVisit(conversationId, contactId);
            return;
          }
        } catch (error) {
          console.error("Condition evaluation failed:", error);
        }
      }
      return; // Stop further execution for this node
    }

    if (currentNode.type === "subscribe") {
      try {
        // Attempt to update the contact with the given recipient
        // Adjust the `where` clause based on how you identify your contact (e.g., phoneNumber, email, etc.)
        const updatedContact = await prisma.contact.upsert({
          where: {phoneNumber: recipient}, // Search by phoneNumber
          update: {subscribed: true, sendSMS: true}, // Update if found
          create: {
            phoneNumber: recipient,
            subscribed: true,
            source: "WhatsApp", // Default value if new contact
          },
        });


        // Check rules after successful subscription
        await checkRulesForNodeAction(recipient, "attributeChanged", agentPhoneNumberId, undefined);

        // Find the next edge using the "source_1" handle on success
        const nextEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id
        );

        if (nextEdge) {
          const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node (source1): ${nextNode.id}`);
            // Continue processing with the next node
            await processNode(nextNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
        if (!nextEdge) {
          await bump(currentNode.chatId, "finished");
          await closePreviousNodeVisit(conversationId, contactId);
          return;
        }
      } catch (error) {
        console.error("Subscribe action failed:", error);

        // On error, route to the error branch using the "source_2" handle
        const errorEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
        );

        if (errorEdge) {
          const errorNode = nodes.find((node) => node.id === errorEdge.targetId);
          if (errorNode) {
            console.log(`Transitioning to error node (source2): ${errorNode.id}`);
            await processNode(errorNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
      }

      return; // Prevent further execution for this node.
    }

    if (currentNode.type === "unsubscribe") {
      try {
        // Attempt to update the contact with the given recipient
        // Adjust the `where` clause based on how you identify your contact (e.g., phoneNumber, email, etc.)
        const updatedContact = await prisma.contact.upsert({
          where: {phoneNumber: recipient}, // Search by phoneNumber
          update: {subscribed: false, sendSMS: false}, // Update if found
          create: {
            phoneNumber: recipient,
            subscribed: true,
            source: "WhatsApp", // Default value if new contact
          },
        });

        console.log(`Contact ${recipient} subscription set to false.`);

        // Check rules after successful unsubscription
        await checkRulesForNodeAction(recipient, "attributeChanged", agentPhoneNumberId, undefined);

        // Find the next edge using the "source_1" handle on success
        const nextEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id
        );

        if (nextEdge) {
          const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node (source1): ${nextNode.id}`);
            // Continue processing with the next node
            await processNode(nextNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
        if (!nextEdge) {
          await bump(currentNode.chatId, "finished");
          await closePreviousNodeVisit(conversationId, contactId);
          return;
        }
      } catch (error) {
        console.error("Subscribe action failed:", error);

        // On error, route to the error branch using the "source_2" handle
        const errorEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
        );

        if (errorEdge) {
          const errorNode = nodes.find((node) => node.id === errorEdge.targetId);
          if (errorNode) {
            console.log(`Transitioning to error node (source2): ${errorNode.id}`);
            await processNode(errorNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
      }

      return; // Prevent further execution for this node.
    }

    if (currentNode.type === "triggerChatbot") {
      try {
        // 1️⃣ Extract and validate chatbot_data
        const chatbotData = currentNode.data?.chatbot_data;
        if (!chatbotData?.selectedChatbot) {
          throw new Error("No chatbot data provided.");
        }
        const selectedChatbotName = chatbotData.selectedChatbot;

        // 2️⃣ Load the chatbot & keyword
        const chatbot = await prisma.chatbot.findFirst({
          where: {name: selectedChatbotName},
        });
        if (!chatbot) {
          throw new Error(`Chatbot "${selectedChatbotName}" not found.`);
        }

        await processChatFlow(chatbot?.id || 1, recipient, agentPhoneNumberId);

        // 4️⃣ Follow the "success" edge
        const nextEdge = edges.find(e => e.sourceId === currentNode.id);
        if (nextEdge) {
          const nextNode = nodes.find(n => n.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`→ moving to node ${nextNode.id}`);
            await processNode(nextNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
        if (!nextEdge) {
          await bump(currentNode.chatId, "finished");
          await closePreviousNodeVisit(conversationId, contactId);
          return;
        }
      } catch (error) {
        console.error("Error in triggerChatbot node:", error);

        // 5️⃣ On failure, follow the "source_2" error edge
        const errorEdge = edges.find(
          e => e.sourceId === currentNode.id && e.sourceHandle === "source_2"
        );
        if (errorEdge) {
          const errorNode = nodes.find(n => n.id === errorEdge.targetId);
          if (errorNode) {
            console.log(`→ moving to error node ${errorNode.id}`);
            await processNode(errorNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
      }

      return; // stop further processing of this node
    }

    if (currentNode.type === "setTags") {
      try {
        // Extract the selected tags from the node's data.
        const tagsData = currentNode.data?.tags_data;
        if (!tagsData || !tagsData.selectedTags || tagsData.selectedTags.length === 0) {
          throw new Error("No tags provided in the node data.");
        }
        const selectedTags: string[] = tagsData.selectedTags;

        // Get the current contact to check existing tags
        const currentContact = await prisma.contact.findUnique({
          where: {phoneNumber: recipient},
          select: {tags: true}
        });

        if (!currentContact) {
          throw new Error(`Contact with phoneNumber ${recipient} not found.`);
        }

        // Combine existing tags with new tags and remove duplicates
        const existingTags = currentContact.tags || [];
        const uniqueTags = [...new Set([...existingTags, ...selectedTags])];

        // Update the Contact record with unique tags
        await prisma.contact.update({
          where: {phoneNumber: recipient},
          data: {
            tags: uniqueTags,
          },
        });

        console.log(`Updated contact ${recipient} with tags: ${selectedTags.join(", ")}`);

        // On success, find the outgoing edge with source handle "source_1" and process the next node.
        const nextEdge = edges.find(
          (edge) =>
            edge.sourceId === currentNode.id
        );
        if (nextEdge) {
          const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node: ${nextNode.id}`);
            await processNode(nextNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
        if (!nextEdge) {
          await bump(currentNode.chatId, "finished");
          await closePreviousNodeVisit(conversationId, contactId);
          return;
        }
      } catch (error) {
        console.error("Error updating tags for contact:", error);

        // On error, route to the error branch using the "source_2" edge.
        const errorEdge = edges.find(
          (edge) =>
            edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
        );
        if (errorEdge) {
          const errorNode = nodes.find((node) => node.id === errorEdge.targetId);
          if (errorNode) {
            console.log(`Transitioning to error node: ${errorNode.id}`);
            await processNode(errorNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
      }
      return; // Prevent further processing for this node.
    }

    if (currentNode.type === "question") {
      const questionData = currentNode.data?.question_data;
      if (questionData) {
        const questionMessage = {
          text: convertHtmlToWhatsAppText(questionData.questionText),
          chatId: currentNode.chatId,
          buttons: questionData.answerVariants?.map((variant: any, index: number) => ({
            id: `${index}_node_${currentNode.id}`,
            title: variant,
          })),
        };

        try {
          // Send question message
          console.log(`Sending question message:`, questionMessage);
          await sendQuestion(recipient, questionMessage, currentNode?.id, agentPhoneNumberId);
          await scheduleChatbotTimers(conversation);

          // Update the Variable table after successful question message sending
          if (questionData.saveAnswerVariable) {
            const variableName = questionData.saveAnswerVariable.startsWith("@")
              ? questionData.saveAnswerVariable.slice(1)
              : questionData.saveAnswerVariable;

            // Find the conversation using recipient and chatId
            const conversation = await prisma.conversation.findFirst({
              where: {
                recipient: recipient,
                chatbotId: currentNode?.chatbotId,

              },
            });

            if (conversation) {
              await scheduleChatbotTimers(conversation);
              // Check if the variable already exists
              const existingVariable = await prisma.variable.findFirst({
                where: {
                  name: variableName,
                  chatbotId: currentNode.chatbotId,
                  conversationId: conversation?.id,
                },
              });

              if (existingVariable) {
                // Update the existing variable
                await prisma.variable.update({
                  where: {id: existingVariable?.id},
                  data: {updatedAt: new Date()}, // Update timestamp
                });
              } else {
                // Create a new variable
                if (variableName != "") await prisma.variable.create({
                  data: {
                    name: variableName,
                    chatbotId: currentNode.chatId,
                    conversationId: conversation?.id,
                  },
                });
              }

              console.log(
                `Variable "${variableName}" saved for conversation ID ${conversation?.id} and chatbot ID ${currentNode.chatbotId}.`
              );
            } else {
              console.warn(
                `No conversation found for recipient ${recipient} and chatbot ID ${currentNode.chatbotId}.`
              );
            }
          }
        } catch (error) {
          console.error(
            "Error sending question message or updating variable table:",
            error
          );
        }
      }
      return; // Questions wait for user interaction
    }
    if (currentNode.type === "updateAttribute") {
      try {
        // 1) Ensure attribute data exists
        const attributeData = currentNode.data?.attribute_data;
        if (!attributeData || !Array.isArray(attributeData.attributes)) {
          throw new Error("No attribute data provided.");
        }

        // 2) Retrieve the contact record
        const contactRecord = await prisma.contact.findUnique({
          where: {phoneNumber: recipient},
        });
        if (!contactRecord) {
          throw new Error(`Contact with phoneNumber ${recipient} not found.`);
        }

        // 3) Filter out any bad entries (no undefined keys/values)
        const cleanPairs = attributeData.attributes.filter(
          (a: any): a is { key: string; value: string } =>
            typeof a.key === "string" && typeof a.value === "string"
        );

        // 4) Resolve variables in both keys and values
        const resolvedPairs = await Promise.all(
          cleanPairs.map(async ({key, value}: { key: string; value: string }) => {
            let resolvedKey = key;
            let resolvedValue = value;

            // Resolve variables in the key
            if (key.includes("@")) {
              resolvedKey = await resolveVariables(key, currentNode?.chatId || currentNode?.chatbotId, recipient, agentPhoneNumberId);
            }
            if (key.includes("{{")) {
              resolvedKey = await resolveContactAttributes(key, recipient);
            }

            // Resolve variables in the value
            if (value.includes("@")) {
              resolvedValue = await resolveVariables(value, currentNode?.chatId || currentNode?.chatbotId, recipient, agentPhoneNumberId);
            }
            if (value.includes("{{")) {
              resolvedValue = await resolveContactAttributes(value, recipient);
            }

            return {key: resolvedKey, value: resolvedValue};
          })
        );

        // 5) Reduce into a flat object for JSON storage
        //    stripping any leading "@" from the key:
        const attributesJson: Record<string, string> = resolvedPairs.reduce(
          (obj: Record<string, string>, {key, value}: { key: string; value: string }) => {
            // remove leading @ if present
            const sanitizedKey = key.startsWith("@")
              ? key.slice(1)
              : key;

            obj[sanitizedKey] = value;
            return obj;
          },
          {}
        );

        // 6) Update the contact's JSON attributes column
        await prisma.contact.update({
          where: {phoneNumber: recipient},
          data: {attributes: attributesJson},
        });

        // Check rules after successful attribute update
        await checkRulesForNodeAction(recipient, "attributeChanged", agentPhoneNumberId, undefined);

        // 7) On success, transition along the first outgoing edge
        const nextEdge = edges.find(edge => edge.sourceId === currentNode.id);
        if (nextEdge) {
          const nextNode = nodes.find(node => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node: ${nextNode.id}`);
            await processNode(nextNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
        if (!nextEdge) {
          await bump(currentNode.chatId, "finished");
          await closePreviousNodeVisit(conversationId, contactId);
          return;
        }
      } catch (error) {
        console.error("Error in updateAttribute node:", error);

        // On error, follow the "source_2" error edge
        const errorEdge = edges.find(
          edge =>
            edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
        );
        if (errorEdge) {
          const errorNode = nodes.find(node => node.id === errorEdge.targetId);
          if (errorNode) {
            console.log(`Transitioning to error node: ${errorNode.id}`);
            await processNode(errorNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
      }

      // Stop further handling for this node
      return;
    }

    if (currentNode.type === "updateChatStatus") {
      try {
        const contactRecord = await prisma.contact.findUnique({
          where: {phoneNumber: recipient},
        });
        if (!contactRecord) {
          throw new Error(`Contact with phoneNumber ${recipient} not found.`);
        }
        await prisma.contact.update({
          where: {phoneNumber: recipient},
          data: {ticketStatus: currentNode.data?.chat_status_data.selectedStatus},
        });
        // Extract the selected status from the node's data
        const chatStatusData = currentNode.data?.chat_status_data;
        if (!chatStatusData || !chatStatusData.selectedStatus) {
          throw new Error("No selectedStatus provided in the node data.");
        }
        const selectedStatus: string = chatStatusData.selectedStatus;

        // Find the conversation record for the given recipient and chatbotId.
        // Adjust the query if you have additional criteria.
        const conversation = await prisma.conversation.findFirst({
          where: {
            recipient: recipient,
            chatbotId: currentNode.chatbotId,
          },
        });

        if (!conversation) {
          throw new Error(
            `Conversation for recipient ${recipient} and chatbotId ${currentNode.chatbotId} not found.`
          );
        }

        // Update the conversation's chatStatus field to the selectedStatus.
        await prisma.conversation.update({
          where: {id: conversation?.id},
          data: {chatStatus: selectedStatus},
        });
        console.log(
          `Updated conversation (ID: ${conversation?.id}) with chatStatus: ${selectedStatus}`
        );
        await prisma.chatStatusHistory.create({
          data: {
            contactId: contactRecord?.id || 0,
            previousStatus: contactRecord?.ticketStatus,
            newStatus: selectedStatus,
            type: "statusChanged",
            changedById: null,
            changedAt: new Date(),
            timerStartTime: selectedStatus === "Open" ? new Date() : contactRecord?.timerStartTime,
          }
        });

        // On success, route to the next node via the outgoing edge with handle "source_1"
        const nextEdge = edges.find(
          (edge) =>
            edge.sourceId === currentNode.id
        );
        if (nextEdge) {
          const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node: ${nextNode.id}`);
            await processNode(nextNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
        if (!nextEdge) {
          await bump(currentNode.chatId, "finished");
          await closePreviousNodeVisit(conversationId, contactId);
          return;
        }
      } catch (error) {
        console.error("Error in updateChatStatus node:", error);

        // On error, route to the error branch using the "source_2" outgoing edge.
        const errorEdge = edges.find(
          (edge) =>
            edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
        );
        if (errorEdge) {
          const errorNode = nodes.find((node) => node.id === errorEdge.targetId);
          if (errorNode) {
            console.log(`Transitioning to error node: ${errorNode.id}`);
            await processNode(errorNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        }
      }
      return; // Prevent further processing for this node.
    }

    if (currentNode.type === "assignUser") {
      const assignedUserEmail = currentNode.data?.user_data?.selectedUser;
      const user = await prisma.user.findUnique({
        where: {email: assignedUserEmail},
      });
      if (user?.id) {
        try {
          // Update assigned user in the Contact model
          await prisma.contact.update({
            where: {phoneNumber: recipient}, // Assuming contact is identified by phoneNumber
            data: {
              userId: user?.id,
            },
          });
          const contactRecord = await prisma.contact.findUnique({
            where: {phoneNumber: recipient},
            select: {id: true}
          });
          if (!contactRecord) {
            throw new Error(`Contact with phoneNumber ${recipient} not found.`);
          }
          await prisma.chatStatusHistory.create({
            data: {
              contactId: contactRecord?.id || 0,
              newStatus: "Assigned",
              type: "assignmentChanged",
              note: `Assigned to agent ${assignedUserEmail}`,
              assignedToUserId: user?.id,
              changedById: null,
              changedAt: new Date(),
            }
          });

          console.log(`Assigned user ${user?.id} to contact ${recipient}`);
        } catch (error) {
          console.error(`Failed to assign user to contact ${recipient}:`, error);
        }

        // Proceed to the next node
        const outgoingEdge = edges.find((edge) => edge.sourceId === currentNode.id);
        if (outgoingEdge) {
          const nextNodeId = nodes.find((node) => node.id === outgoingEdge.targetId)?.nodeId;
          if (nextNodeId) {
            await processNode(nextNodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        } else {
          //console.warn(`No outgoing edge found for assignUser node ID: ${currentNode.id}`);
          await bump(currentNode.chatId, "finished");
          await closePreviousNodeVisit(conversationId, contactId);
          return;
        }
      }
      return;
    }

    if (currentNode.type === "assignTeam") {
      const assignTeamData = currentNode.data?.team_data.selectedTeams;

      if (assignTeamData && assignTeamData.length > 0) {
        try {
          // Fetch team IDs dynamically based on names
          const teams = await prisma.team.findMany({
            where: {
              OR: assignTeamData.map((teamName: string) =>
                teamName === "Default Team"
                  ? {defaultTeam: true} // Find the team with `defaultTeam: true`
                  : {name: teamName} // Find teams matching the given names
              ),
            },
            select: {id: true}, // Only fetch the IDs
          });

          const teamIds = teams.map((team) => ({id: team.id}));

          if (teamIds.length > 0) {
            // Update assigned teams in the Contact model
            await prisma.contact.update({
              where: {phoneNumber: recipient}, // Assuming contact is identified by phoneNumber
              data: {
                assignedTeams: {set: teamIds}, // Assign multiple teams
              },
            });
            const contactRecord = await prisma.contact.findUnique({
              where: {phoneNumber: recipient},
              select: {id: true}
            });
            if (!contactRecord) {
              throw new Error(`Contact with phoneNumber ${recipient} not found.`);
            }
            await prisma.chatStatusHistory.create({
              data: {
                contactId: contactRecord?.id || 0,
                newStatus: "Assigned",
                type: "assignmentChanged",
                note: `Assigned to Teams: ${assignTeamData.join(", ")}`,
                changedById: null,
                changedAt: new Date(),
              }
            });

            console.log(`Assigned teams ${teamIds.map((t) => t.id)} to contact ${recipient}`);
          } else {
            console.warn(`No matching teams found for contact ${recipient}`);
          }
        } catch (error) {
          console.error(`Failed to assign teams to contact ${recipient}:`, error);
        }

        // Proceed to the next node
        const outgoingEdge = edges.find((edge) => edge.sourceId === currentNode.id);
        if (outgoingEdge) {
          const nextNodeId = nodes.find((node) => node.id === outgoingEdge.targetId)?.nodeId;
          if (nextNodeId) {
            await processNode(nextNodeId, nodes, edges, recipient, agentPhoneNumberId);
          }
        } else {
          //console.warn(`No outgoing edge found for assignTeam node ID: ${currentNode.id}`);
          await bump(currentNode.chatId, "finished");
          await closePreviousNodeVisit(conversationId, contactId);
          return;
        }
      }
      return;
    }


    if (currentNode.type === "delay") {
      const delayData = currentNode.data?.delay_data;
      if (delayData) {
        const {minutes = 0, seconds = 0} = delayData;
        const delayTime = (minutes * 60 + seconds) * 1000;

        console.log(
          `Delaying for ${minutes} minute(s) and ${seconds} second(s)...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayTime));
        console.log("Delay completed. Processing the next node...");

        // Find the next node and process it
        const outgoingEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id
        );
        if (outgoingEdge) {
          const nextNodeId = nodes.find(
            (node) => node.id === outgoingEdge.targetId
          )?.nodeId;
          if (nextNodeId) {
            await processNode(nextNodeId, nodes, edges, recipient, agentPhoneNumberId); // Recursive call to process the next node
          }
        } else {
          //console.warn(
          //  `No outgoing edge found for delay node ID: ${currentNode.id}`
          //);
          await bump(currentNode.chatId, "finished");
          await closePreviousNodeVisit(conversationId, contactId);
          return;
        }
      }
      return; // Ensure no further processing for the current node
    }

    if (currentNode.type === "webhook") {
      const webhookData = currentNode.data?.webhook_data;

      if (webhookData) {
        try {
          // Prepare headers
          const headers = webhookData.headers?.reduce((acc: Record<string, string>, header: any) => {
            if (header.key && header.value) {
              acc[header.key] = header.value;
            }
            return acc;
          }, {});

          // Parse and validate the body
          let requestBody = undefined;
          if (webhookData.isBodyEnabled && webhookData.body) {
            try {
              requestBody = JSON.parse(webhookData.body);
            } catch (error) {
              console.error("Invalid JSON in webhook body:", error);
              throw new Error("Invalid JSON body");
            }
          }

          // Make the API call
          const response = await fetch(webhookData.url, {
            method: webhookData.method || "POST",
            headers: headers,
            body: requestBody ? JSON.stringify(requestBody) : undefined,
          });

          const responseBody = await response.json();
          const responseStatus = response.status.toString();
          const sourceHandle = `source_${responseStatus}`;
          // Check if response status matches any expectedStatuses
          const expectedStatusMatch = webhookData.expectedStatuses.some(
            (status: any) => status.value === responseStatus
          );

          if (expectedStatusMatch) {
            console.log(`Response status ${responseStatus} matches an expected status.`);
            const matchingEdge = edges.find(
              (edge) =>
                edge.sourceHandle === sourceHandle && edge.sourceId === currentNode.id
            );

            if (matchingEdge) {
              const nextNodeId = matchingEdge.targetId;

              // Find the next node from the nodes array
              const nextNode = nodes.find((node) => node.id === nextNodeId);

              if (nextNode) {
                console.log(`Navigating to the next node: ${nextNode.nodeId}`);
                await processNode(nextNode.nodeId, nodes, edges, recipient, agentPhoneNumberId);
              } else {
                //console.warn(`No next node found with nodeId: ${nextNodeId}`);
                await bump(currentNode.chatId, "finished");
                await closePreviousNodeVisit(conversationId, contactId);
                return;
              }
            } else {
              //console.warn(`No matching edge found for sourceHandle: ${sourceHandle}`);
              await bump(currentNode.chatId, "finished");
              await closePreviousNodeVisit(conversationId, contactId);
              return;
            }
          } else {
            console.warn(`Response status ${responseStatus} does not match any expected statuses.`);
          }

          console.log("Response Body:", responseBody);
        } catch (error) {
          console.error("Error processing webhook_data:", error);
        }
      }
    }

  } catch (error) {
    console.error("Error in processNode:", error);
  }
};

export const sendMessage = async (
  recipient: string,
  message: any,
  chatbotId: number = 1, // Default to 1 if not provided
  userId: number = 0,     // Default to 1 if not provided
  plainText?: boolean,
  agentPhoneNumberId?: string
) => {
  try {

    const url = `${metaWhatsAppAPI.baseURL}/${agentPhoneNumberId}/messages`;
    let messageBody;
    const payload: any = {
      messaging_product: "whatsapp",
      to: recipient,
      biz_opaque_callback_data: `chatId=${chatbotId}`
    };

    if (message) {
      // Handle different media types
      switch (message.type) {
        case "text":
          payload.type = "text";

          // Resolve variables in the message text
          messageBody = message.message;
          if (!plainText && messageBody.includes("@")) {
            messageBody = await resolveVariables(messageBody, chatbotId, recipient, agentPhoneNumberId || "");
          }
          if (!plainText && messageBody.includes("{{")) {
            messageBody = await resolveContactAttributes(messageBody, recipient);
          }
          payload.text = {body: plainText ? message.message : convertHtmlToWhatsAppText(messageBody)};
          break;
          // payload.type = "text";
          // payload.text = { body: plainText?message.message:convertHtmlToWhatsAppText(message.message) };
          break;
        case "image":
          payload.type = "image";
          payload.image = {
            link: message.message.url,
            caption: "",
          };
          messageBody = `Image: ${message.message.url}`;
          break;
        case "audio":
          payload.type = "audio";
          payload.audio = {link: message.message.url};
          messageBody = `Audio: ${message.message.url}`;
          break;
        case "video":
          payload.type = "video";
          payload.video = {
            link: message.message.url,
            caption: "",
          };
          messageBody = `Video:${message.message.url}`;
          break;
        case "document":
          payload.type = "document";
          payload.document = {
            link: message.message.url,
            caption: "",
          };
          messageBody = `Document:${message.message.url}`;
          break;
        case "sticker":
          payload.type = "sticker";
          payload.sticker = {
            link: message.message.url,
          };
          messageBody = `Sticker: ${message.message.url}`;
          break;
        default:
          console.error("Unsupported media type:", message.type);
          return;
      }
    }

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    await storeMessage({recipient, chatbotId, messageType: message.type, text: messageBody}, agentPhoneNumberId);

    if (userId) {
      try {
        const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
          where: {metaPhoneNumberId: agentPhoneNumberId}
        });

        if (businessPhoneNumber) {
          const conversation = await prisma.conversation.findFirst({
            where: {
              recipient,
              businessPhoneNumberId: businessPhoneNumber.id
            },
            orderBy: {updatedAt: 'desc'}
          });

          if (conversation) {
            await prisma.conversation.update({
              where: {id: conversation.id},
              data: {
                lastAgentMessageAt: new Date(),
                waitingMessageSent: false
              }
            });

            const {reschedule24hJobForConversation} = await import("../../utils/noResponse24hUtils");
            await reschedule24hJobForConversation(
              conversation.id,
              recipient,
              agentPhoneNumberId
            );
          }
        }
      } catch (waitingError) {
        console.error("Error updating agent message timestamp:", waitingError);
      }
    }
  } catch (error) {
    console.error("Error sending message:", error);
  }
};

export const sendTemplate = async (
  recipient: string,
  selectedTemplate: string,
  chatbotId: number | null,
  templateDetails: any,
  agentPhoneNumberId?: string
) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${agentPhoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: recipient,
      biz_opaque_callback_data: `chatId=${chatbotId}&type=template`,
      type: "template",
      template: {
        name: selectedTemplate,
        language: {code: "en_US"}, // Set your default language or make it dynamic
      },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    await storeMessage({
      recipient,
      chatbotId,
      messageType: "template",
      text: `Template: ${selectedTemplate}`,
      templateDetails: templateDetails
    }, agentPhoneNumberId);

    // Update lastAgentMessageAt timestamp and schedule 24h job when agent sends template
    try {
      const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
        where: {metaPhoneNumberId: agentPhoneNumberId}
      });

      if (businessPhoneNumber) {
        const conversation = await prisma.conversation.findFirst({
          where: {
            recipient,
            businessPhoneNumberId: businessPhoneNumber.id
          },
          orderBy: {updatedAt: 'desc'}
        });

        if (conversation) {
          console.log(`📧 Agent sent template - updating lastAgentMessageAt for conversation ${conversation.id}`);
          await prisma.conversation.update({
            where: {id: conversation.id},
            data: {
              lastAgentMessageAt: new Date(),
              waitingMessageSent: false // Reset the flag so waiting message can be sent again if needed
            }
          });

          // Schedule 24-hour no response job when agent sends template
          console.log(`📅 Agent sent template - scheduling 24h no response job for conversation ${conversation.id}`);
          const {reschedule24hJobForConversation} = await import("../../utils/noResponse24hUtils");
          await reschedule24hJobForConversation(
            conversation.id,
            recipient,
            agentPhoneNumberId
          );
        }
      }
    } catch (waitingError) {
      console.error("Error updating agent message timestamp in template:", waitingError);
    }

  } catch (error) {
    console.error("Error sending template message:", error);
    throw new Error("Failed to send WhatsApp template");
  }
};

export const sendMessageWithButtons = async (
  recipient: string,
  buttonMessage: any,
  agentPhoneNumberId?: string
) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${agentPhoneNumberId}/messages`;

    const headerText: any = buttonMessage.header && buttonMessage.header.type === "text"
      ? await resolveVariables(buttonMessage.header, buttonMessage.chatId, recipient, agentPhoneNumberId)
      : undefined;

    const headerPayload = buttonMessage.header && (buttonMessage.header as any).type
      ? (buttonMessage.header as any)
      : headerText
        ? {type: "text", text: headerText.text}
        : undefined;

    let bodyText = buttonMessage.body.text;

    if (buttonMessage.body.text && buttonMessage.body.text.includes("@")) {
      bodyText = await resolveVariables(buttonMessage.body.text, buttonMessage.chatId, recipient, agentPhoneNumberId);
    }
    if (buttonMessage.body.text && buttonMessage.body.text.includes("{{")) {
      bodyText = await resolveContactAttributes(buttonMessage.body.text, recipient);
    }

    const buttonOptions = buttonMessage.action.buttons.map((btn: any) => ({
      id: btn.reply.id,
      title: btn.reply.title,
    }));
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to: recipient,
        type: "interactive",
        interactive: {
          type: "button",
          // header: headerText ? { type: "text", text: headerText.text } : undefined,
          header: headerPayload,
          body: {text: convertHtmlToWhatsAppText(bodyText)},
          footer: buttonMessage.footer
            ? {text: buttonMessage.footer.text}
            : undefined,
          action: {buttons: buttonMessage.action.buttons},
        },

        biz_opaque_callback_data: `chatId=${buttonMessage.chatId}`
      },
      {
        headers: {
          Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    // await storeMessage({
    //   recipient,
    //   chatbotId: buttonMessage.chatId,
    //   messageType: "button",
    //   text: bodyText,
    //   buttonOptions,
    // }, agentPhoneNumberId);
  } catch (error) {
    console.error("Error sending button message:", error);
  }
};

export const sendMessageWithList = async (
  recipient: string,
  listMessage: ListMessage,
  nodeId: number,
  agentPhoneNumberId?: string,
  chatId?: number
) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${agentPhoneNumberId}/messages`;
    const listItems = listMessage.sections.flatMap((section: any, sectionIndex: number) =>
      section.rows.map((row: any, rowIndex: number) => ({
        id: `source_${sectionIndex}_${rowIndex}_node_${nodeId}`,
        title: row,
        description: "",
      }))
    );
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "interactive",
      interactive: {
        type: "list",
        header: {
          type: "text",
          text: listMessage.header
        },
        body: {
          text: listMessage.text
        },
        footer: {
          text: listMessage.footer
        },
        action: {
          button: listMessage.buttonText,
          sections: listMessage.sections.map((section, sectionIndex) => ({
            title: section.sectionTitle,
            rows: section.rows.map((row, rowIndex) => ({
              id: `source_${sectionIndex}_${rowIndex}_node_${nodeId}`,
              title: row,
              description: "",
            })),
          })),
        }

      }
    };


    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    await storeMessage({
      recipient,
      chatbotId: chatId,
      messageType: "list",
      text: listMessage.text,
      listItems,
    }, agentPhoneNumberId);
  } catch (error) {
    console.error("Error sending list message:", error);
  }
};

export const sendQuestion = async (
  recipient: string,
  questionMessage: any,
  currentNodeId: number,
  agentPhoneNumberId?: string
) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${agentPhoneNumberId}/messages`;
    
    // Resolve variables in the question text
    let resolvedText = questionMessage.text;
    if (questionMessage.text && questionMessage.text.includes("@")) {
      resolvedText = await resolveVariables(questionMessage.text, questionMessage.chatId, recipient, agentPhoneNumberId || "");
    }
    if (questionMessage.text && questionMessage.text.includes("{{")) {
      resolvedText = await resolveContactAttributes(questionMessage.text, recipient);
    }
    const textBody = convertHtmlToWhatsAppText(resolvedText);

    // Filter out only well-formed buttons
    const validOptions = questionMessage.buttons.filter(
      (opt: any) => opt.id && opt.title
    );

    // 1️⃣ If no buttons, send a plain text message instead
    if (validOptions.length === 0) {
      // ✅ fetch & mark the convo as "answeringQuestion"
      const conversation = await prisma.conversation.findFirst({
        where: {
          recipient,
          chatbotId: questionMessage.chatId,
        },
      });
      if (conversation) {
        await prisma.conversation.update({
          where: {id: conversation.id},
          data: {
            answeringQuestion: true,
            currentNodeId: currentNodeId,
          },
        });
      }

      // now send plain‐text fallback (using already resolved text)
      const textPayload = {
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: {body: textBody},
        biz_opaque_callback_data: `chatId=${questionMessage.chatId}`,
      };

      await axios.post(url, textPayload, {
        headers: {
          Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      await storeMessage({
        recipient,
        chatbotId: questionMessage.chatId,
        messageType: "question",
        text: resolvedText,
      }, agentPhoneNumberId);
      return;
    }


    // 2️⃣ Otherwise, proceed with interactive button payload
    const conversation = await prisma.conversation.findFirst({
      where: {
        recipient,
        chatbotId: questionMessage.chatId,
      },
    });
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    await prisma.conversation.update({
      where: {id: conversation.id},
      data: {
        answeringQuestion: true,
        currentNodeId,
        chatbotId: questionMessage.chatId,
      },
    });

    const interactivePayload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "interactive",
      interactive: {
        type: "button",
        body: {text: textBody},
        action: {
          buttons: validOptions.map((opt: any) => ({
            type: "reply",
            reply: {id: opt.id, title: opt.title},
          })),
        },
      },
      biz_opaque_callback_data: `chatId=${questionMessage.chatId}`,
    };

    await axios.post(url, interactivePayload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    await storeMessage({
      recipient,
      chatbotId: questionMessage.chatId,
      messageType: "question",
      text: resolvedText,
    }, agentPhoneNumberId);
  } catch (error: any) {
    console.error(
      "Error sending question message:",
      error.response?.data || error.message
    );
  }
};

export const storeMessage = async ({
                                     recipient,
                                     chatbotId,
                                     messageType,
                                     text,
                                     status = MessageStatus.SENT,
                                     buttonOptions,
                                     listItems,
                                     templateDetails
                                   }: {
  recipient: string;
  chatbotId?: number | null;
  messageType: string;
  text?: string;
  status?: MessageStatus;
  buttonOptions?: { id: string; title: string }[]; // Store button options as JSON
  listItems?: { id: string; title: string; description?: string }[]; // Store list items as JSON
  templateDetails?: any;
}, agentPhoneNumberId?: string) => {
  try {
    // Attempt to find an existing contact by phone number
    let contact = await prisma.contact.findUnique({
      where: {phoneNumber: recipient},
    });
    let conversation;

    if (!contact) {
      // If no contact exists, create it along with a nested conversation
      const newContact = await prisma.contact.create({
        data: {
          phoneNumber: recipient,
          name: "Unknown",
          source: "WhatsApp",
          conversations: {
            create: {recipient, chatbotId},
          },
        },
        include: {conversations: true}, // Include nested conversation(s)
      });
      contact = newContact;
      // Retrieve the nested conversation that was just created
      conversation = newContact.conversations[0];
      console.log("✅ New contact and conversation created:", contact, conversation);
    } else {
      // If the contact exists, try to find an existing conversation linked to it
      conversation = await prisma.conversation.findFirst({
        where: {recipient, contactId: contact.id},
        orderBy: {updatedAt: "desc"},
      });
      if (!conversation) {
        const bp=await prisma.businessPhoneNumber.findFirst({
          where: {
            metaPhoneNumberId: agentPhoneNumberId
          }
        });
        // Create a new conversation if one isn't found
        conversation = await prisma.conversation.create({
          data: {recipient, contactId: contact.id, chatbotId, businessPhoneNumberId: bp?.id},
        });
        console.log("✅ New conversation created:", conversation);
      }
    }
    let attachmentUrl;
    if (text?.startsWith("Image:") || text?.startsWith("Audio:") || text?.startsWith("Video:") || text?.startsWith("Document:") || text?.startsWith("Sticker:")) {
      const parts = text.split(/:(.+)/); // Split at the first colon only
      attachmentUrl = parts[1]?.trim();
      text="";
    }
    // Create a new message attached to the conversation and contact
    const savedMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        contactId: contact.id,
        chatbotId,
        sender: "user",
        text,
        messageType,
        buttonOptions: buttonOptions && buttonOptions.length > 0 ? buttonOptions : Prisma.JsonNull,
        listItems: listItems && listItems.length > 0 ? listItems : Prisma.JsonNull,
        status,
        time: new Date(),
        templateId: templateDetails?.id || null,
        attachment: attachmentUrl || null,
      },
    });
    io.emit("newMessage", {
      recipient: contact.phoneNumber,
      message: savedMessage,
      template: templateDetails || null
    });
    return savedMessage;
  } catch (error) {
    console.error("❌ Error storing message:", error);
  }
};

// Functions for handling webhook verification
export const processWebhookChange = async (change: any, io: any) => {
  const statuses = change.value?.statuses;
  if (statuses) await processBroadcastStatus(statuses);

  if (change.field === "message_template_status_update") {
    await updateTemplateInDb(change.value);
  } else {
    await processMessageChange(change, io);
  }
};

export const processMessageChange = async (change: any, io: any) => {
  const agentPhoneNumber = change.value?.metadata?.display_phone_number;
  const agentPhoneNumberId = change.value?.metadata?.phone_number_id;
  const message = change.value?.messages?.[0];
  const recipient = message?.from;

  if (!recipient) return;

  // if (!isAllowedSender(recipient)) {
  //   return; // Ignore and exit
  // }

  // Emit socket event for new message
  const processedMessage = await processWebhookMessage(
    recipient,
    message,
    agentPhoneNumber
  );
  io.emit("newMessage", {recipient, message: processedMessage});

  // Get or create conversation
  const conversation = await getOrCreateConversation(recipient, message);
  if (!conversation) return;

  // Get chatbot data
  const chatbotData = await getChatbotData(conversation);
  if (!chatbotData) return;

  // Process the message based on its type
  await processMessageByType(message, recipient, conversation, chatbotData, agentPhoneNumberId);
};

export const isAllowedSender = (recipient: string): boolean => {
  const allowedTestNumbers = process.env.ALLOWED_TEST_NUMBERS
    ? process.env.ALLOWED_TEST_NUMBERS.split(",").map((num) => num.trim())
    : [];

  return allowedTestNumbers.includes(recipient);
};

export const getOrCreateConversation = async (recipient: string, message: any): Promise<any | null> => {
  let conversation = await prisma.conversation.findFirst({
    where: {recipient},
    orderBy: {
      updatedAt: "desc",
    },
  });

  if (!conversation) {
    console.log("No conversation found for recipient. Attempting to create a new one...");

    const chatbotId = await findChatbotIdByKeyword(message?.text?.body?.toLowerCase());

    if (!chatbotId) {
      console.warn("No keyword match found. Unable to associate a chatbot.");
      await sendMessage(
        recipient,
        {
          type: "text",
          message: "Sorry, no chatbot is available for your query."
        },
        1, // default chatbotId
        1  // default userId
      );
      return null;
    }

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

export const findChatbotIdByKeyword = async (text: string | undefined): Promise<number | null> => {
  if (!text) return null;

  // Get all keywords to perform advanced matching
  const allKeywords = await prisma.keyword.findMany({
    include: {chatbot: true},
  });

  // Use the new matching logic to find the best matching keyword
  const matchResult = findMatchingKeyword(text, allKeywords);
  const keyword = matchResult?.keyword;

  if (keyword?.chatbot) {
    console.log(`Keyword matched: "${keyword.value}" with ${matchResult?.matchType} match (score: ${matchResult?.matchScore?.toFixed(2)}). Using chatbot ID: ${keyword.chatbot.id}`);
    return keyword.chatbot.id;
  }

  return null;
};

export const getChatbotData = async (conversation: any) => {
  if (!conversation || !conversation.chatbotId) return null;

  const chatbotData = await prisma.chatbot.findUnique({
    where: {id: conversation.chatbotId},
    include: {nodes: true, edges: true},
  });

  if (!chatbotData) {
    console.warn(`Chatbot with ID ${conversation.chatbotId} not found.`);
    return null;
  }

  return chatbotData;
};

export const processMessageByType = async (message: any, recipient: string, conversation: any, chatbotData: any, agentPhoneNumberId: string | undefined) => {
  if (message?.interactive?.button_reply) {
    await processButtonReply(message, recipient, chatbotData, agentPhoneNumberId);
  } else if (message?.interactive?.list_reply) {
    await processListReply(message, recipient, chatbotData, agentPhoneNumberId);
  } else if (conversation.answeringQuestion) {
    await processTextQuestion(message, recipient, conversation, chatbotData, agentPhoneNumberId);
  } else if (message?.text?.body) {
    await processKeywordMessage(message.text.body.toLowerCase(), recipient, agentPhoneNumberId);
  }
};

export const processButtonReply = async (message: any, recipient: string, chatbotData: any, agentPhoneNumberId: string | undefined) => {
  const parts = message.interactive.button_reply.id.split("_node_");
  const buttonId = "source_" + parts[0];
  const nodeId = parseInt(parts[1]);

  const selectedEdge = chatbotData.edges.find(
    (edge: any) => edge.sourceHandle === buttonId && edge.sourceId === nodeId
  );

  const nextNodeId = selectedEdge
    ? chatbotData.nodes.find((node: any) => node.id === selectedEdge.targetId)?.nodeId
    : null;

  // Find the current node data
  const currentNode = chatbotData.nodes.find((node: any) => node.id === nodeId);

  await saveButtonVariableIfNeeded(currentNode, message, recipient);

  if (nextNodeId) {
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient, agentPhoneNumberId);
  }
};

export const saveButtonVariableIfNeeded = async (currentNode: any, message: any, recipient: string) => {
  if (!currentNode?.data?.buttons_data?.saveAnswerVariable) return;

  const variableName = currentNode.data.buttons_data.saveAnswerVariable.startsWith("@")
    ? currentNode.data.buttons_data.saveAnswerVariable.slice(1)
    : currentNode.data.buttons_data.saveAnswerVariable;

  // Find the conversation
  const conversation = await prisma.conversation.findFirst({
    where: {recipient, chatbotId: currentNode.chatbotId || currentNode.chatId},
  });

  if (!conversation) return;

  // Check if the variable already exists
  const existingVariable = await prisma.variable.findFirst({
    where: {
      name: variableName,
      chatbotId: currentNode.chatbotId || currentNode.chatId,
      conversationId: conversation.id,
    },
  });

  if (existingVariable) {
    // Update the existing variable with the button reply title
    await prisma.variable.update({
      where: {id: existingVariable.id},
      data: {
        value: message.interactive.button_reply.title,
        nodeId: currentNode.id,
      },
    });
  } else {
    // Create a new variable with the button reply title
    await prisma.variable.create({
      data: {
        name: variableName,
        value: message.interactive.button_reply.title,
        chatbotId: currentNode.chatbotId || currentNode.chatId,
        conversationId: conversation.id,
      },
    });
  }
};

export const processListReply = async (message: any, recipient: string, chatbotData: any, agentPhoneNumberId: string | undefined) => {
  const listReplyId = message.interactive.list_reply.id;
  const nodeId = parseInt(listReplyId.split("_node_")[1]);
  const buttonId = listReplyId.split("_node_")[0];
  const currentNode = chatbotData.nodes.find((node: any) => node.id === nodeId);

  await saveListVariableIfNeeded(currentNode, message, recipient);

  const selectedEdge = chatbotData.edges.find(
    (edge: any) => edge.sourceId === currentNode?.id && edge.sourceHandle === buttonId
  );

  const nextNodeId = selectedEdge
    ? chatbotData.nodes.find((node: any) => node.id === selectedEdge.targetId)?.nodeId
    : null;

  if (nextNodeId) {
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient, agentPhoneNumberId);
  }
};

export const saveListVariableIfNeeded = async (currentNode: any, message: any, recipient: string) => {
  if (!currentNode?.data?.list_data?.saveAnswerVariable) return;

  const variableName = currentNode.data.list_data.saveAnswerVariable.startsWith("@")
    ? currentNode.data.list_data.saveAnswerVariable.slice(1)
    : currentNode.data.list_data.saveAnswerVariable;

  // Find the conversation
  const conversation = await prisma.conversation.findFirst({
    where: {recipient, chatbotId: currentNode.chatbotId || currentNode.chatId},
  });

  if (!conversation) return;

  // Check if the variable already exists
  const existingVariable = await prisma.variable.findFirst({
    where: {
      name: variableName,
      chatbotId: currentNode.chatbotId || currentNode.chatId,
      conversationId: conversation.id,
    },
  });

  if (existingVariable) {
    // Update the existing variable with the list reply title
    await prisma.variable.update({
      where: {id: existingVariable.id},
      data: {
        value: message.interactive.list_reply.title,
        nodeId: currentNode.id,
      },
    });
  } else {
    // Create a new variable with the list reply title
    await prisma.variable.create({
      data: {
        name: variableName,
        value: message.interactive.list_reply.title,
        chatbotId: currentNode.chatbotId || currentNode.chatId,
        conversationId: conversation.id,
      },
    });
  }
};

export const processTextQuestion = async (message: any, recipient: string, conversation: any, chatbotData: any, agentPhoneNumberId: string | undefined) => {
  const currentNode = await prisma.node.findFirst({
    where: {id: conversation.currentNodeId},
  });

  if (currentNode?.type !== "question") return;

  // Use type assertion to handle the data property
  const questionData = currentNode.data as any;
  const {
    validation,
    validationFailureExitCount = 3,
    saveAnswerVariable,
  } = questionData?.question_data || {};

  let failureCount = conversation.validationFailureCount;
  const text = message?.text?.body;

  if (message?.type !== "text" || !text) return;

  const isValid = validateUserResponse(text, validation);

  if (isValid) {
    await handleValidResponse(conversation, currentNode, text, recipient, chatbotData, agentPhoneNumberId);
  } else {
    await handleInvalidResponse(conversation, failureCount, validationFailureExitCount, validation, recipient, agentPhoneNumberId);
  }
};

export const handleValidResponse = async (conversation: any, currentNode: any, text: string, recipient: string, chatbotData: any, agentPhoneNumberId: string | undefined) => {
  await prisma.conversation.update({
    where: {id: conversation.id},
    data: {
      answeringQuestion: false,
      validationFailureCount: 0,
    },
  });

  await saveTextVariable(currentNode, text, conversation);

  console.log("Text response is valid. Proceeding to the next node...");
  const nextNodeId = getNextNodeIdFromQuestion(chatbotData, null, currentNode.id);
  if (nextNodeId) {
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient, agentPhoneNumberId);
  }
};

export const saveTextVariable = async (currentNode: any, text: string, conversation: any) => {
  const saveAnswerVariable = currentNode.data?.question_data?.saveAnswerVariable;
  if (!saveAnswerVariable) return;

  const variableName = saveAnswerVariable.startsWith("@")
    ? saveAnswerVariable.slice(1)
    : saveAnswerVariable;

  const existingVariable = await prisma.variable.findFirst({
    where: {
      name: variableName,
      chatbotId: currentNode.chatId,
      conversationId: conversation.id,
    },
  });

  if (existingVariable) {
    await prisma.variable.update({
      where: {id: existingVariable.id},
      data: {value: text},
    });
  } else {
    await prisma.variable.create({
      data: {
        name: variableName,
        value: text,
        chatbotId: currentNode.chatId,
        conversationId: conversation.id,
      },
    });
  }
};

export const handleInvalidResponse = async (conversation: any, failureCount: number, validationFailureExitCount: number, validation: any, recipient: string, agentPhoneNumberId: string | undefined) => {
  // Increment failure count
  failureCount += 1;

  if (failureCount >= validationFailureExitCount) {
    // End the chat flow after exceeding failure limit
    await prisma.conversation.update({
      where: {id: conversation.id},
      data: {
        answeringQuestion: false,
        validationFailureCount: 0,
      },
    });

    await sendMessage(
      recipient,
      {
        type: "text",
        message: `You have given incorrect answers ${validationFailureExitCount} times. Closing chatflow.`,
      },
      conversation.chatbotId || 1,
      1,
      true,
      agentPhoneNumberId
    );

    console.warn("Chatflow ended due to repeated invalid responses.");
  } else {
    // Update failure count and send error message
    await prisma.conversation.update({
      where: {id: conversation.id},
      data: {validationFailureCount: failureCount},
    });

    console.warn(`Response is invalid. Failure count: ${failureCount}`);
    await sendMessage(
      recipient,
      {
        type: "text",
        message: validation?.errorMessage || "Invalid response. Please try again.",
      },
      conversation.chatbotId || 1,
      1,
      true,
      agentPhoneNumberId
    );
  }
};

export const processKeywordMessage = async (text: string, recipient: string, agentPhoneNumberId: string | undefined) => {
  // Get all keywords to perform advanced matching
  const allKeywords = await prisma.keyword.findMany({
    include: {chatbot: true},
  });

  // Use the new matching logic to find the best matching keyword
  const matchResult = findMatchingKeyword(text, allKeywords);
  const keyword = matchResult?.keyword;

  if (keyword?.chatbot) {
    const chatbotId = keyword.chatbot.id;
    console.log(`Keyword matched: "${keyword.value}" with ${matchResult?.matchType} match (score: ${matchResult?.matchScore?.toFixed(2)}). Starting chatbot flow.`);

    await prisma.conversation.update({
      where: {id: (await prisma.conversation.findFirst({where: {recipient}}))?.id},
      data: {answeringQuestion: false},
    });
    await processChatFlow(chatbotId, recipient, agentPhoneNumberId);
  }
};

export const updateTemplateInDb = async (data: any) => {
  // Extract the fields from the webhook payload
  const {
    event, // e.g. "APPROVED", "REJECTED"
    message_template_id,
    message_template_name,
    message_template_language,
    reason,
  } = data;

  // Update the template record in your database by unique name.
  await prisma.template.update({
    where: {name: message_template_name},
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
  // Find the outgoing edge from the current node
  const outgoingEdge = chatbotData.edges.find((edge: any) => {
    // Match the sourceId with the current node's ID
    // Optionally check for buttonId in the sourceHandle for branching
    return (
      edge.sourceId === currentNodeId &&
      (!buttonId || edge.sourceHandle === buttonId)
    );
  });

  if (!outgoingEdge) {
    console.warn(`No outgoing edge found for node ID: ${currentNodeId}`);
    return null;
  }

  // Find the target node ID from the edge
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
