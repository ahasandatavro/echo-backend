import { prisma } from "../../models/prismaClient";
import axios from "axios";
import { metaWhatsAppAPI } from "../../config/metaConfig";
import { convertHtmlToWhatsAppText } from "../../helpers/index";
import { resolveVariables } from "../../helpers/validation";
import { ListMessage } from "../../interphases";
import { performGoogleSheetAction } from "../../subProcessors/webhook";
export const processChatFlow = async (chatbotId: number, recipient: string) => {
  try {
    const chatbotData = await prisma.chatbot.findUnique({
      where: { id: chatbotId },
      include: { nodes: true, edges: true },
    });
  
    if (chatbotData) {
      const startNode = chatbotData.nodes.find((node) => node.type === "start");
      if (!startNode) {
        await sendMessage(recipient, "Chatbot start node not configured.",chatbotData?.id);
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
          await sendMessage(recipient, message,currentNode?.chatId );
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
              chatbotId: currentNode.chatId,    // Matches the chatbotId
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
    
        // Call the sendTemplate function
        await sendTemplate(recipient, selectedTemplate, chatbotId);
    
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
          chatId: currentNode?.chatId,
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
                chatbotId: currentNode?.chatId,
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
                `Variable "${variableName}" saved for conversation ID ${conversation.id} and chatbot ID ${currentNode.chatId}.`
              );
            } else {
              console.warn(
                `No conversation found for recipient ${recipient} and chatbot ID ${currentNode.chatId}.`
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
                chatbotId: currentNode?.chatId,
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
                `Variable "${variableName}" saved for conversation ID ${conversation.id} and chatbot ID ${currentNode.chatId}.`
              );
            } else {
              console.warn(
                `No conversation found for recipient ${recipient} and chatbot ID ${currentNode.chatId}.`
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

    if (currentNode.type === "subscribe") {
      try {
        // Attempt to update the contact with the given recipient
        // Adjust the `where` clause based on how you identify your contact (e.g., phoneNumber, email, etc.)
        const updatedContact = await prisma.contact.update({
          where: { phoneNumber: recipient },
          data: { subscribed: true },
        });
        
        console.log(`Contact ${recipient} subscription set to true.`);
        
        // Find the next edge using the "source_1" handle on success
        const nextEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_1"
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
        const updatedContact = await prisma.contact.update({
          where: { phoneNumber: recipient },
          data: { subscribed: false },
        });
        
        console.log(`Contact ${recipient} subscription set to false.`);
        
        // Find the next edge using the "source_1" handle on success
        const nextEdge = edges.find(
          (edge) => edge.sourceId === currentNode.id && edge.sourceHandle === "source_1"
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
        await sendMessage(recipient, keywordValue, chatbot.id, true);
    
        // Find the next edge using the "source_1" handle (success branch)
        const nextEdge = edges.find(
          (edge) =>
            edge.sourceId === currentNode.id && edge.sourceHandle === "source_1"
        );
    
        if (nextEdge) {
          const nextNode = nodes.find((node) => node.id === nextEdge.targetId);
          if (nextNode) {
            console.log(`Transitioning to next node: ${nextNode.id}`);
            // Continue processing with the next node.
            await processNode(nextNode.nodeId, nodes, edges, recipient);
          }
        }
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
            edge.sourceId === currentNode.id && edge.sourceHandle === "source_1"
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
          chatId: currentNode.chatId,
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
                chatbotId: currentNode?.chatId,
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
                `Variable "${variableName}" saved for conversation ID ${conversation.id} and chatbot ID ${currentNode.chatId}.`
              );
            } else {
              console.warn(
                `No conversation found for recipient ${recipient} and chatbot ID ${currentNode.chatId}.`
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
            edge.sourceId === currentNode.id && edge.sourceHandle === "source_1"
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

export const sendMessage = async (recipient: string, message: any, chatbotId:number,plainText?:boolean) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
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
          let messageBody = message.message;
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
          break;
        case "audio":
          payload.type = "audio";
          payload.audio = { link: message.message.url };
          break;
        case "video":
          payload.type = "video";
          payload.video = {
            link: message.message.url,
            caption: message.message.name || "",
          };
          break;
        case "document":
          payload.type = "document";
          payload.document = {
            link: message.message.url,
            caption: message.message.name || "",
          };
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
  } catch (error) {
    console.error("Error sending message:", error);
  }
};



export const sendTemplate = async (
  recipient: string,
  selectedTemplate: string,
  chatbotId: number
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
    console.log(`Template "${selectedTemplate}" sent to ${recipient}`);
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
  } catch (error) {
    console.error("Error sending button message:", error);
  }
};

export const sendMessageWithList = async (recipient: string, listMessage: ListMessage,nodeId:number) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;

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

    console.log("List message sent successfully.");
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

    console.log("Question message sent successfully.");
  } catch (error: any) {
    console.error(
      "Error sending question message:",
      error.response?.data || error.message
    );
  }
};
