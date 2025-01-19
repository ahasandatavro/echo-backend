import { prisma } from "../../models/prismaClient";
import axios from "axios";
import { metaWhatsAppAPI } from "../../config/metaConfig";
import { convertHtmlToWhatsAppText } from "../../helpers/index";
export const processChatFlow = async (chatbotId: number, recipient: string) => {
  try {
    const chatbotData = await prisma.chatbot.findUnique({
      where: { id: chatbotId },
      include: { nodes: true, edges: true },
    });

    if (!chatbotData) {
      await sendMessage(recipient, "Chatbot flow not found.");
      return;
    }

    const startNode = chatbotData.nodes.find((node) => node.type === "start");
    if (!startNode) {
      await sendMessage(recipient, "Chatbot start node not configured.");
      return;
    }
    const existingConversation = await prisma.conversation.findFirst({
      where: { recipient },
    });
    if (existingConversation) {
      // Update the conversation with the new chatbot and start node
      await prisma.conversation.update({
        where: { id: existingConversation.id },
        data: {
          chatbotId,
          currentNodeId: startNode.id,
          lastNodeId: null, // Reset lastNodeId
        },
      });
    } else {
      // Create a new conversation entry
      await prisma.conversation.create({
        data: {
          recipient,
          chatbotId,
          currentNodeId: startNode.id,
        },
      });
    }
    await processNode(
      startNode.nodeId,
      chatbotData.nodes,
      chatbotData.edges,
      recipient
    );
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
          await sendMessage(recipient, message);
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
            where: { recipient },
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
        };

        await sendMessageWithButtons(recipient, buttonMessage);
      }
    }
    if (currentNode.type === "question") {
      const questionData = currentNode.data?.question_data;
      if (questionData) {
        const questionMessage = {
          text: convertHtmlToWhatsAppText(questionData.questionText),
          buttons: questionData.answerVariants?.map(
            (variant: any, index: number) => ({
              id: `${index}_node_${currentNode.id}`,
              title: variant,
            })
          ),
        };

        console.log(`Sending question message:`, questionMessage);
        await sendQuestion(recipient, questionMessage);
      }
      return; // Questions wait for user interaction
    }
    if (currentNode.type === "delay") {
      const delayData = currentNode.data?.delay_data;
      if (delayData) {
        const { minutes = 0, seconds = 0 } = delayData;
        const delayTime = (minutes * 60 + seconds) * 1000;
    
        console.log(`Delaying for ${minutes} minute(s) and ${seconds} second(s)...`);
        await new Promise((resolve) => setTimeout(resolve, delayTime));
        console.log("Delay completed. Processing the next node...");
    
        // Find the next node and process it
        const outgoingEdge = edges.find((edge) => edge.sourceId === currentNode.id);
        if (outgoingEdge) {
          const nextNodeId = nodes.find((node) => node.id === outgoingEdge.targetId)?.nodeId;
          if (nextNodeId) {
            await processNode(nextNodeId, nodes, edges, recipient); // Recursive call to process the next node
          }
        } else {
          console.warn(`No outgoing edge found for delay node ID: ${currentNode.id}`);
        }
      }
      return; // Ensure no further processing for the current node
    }
    
  } catch (error) {
    console.error("Error in processNode:", error);
  }
};

export const sendMessage = async (recipient: string, message: any) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
    const payload: any = {
      messaging_product: "whatsapp",
      to: recipient,
    };

    if (message) {
      // Handle different media types
      switch (message.type) {
        case "text":
          payload.type = "text";
          payload.text = { body: convertHtmlToWhatsAppText(message.message) };
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
          body: { text: convertHtmlToWhatsAppText(buttonMessage.text) },
          action: { buttons: buttonMessage.buttons },
        },
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

export const sendMessageWithList = async (
  recipient: string,
  listMessage: any
) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "interactive",
      interactive: {
        type: "list",
        header: listMessage.header
          ? { type: "text", text: listMessage.header }
          : undefined,
        body: { text: convertHtmlToWhatsAppText(listMessage.text) },
        footer: listMessage.footer ? { text: listMessage.footer } : undefined,
        action: {
          button: listMessage.buttonText,
          sections: listMessage.sections.map((section: any) => ({
            title: section.title,
            rows: section.rows.map((row: any) => ({
              id: row.id,
              title: row.title,
              description: row.description || "",
            })),
          })),
        },
      },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error sending list message:", error);
  }
};

export const sendQuestion = async (recipient: string, questionMessage: any) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;

    // Validate options for the question
    const validOptions = questionMessage.buttons.filter(
      (option: any) => option.id && option.title
    );

    if (validOptions.length === 0) {
      throw new Error("No valid options provided for the question.");
    }

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
