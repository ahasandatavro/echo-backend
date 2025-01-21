import { prisma } from "../../models/prismaClient";
import axios from "axios";
import { metaWhatsAppAPI } from "../../config/metaConfig";
import { convertHtmlToWhatsAppText } from "../../helpers/index";
import { ListMessage,Section,Row } from "../../interphases";
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
          payload.text = { body: plainText?message.message:convertHtmlToWhatsAppText(message.message) };
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

export const sendMessageWithButtons = async (
  recipient: string,
  buttonMessage: any
) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to: recipient,
        type: "interactive",
        interactive: {
          type: "button",
          header: buttonMessage.header
          ? { type: "text", text: buttonMessage.header }
          : undefined,
          body: { text: convertHtmlToWhatsAppText(buttonMessage.text) },
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
