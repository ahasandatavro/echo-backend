import { prisma } from "../../models/prismaClient";
import axios from "axios";
import { metaWhatsAppAPI } from "../../config/metaConfig";
import { convertHtmlToWhatsAppText } from "../../helpers/index";
import { resolveVariables } from "../../helpers/validation";
import { ListMessage } from "../../interphases";
import { performGoogleSheetAction } from "../../subProcessors/metaWebhook";
import { MessageStatus } from "../../interphases"; // ✅ Import the correct enum
import { Prisma } from "@prisma/client"; // ✅ Import Prisma types
import { io } from "../../app";
import { validateUserResponse } from "../../helpers/validation";
import { processWebhookMessage } from "../inboxProcessor";
import { processBroadcastStatus } from "../../subProcessors/metaWebhook";

export const processChatFlow = async (chatbotId: number, recipient: string) => {
  try {
    const chatbotData = await prisma.chatbot.findUnique({
      where: { id: chatbotId },
      include: { nodes: true, edges: true },
    });
  
    if (chatbotData) {
      const startNode = chatbotData.nodes.find((node) => node.type === "start");
      if (!startNode) {
        await sendMessage(recipient, "Chatbot start node not configured.",chatbotData?.id,1);
        return;
      }
          // Fetch all conversations for the recipient
    const recipientConversations = await prisma.conversation.findMany({
      where: { recipient },
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
        where: { id: matchingConversation.id },
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
      recipient
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
  recipient: string
) => {
  try {
    const currentNode = nodes.find((node) => node.nodeId === nodeId);

    if (!currentNode) {
      console.error(`Node with ID ${nodeId} not found.`);
      return;
    }

    if (currentNode.type === "start") {
      const outgoingEdge = edges.find(
        (edge) => edge.sourceId === currentNode.id
      );
      if (outgoingEdge) {
        const nextNodeId = nodes.find(
          (node) => node.id === outgoingEdge.targetId
        )?.nodeId;
        if (nextNodeId) {
          await processNode(nextNodeId, nodes, edges, recipient);
        }
      }
      return;
    }

    if (currentNode.type === "message") {
      const messageData = currentNode.data?.message_data?.messages;

      if (messageData && messageData.length > 0) {
        for (const message of messageData) {
          await sendMessage(recipient, message,currentNode?.chatbotId,1 );
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
              recipient: recipient, // Matches the recipient
              chatbotId: currentNode.chatbotId,    // Matches the chatbotId
            },
          });
          

          if (!conversation) {
            throw new Error("Conversation not found");
          }
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              lastNodeId: currentNode.id,
              currentNodeId: currentNode.id + 1,
            },
          });
          await processNode(nextNodeId, nodes, edges, recipient);
        }
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
            where: { name: selectedTemplate },
          });

    
          let templateId = dbTemplate?.id ||1;
        // Call the sendTemplate function
        await sendTemplate(recipient, selectedTemplate, currentNode.chatbotId,dbTemplate);}
    
        // Find and process the outgoing edge on success (handle "source_1")
        const nextEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_1"
        );
        if (nextEdge) {
          const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node: ${nextNode.id}`);
            await processNode(nextNode.nodeId, nodes, edges, recipient);
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
            await processNode(errorNode.nodeId, nodes, edges, recipient);
          }
        }
      }
      return; // Stop further processing for this node.
    }    

    if (currentNode.type === "buttons") {
      const buttonData = currentNode.data?.buttons_data;
      if (buttonData) {
        const buttons = buttonData.buttons.map(
          (button: any, index: number) => ({
            type: "reply",
            reply: {
              id: `${index}_node_${currentNode.id}`,
              title: button.button,
            },
          })
        );
    
        const buttonMessage = {
          text:
            convertHtmlToWhatsAppText(buttonData.bodyText) ||
            "Please select an option:",
          buttons: buttons,
          header: buttonData?.headerText,
          footer: buttonData?.footerText,
          chatId: currentNode?.chatbotId,
          saveAnswerVariable: buttonData?.saveAnswerVariable,
        };
    
        try {
          // Send button message
          await sendMessageWithButtons(recipient, buttonMessage);
    
          // Update the Variable table after successful message sending
          if (buttonData?.saveAnswerVariable) {
            const variableName = buttonData.saveAnswerVariable.startsWith("@")
              ? buttonData.saveAnswerVariable.slice(1)
              : buttonData.saveAnswerVariable;
    
            // Find the conversation using recipient and chatId
            const conversation = await prisma.conversation.findFirst({
              where: {
                recipient: recipient,
                chatbotId: currentNode?.chatbotId,
              },
            });
    
            if (conversation) {
              // Check if the variable already exists
              const existingVariable = await prisma.variable.findFirst({
                where: {
                  name: variableName,
                  chatbotId: currentNode.chatId,
                  conversationId: conversation.id,
                },
              });
    
              if (existingVariable) {
                // Update the existing variable
                await prisma.variable.update({
                  where: { id: existingVariable.id },
                  data: { updatedAt: new Date() }, // Update timestamp
                });
              } else {
                // Create a new variable
                await prisma.variable.create({
                  data: {
                    name: variableName,
                    chatbotId: currentNode.chatId,
                    conversationId: conversation.id,
                  },
                });
              }
    
              console.log(
                `Variable "${variableName}" saved for conversation ID ${conversation.id} and chatbot ID ${currentNode.chatbotId}.`
              );
            } else {
              console.warn(
                `No conversation found for recipient ${recipient} and chatbot ID ${currentNode.chatbotId}.`
              );
            }
          }
        } catch (error) {
          console.error(
            "Error sending button message or updating variable table:",
            error
          );
        }
      }
    }
    
    if (currentNode.type === "list") {
      const listData = currentNode.data?.list_data;
      if (listData) {
        const listMessage:ListMessage = {
          text: convertHtmlToWhatsAppText(listData.bodyText) || "Please select an option:",
          header: listData?.headerText,
          footer: listData?.footerText,
          buttonText: listData?.buttonText || "Options",
          sections: listData?.sections || [],
          saveAnswerVariable: listData?.saveAnswerVariable,
        };
    
        try {
          // Send list message
          await sendMessageWithList(recipient, listMessage, currentNode.id);
    
          // Update the Variable table after successful message sending
          if (listData?.saveAnswerVariable) {
            const variableName = listData.saveAnswerVariable.startsWith("@")
              ? listData.saveAnswerVariable.slice(1)
              : listData.saveAnswerVariable;
    
            // Find the conversation using recipient and chatId
            const conversation = await prisma.conversation.findFirst({
              where: {
                recipient: recipient,
                chatbotId: currentNode?.chatbotId,
              },
            });
    
            if (conversation) {
              // Check if the variable already exists
              const existingVariable = await prisma.variable.findFirst({
                where: {
                  name: variableName,
                  chatbotId: currentNode.chatbotId,
                  conversationId: conversation.id,
                },
              });
    
              if (existingVariable) {
                // Update the existing variable
                await prisma.variable.update({
                  where: { id: existingVariable.id },
                  data: { updatedAt: new Date() }, // Update timestamp
                });
              } else {
                // Create a new variable
                await prisma.variable.create({
                  data: {
                    name: variableName,
                    chatbotId: currentNode.chatbotId,
                    conversationId: conversation.id,
                  },
                });
              }
    
              console.log(
                `Variable "${variableName}" saved for conversation ID ${conversation.id} and chatbot ID ${currentNode.chatbotId}.`
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
          const { action, selectedSpreadsheet, updateInAndBy, referenceColumn, variables } = gsheetData;
    
          // Prepare the payload for the Google Sheets API
          const payload: any = {
            action,
            spreadsheetId: selectedSpreadsheet,
            updateInAndBy,
            referenceColumn,
            variables,
          };
    
          // Simulate or perform Google Sheet operation
          const googleSheetResult:boolean = await performGoogleSheetAction(payload, currentNode); // Define this function
          let nextEdge:any;
           if(googleSheetResult==true){
            nextEdge = edges.find(
              (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_1"
            );
      
           }
           else{
            nextEdge = edges.find(
              (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
            );
      
           }
         
          if (nextEdge) {
            const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
            if (nextNode) {
              console.log(`Transitioning to next node (source1): ${nextNode.id}`);
              await processNode(nextNode.nodeId,nodes, edges, recipient); // Call the same function for the next node
            }
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
              await processNode(errorNode,nodes, edges, recipient); // Call the same function for the next node
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
          const { conditions, logicOperator } = conditionData;
    
          // Function to evaluate a single condition
          const evaluateCondition = async (condition: any) => {
            let { variable, operator, value } = condition;
    
            // Resolve variables if they start with "@", otherwise keep them as is
            if (variable.startsWith("@")) {
              variable = await resolveVariables(variable, currentNode?.chatbotId);
            }
            if (value.startsWith("@")) {
              value = await resolveVariables(value, currentNode?.chatbotId);
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
              await processNode(nextNode.nodeId, nodes, edges, recipient);
            }
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
          where: { phoneNumber: recipient }, // Search by phoneNumber
          update: { subscribed: true }, // Update if found
          create: { 
            phoneNumber: recipient, 
            subscribed: true, 
            source: "WhatsApp", // Default value if new contact
          },
        });        
        
        console.log(`Contact ${recipient} subscription set to true.`);
        
        // Find the next edge using the "source_1" handle on success
        const nextEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id
        );
        
        if (nextEdge) {
          const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node (source1): ${nextNode.id}`);
            // Continue processing with the next node
            await processNode(nextNode.nodeId, nodes, edges, recipient);
          }
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
            await processNode(errorNode.nodeId, nodes, edges, recipient);
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
          where: { phoneNumber: recipient }, // Search by phoneNumber
          update: { subscribed: false }, // Update if found
          create: { 
            phoneNumber: recipient, 
            subscribed: true, 
            source: "WhatsApp", // Default value if new contact
          },
        });     
        
        console.log(`Contact ${recipient} subscription set to false.`);
        
        // Find the next edge using the "source_1" handle on success
        const nextEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id
        );
        
        if (nextEdge) {
          const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node (source1): ${nextNode.id}`);
            // Continue processing with the next node
            await processNode(nextNode.nodeId, nodes, edges, recipient);
          }
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
            await processNode(errorNode.nodeId, nodes, edges, recipient);
          }
        }
      }
      
      return; // Prevent further execution for this node.
    }

    if (currentNode.type === "triggerChatbot") {
      try {
        // Extract the chatbot data from the node
        const chatbotData = currentNode.data?.chatbot_data;
        if (!chatbotData || !chatbotData.selectedChatbot) {
          throw new Error("No chatbot data provided.");
        }
        const selectedChatbotName: string = chatbotData.selectedChatbot;
    
        // Find the chatbot record by name
        const chatbot = await prisma.chatbot.findFirst({
          where: { name: selectedChatbotName },
        });
    
        if (!chatbot) {
          throw new Error(`Chatbot with name "${selectedChatbotName}" not found.`);
        }
    
        // Now query the Keyword table to get a keyword for the chatbot.
        // Adjust the query if you need a specific keyword, here we simply take the first one.
        const keywordRecord = await prisma.keyword.findFirst({
          where: { chatbotId: chatbot.id },
        });
    
        if (!keywordRecord) {
          throw new Error(`No keyword found for chatbot with ID ${chatbot.id}.`);
        }
    
        const keywordValue = keywordRecord.value;
        console.log(`Sending keyword message: ${keywordValue}`);
    
        // Send the keyword's value as a message with plainText=true.
        await processChatFlow(chatbot?.id,recipient);
      } catch (error) {
        console.error("Error in triggerChatbot node:", error);
    
        // On error, route to the error branch using the "source_2" handle.
        const errorEdge = edges.find(
          (edge) =>
            edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
        );
    
        if (errorEdge) {
          const errorNode = nodes.find((node) => node.id === errorEdge.targetId);
          if (errorNode) {
            console.log(`Transitioning to error node: ${errorNode.id}`);
            await processNode(errorNode.nodeId, nodes, edges, recipient);
          }
        }
      }
    
      return; // Prevent further processing of this node.
    }

    if (currentNode.type === "setTags") {
      try {
        // Extract the selected tags from the node's data.
        const tagsData = currentNode.data?.tags_data;
        if (!tagsData || !tagsData.selectedTags || tagsData.selectedTags.length === 0) {
          throw new Error("No tags provided in the node data.");
        }
        const selectedTags: string[] = tagsData.selectedTags;
        
        // Update the Contact record by pushing the selected tags to the existing tags array.
        await prisma.contact.update({
          where: { phoneNumber: recipient },
          data: {
            tags: {
              push: selectedTags,
            },
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
            await processNode(nextNode.nodeId, nodes, edges, recipient);
          }
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
            await processNode(errorNode.nodeId, nodes, edges, recipient);
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
          chatId: currentNode.chatbotId,
          buttons: questionData.answerVariants?.map((variant: any, index: number) => ({
            id: `${index}_node_${currentNode.id}`,
            title: variant,
          })),
        };
    
        try {
          // Send question message
          console.log(`Sending question message:`, questionMessage);
          await sendQuestion(recipient, questionMessage, currentNode?.id);
    
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
              // Check if the variable already exists
              const existingVariable = await prisma.variable.findFirst({
                where: {
                  name: variableName,
                  chatbotId: currentNode.chatbotId,
                  conversationId: conversation.id,
                },
              });
    
              if (existingVariable) {
                // Update the existing variable
                await prisma.variable.update({
                  where: { id: existingVariable.id },
                  data: { updatedAt: new Date() }, // Update timestamp
                });
              } else {
                // Create a new variable
                await prisma.variable.create({
                  data: {
                    name: variableName,
                    chatbotId: currentNode.chatbotId,
                    conversationId: conversation.id,
                  },
                });
              }
    
              console.log(
                `Variable "${variableName}" saved for conversation ID ${conversation.id} and chatbot ID ${currentNode.chatbotId}.`
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
        // Ensure attribute data exists
        const attributeData = currentNode.data?.attribute_data;
        if (!attributeData || !Array.isArray(attributeData.attributes)) {
          throw new Error("No attribute data provided.");
        }
    
        // Retrieve the contact record using the recipient (e.g., phone number)
        const contactRecord = await prisma.contact.findUnique({
          where: { phoneNumber: recipient },
        });
        if (!contactRecord) {
          throw new Error(`Contact with phoneNumber ${recipient} not found.`);
        }
    
        // Use existing attributes or default to an empty object
        let existingAttributes: Record<string, any> = {};
        if (contactRecord.attributes && typeof contactRecord.attributes === "object") {
          existingAttributes = contactRecord.attributes;
        }
    
        // Iterate over each attribute, resolve variables if necessary, and update the object
        for (const attr of attributeData.attributes) {
          let { key, value } = attr;
          
          // If the key starts with '@', resolve it
          if (key.startsWith("@")) {
            key = await resolveVariables(key, currentNode?.chatbotId);
          }
          
          // If the value starts with '@', resolve it
          if (value.startsWith("@")) {
            value = await resolveVariables(value, currentNode?.chatbotId);
          }
          
          // Update (or add) the attribute key/value pair
          existingAttributes[key] = value;
        }
    
        // Update the contact's attributes field in the database
        await prisma.contact.update({
          where: { phoneNumber: recipient },
          data: { attributes: existingAttributes },
        });
        console.log(`Updated contact ${recipient} with attributes:`, existingAttributes);
    
        // Find the outgoing edge for success (sourceHandle "source_1")
        const nextEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id
        );
        if (nextEdge) {
          const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node: ${nextNode.id}`);
            await processNode(nextNode.nodeId, nodes, edges, recipient);
          }
        }
      } catch (error) {
        console.error("Error in updateAttribute node:", error);
    
        // On error, transition using the "source_2" outgoing edge
        const errorEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_2"
        );
        if (errorEdge) {
          const errorNode = nodes.find((node) => node.id === errorEdge.targetId);
          if (errorNode) {
            console.log(`Transitioning to error node: ${errorNode.id}`);
            await processNode(errorNode.nodeId, nodes, edges, recipient);
          }
        }
      }
      return; // Stop further execution for this node.
    }
    
    if (currentNode.type === "updateChatStatus") {
      try {
        const contactRecord = await prisma.contact.findUnique({
          where: { phoneNumber: recipient },
        });
        if (!contactRecord) {
          throw new Error(`Contact with phoneNumber ${recipient} not found.`);
        }
        await prisma.contact.update({
          where: { phoneNumber: recipient },
          data: {ticketStatus: currentNode.data?.chat_status_data.selectedStatus },
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
          where: { id: conversation.id },
          data: { chatStatus: selectedStatus },
        });
        console.log(
          `Updated conversation (ID: ${conversation.id}) with chatStatus: ${selectedStatus}`
        );
    
        // On success, route to the next node via the outgoing edge with handle "source_1"
        const nextEdge = edges.find(
          (edge) =>
            edge.sourceId === currentNode.id
        );
        if (nextEdge) {
          const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node: ${nextNode.id}`);
            await processNode(nextNode.nodeId, nodes, edges, recipient);
          }
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
            await processNode(errorNode.nodeId, nodes, edges, recipient);
          }
        }
      }
      return; // Prevent further processing for this node.
    }
    
    if (currentNode.type === "assignUser") {
      const assignedUserEmail = currentNode.data?.user_data?.selectedUser;
      const user = await prisma.user.findUnique({
        where: { email:assignedUserEmail },
      });
      if (user?.id) {
        try {
          // Update assigned user in the Contact model
          await prisma.contact.update({
            where: { phoneNumber: recipient }, // Assuming contact is identified by phoneNumber
            data: {
              userId: user.id,
            },
          });
    
          console.log(`Assigned user ${user.id} to contact ${recipient}`);
        } catch (error) {
          console.error(`Failed to assign user to contact ${recipient}:`, error);
        }
    
        // Proceed to the next node
        const outgoingEdge = edges.find((edge) => edge.sourceId === currentNode.id);
        if (outgoingEdge) {
          const nextNodeId = nodes.find((node) => node.id === outgoingEdge.targetId)?.nodeId;
          if (nextNodeId) {
            await processNode(nextNodeId, nodes, edges, recipient);
          }
        } else {
          console.warn(`No outgoing edge found for assignUser node ID: ${currentNode.id}`);
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
                  ? { defaultTeam: true } // Find the team with `defaultTeam: true`
                  : { name: teamName } // Find teams matching the given names
              ),
            },
            select: { id: true }, // Only fetch the IDs
          });
    
          const teamIds = teams.map((team) => ({ id: team.id }));
    
          if (teamIds.length > 0) {
            // Update assigned teams in the Contact model
            await prisma.contact.update({
              where: { phoneNumber: recipient }, // Assuming contact is identified by phoneNumber
              data: {
                assignedTeams: { set: teamIds }, // Assign multiple teams
              },
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
            await processNode(nextNodeId, nodes, edges, recipient);
          }
        } else {
          console.warn(`No outgoing edge found for assignTeam node ID: ${currentNode.id}`);
        }
      }
      return;
    }
    

    if (currentNode.type === "delay") {
      const delayData = currentNode.data?.delay_data;
      if (delayData) {
        const { minutes = 0, seconds = 0 } = delayData;
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
            await processNode(nextNodeId, nodes, edges, recipient); // Recursive call to process the next node
          }
        } else {
          console.warn(
            `No outgoing edge found for delay node ID: ${currentNode.id}`
          );
        }
      }
      return; // Ensure no further processing for the current node
    }
    
    if (currentNode.type === "webhook") {
      const webhookData = currentNode.data?.webhook_data;
    
      if (webhookData) {
        try {
          // Prepare headers
          const headers = webhookData.headers?.reduce((acc: Record<string, string>, header:any) => {
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
            (status:any) => status.value === responseStatus
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
                await processNode(nextNode.nodeId,nodes, edges, recipient); 
              } else {
                console.warn(`No next node found with nodeId: ${nextNodeId}`);
              }
            } else {
              console.warn(`No matching edge found for sourceHandle: ${sourceHandle}`);
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
  userId: number = 1,     // Default to 1 if not provided
  plainText?: boolean
) => {
  try {
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        selectedPhoneNumberId: true,
        selectedWabaId: true
      }
    });
    if (!userRecord || !userRecord.selectedPhoneNumberId || !userRecord.selectedWabaId) {
      throw new Error("User's selected contact details are not set.");
    }
    const url = `${metaWhatsAppAPI.baseURL}/${userRecord.selectedPhoneNumberId}/messages`;
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
            messageBody = await resolveVariables(messageBody, chatbotId);
          }

          payload.text = { body: plainText ? message.message : convertHtmlToWhatsAppText(messageBody) };
          break;
          // payload.type = "text";
          // payload.text = { body: plainText?message.message:convertHtmlToWhatsAppText(message.message) };
          break;
        case "image":
          payload.type = "image";
          payload.image = {
            link: message.message.url,
            caption: message.message.name || "",
          };
          messageBody = `Image: ${message.message.name} (${message.message.url})`;
          break;
        case "audio":
          payload.type = "audio";
          payload.audio = { link: message.message.url };
          messageBody = `Audio: ${message.message.url}`;
          break;
        case "video":
          payload.type = "video";
          payload.video = {
            link: message.message.url,
            caption: message.message.name || "",
          };
          messageBody = `Video: ${message.message.name} (${message.message.url})`;
          break;
        case "document":
          payload.type = "document";
          payload.document = {
            link: message.message.url,
            caption: message.message.name || "",
          };
          messageBody = `Document: ${message.message.name} (${message.message.url})`;
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
    await storeMessage({ recipient, chatbotId, messageType: message.type, text: messageBody });
  } catch (error) {
    console.error("Error sending message:", error);
  }
};

export const sendTemplate = async (
  recipient: string,
  selectedTemplate: string,
  chatbotId: number,
  templateDetails: any
) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: recipient,
      biz_opaque_callback_data: `chatId=${chatbotId}`,
      type: "template",
      template: {
        name: selectedTemplate,
        language: { code: "en_US" }, // Set your default language or make it dynamic
      },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    await storeMessage({ recipient, chatbotId, messageType: "template", text: `Template: ${selectedTemplate}`,templateDetails:templateDetails });
   
  } catch (error) {
    console.error("Error sending template message:", error);
  }
};

export const sendMessageWithButtons = async (
  recipient: string,
  buttonMessage: any
) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
    const headerText = buttonMessage.header
    ? await resolveVariables(buttonMessage.header, buttonMessage.chatId)
    : undefined;

  const bodyText = await resolveVariables(buttonMessage.text, buttonMessage.chatId);
  const buttonOptions = buttonMessage.buttons.map((btn: any) => ({
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
          header: headerText ? { type: "text", text: headerText } : undefined,
          body: { text: convertHtmlToWhatsAppText(bodyText) },
          footer: buttonMessage.footer
          ? { text: buttonMessage.footer }
          : undefined,
          action: { buttons: buttonMessage.buttons },
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
    await storeMessage({
      recipient,
      chatbotId: buttonMessage.chatId,
      messageType: "button",
      text: bodyText,
      buttonOptions,
    });
  } catch (error) {
    console.error("Error sending button message:", error);
  }
};

export const sendMessageWithList = async (recipient: string, listMessage: ListMessage,nodeId:number) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
    const listItems = listMessage.sections.flatMap((section: any, sectionIndex: number) =>
      section.rows.map((row: any, rowIndex: number) => ({
        id: `source_${sectionIndex}_${rowIndex}_node_${nodeId}`,
        title: row,
        description: "row demo description",
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
              description: "row demo description",
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
      chatbotId: nodeId,
      messageType: "list",
      text: listMessage.text,
      listItems,
    });
  } catch (error) {
    console.error("Error sending list message:", error);
  }
};

export const sendQuestion = async (recipient: string, questionMessage: any, currentNodeId:number) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;

    // Validate options for the question
    const validOptions = questionMessage.buttons.filter(
      (option: any) => option.id && option.title
    );

    
    if (validOptions.length === 0) {
      throw new Error("No valid options provided for the question.");
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        recipient: recipient, // Matches the recipient
        chatbotId: questionMessage.chatId,    // Matches the chatbotId
      },
    });
    
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    
    await prisma.conversation.update({
      where: { id: conversation.id }, // Use the conversation's ID
      data: {
        answeringQuestion:true,
        currentNodeId: currentNodeId,
      },
    });
    

    const payload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: convertHtmlToWhatsAppText(questionMessage.text) },
        action: {
          buttons: validOptions.map((option: any) => ({
            type: "reply",
            reply: { id: option.id, title: option.title },
          })),
        },
      },
      biz_opaque_callback_data: `chatId=${questionMessage.chatId}`
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    await storeMessage({
      recipient,
      chatbotId: questionMessage.chatId,
      messageType: "question",
      text: questionMessage.text,
    });
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
  chatbotId?: number;
  messageType: string;
  text?: string;
  status?: MessageStatus;
  buttonOptions?: { id: string; title: string }[]; // Store button options as JSON
  listItems?: { id: string; title: string; description?: string }[]; // Store list items as JSON
  templateDetails?:any;
}) => {
  try {
    // Attempt to find an existing contact by phone number
    let contact = await prisma.contact.findUnique({
      where: { phoneNumber: recipient },
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
            create: { recipient, chatbotId },
          },
        },
        include: { conversations: true }, // Include nested conversation(s)
      });
      contact = newContact;
      // Retrieve the nested conversation that was just created
      conversation = newContact.conversations[0];
      console.log("✅ New contact and conversation created:", contact, conversation);
    } else {
      // If the contact exists, try to find an existing conversation linked to it
      conversation = await prisma.conversation.findFirst({
        where: { recipient, contactId: contact.id },
        orderBy: { updatedAt: "desc" },
      });
      if (!conversation) {
        // Create a new conversation if one isn't found
        conversation = await prisma.conversation.create({
          data: { recipient, contactId: contact.id, chatbotId },
        });
        console.log("✅ New conversation created:", conversation);
      }
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
  if(statuses) await processBroadcastStatus(statuses);

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
  
  if (!isAllowedSender(recipient)) {
    return; // Ignore and exit
  }
  
  // Emit socket event for new message
  const processedMessage = await processWebhookMessage(
    recipient,
    message,
    agentPhoneNumber
  );
  io.emit("newMessage", { recipient, message: processedMessage });

  // Get or create conversation
  const conversation = await getOrCreateConversation(recipient, message);
  if (!conversation) return;

  // Get chatbot data
  const chatbotData = await getChatbotData(conversation);
  if (!chatbotData) return;

  // Process the message based on its type
  await processMessageByType(message, recipient, conversation, chatbotData);
};

export const isAllowedSender = (recipient: string): boolean => {
  const allowedTestNumbers = process.env.ALLOWED_TEST_NUMBERS
    ? process.env.ALLOWED_TEST_NUMBERS.split(",").map((num) => num.trim())
    : [];
  
  return allowedTestNumbers.includes(recipient);
};

export const getOrCreateConversation = async (recipient: string, message: any): Promise<any | null> => {
  let conversation = await prisma.conversation.findFirst({
    where: { recipient },
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
  
  const keyword = await prisma.keyword.findFirst({
    where: {
      value: {
        contains: text,
        mode: "insensitive",
      },
    },
    include: { chatbot: true },
  });

  if (keyword?.chatbot) {
    console.log(`Keyword matched. Using chatbot ID: ${keyword.chatbot.id}`);
    return keyword.chatbot.id;
  }
  
  return null;
};

export const getChatbotData = async (conversation: any) => {
  if (!conversation || !conversation.chatbotId) return null;
  
  const chatbotData = await prisma.chatbot.findUnique({
    where: { id: conversation.chatbotId },
    include: { nodes: true, edges: true },
  });

  if (!chatbotData) {
    console.warn(`Chatbot with ID ${conversation.chatbotId} not found.`);
    return null;
  }
  
  return chatbotData;
};

export const processMessageByType = async (message: any, recipient: string, conversation: any, chatbotData: any) => {
  if (message?.interactive?.button_reply) {
    await processButtonReply(message, recipient, chatbotData);
  } else if (message?.interactive?.list_reply) {
    await processListReply(message, recipient, chatbotData);
  } else if (conversation.answeringQuestion) {
    await processTextQuestion(message, recipient, conversation, chatbotData);
  } else if (message?.text?.body) {
    await processKeywordMessage(message.text.body.toLowerCase(), recipient);
  }
};

export const processButtonReply = async (message: any, recipient: string, chatbotData: any) => {
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
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient);
  }
};

export const saveButtonVariableIfNeeded = async (currentNode: any, message: any, recipient: string) => {
  if (!currentNode?.data?.buttons_data?.saveAnswerVariable) return;
  
  const variableName = currentNode.data.buttons_data.saveAnswerVariable.startsWith("@")
    ? currentNode.data.buttons_data.saveAnswerVariable.slice(1)
    : currentNode.data.buttons_data.saveAnswerVariable;

  // Find the conversation
  const conversation = await prisma.conversation.findFirst({
    where: { recipient, chatbotId: currentNode.chatbotId || currentNode.chatId },
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
      where: { id: existingVariable.id },
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

export const processListReply = async (message: any, recipient: string, chatbotData: any) => {
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
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient);
  }
};

export const saveListVariableIfNeeded = async (currentNode: any, message: any, recipient: string) => {
  if (!currentNode?.data?.list_data?.saveAnswerVariable) return;
  
  const variableName = currentNode.data.list_data.saveAnswerVariable.startsWith("@")
    ? currentNode.data.list_data.saveAnswerVariable.slice(1)
    : currentNode.data.list_data.saveAnswerVariable;

  // Find the conversation
  const conversation = await prisma.conversation.findFirst({
    where: { recipient, chatbotId: currentNode.chatbotId || currentNode.chatId },
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
      where: { id: existingVariable.id },
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

export const processTextQuestion = async (message: any, recipient: string, conversation: any, chatbotData: any) => {
  const currentNode = await prisma.node.findFirst({
    where: { id: conversation.currentNodeId },
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
    await handleValidResponse(conversation, currentNode, text, recipient, chatbotData);
  } else {
    await handleInvalidResponse(conversation, failureCount, validationFailureExitCount, validation, recipient);
  }
};

export const handleValidResponse = async (conversation: any, currentNode: any, text: string, recipient: string, chatbotData: any) => {
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      answeringQuestion: false,
      validationFailureCount: 0,
    },
  });

  await saveTextVariable(currentNode, text, conversation);

  console.log("Text response is valid. Proceeding to the next node...");
  const nextNodeId = getNextNodeIdFromQuestion(chatbotData, null, currentNode.id);
  if (nextNodeId) {
    await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient);
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
      where: { id: existingVariable.id },
      data: { value: text },
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

export const handleInvalidResponse = async (conversation: any, failureCount: number, validationFailureExitCount: number, validation: any, recipient: string) => {
  // Increment failure count
  failureCount += 1;

  if (failureCount >= validationFailureExitCount) {
    // End the chat flow after exceeding failure limit
    await prisma.conversation.update({
      where: { id: conversation.id },
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
      true
    );

    console.warn("Chatflow ended due to repeated invalid responses.");
  } else {
    // Update failure count and send error message
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { validationFailureCount: failureCount },
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
      true
    );
  }
};

export const processKeywordMessage = async (text: string, recipient: string) => {
  const keyword = await prisma.keyword.findFirst({
    where: {
      value: {
        contains: text,
        mode: "insensitive",
      },
    },
    include: { chatbot: true },
  });

  if (keyword?.chatbot) {
    const chatbotId = keyword.chatbot.id;
    await prisma.conversation.update({
      where: { id: (await prisma.conversation.findFirst({ where: { recipient } }))?.id },
      data: { answeringQuestion: false },
    });
    await processChatFlow(chatbotId, recipient);
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
