// @ts-nocheck
import { Request, Response } from "express";
import {
  processChatFlow,
  processNode,
  sendMessage,
  sendMessageWithButtons,
} from "../processors/webhook/webhookProcessor";
import { prisma } from "../models/prismaClient";
import { validateUserResponse } from "../helpers/validation";
// Webhook Verification for WhatsApp
export const handleIncomingMessage = async (req: Request, res: Response) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
};

export const webhookVerification = async (req: Request, res: Response) => {
  try {
    const { entry } = req.body;

    if (!entry || !Array.isArray(entry)) {
      return res.status(400).send("Invalid request");
    }

    for (const item of entry) {
      const changes = item.changes;

      if (!changes || !Array.isArray(changes)) continue;

      for (const change of changes) {
        const message = change.value?.messages?.[0];
        const recipient = message?.from;

        if (!recipient) {
         // console.error("Recipient not found in the message.");
          continue;
        }

        let conversation = await prisma.conversation.findFirst({
          where: { recipient },
        });

        const text = message?.text?.body?.toLowerCase();

        // Create or update conversation
        if (!conversation) {
          console.log("No conversation found for recipient. Attempting to create a new one...");

          let chatbotId: number | null = null;

          if (text) {
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
              chatbotId = keyword.chatbot.id;
              console.log(`Keyword matched. Using chatbot ID: ${chatbotId}`);
            }
          }
          if (!chatbotId) {
            console.warn("No keyword match found. Unable to associate a chatbot.");
            await sendMessage(recipient, "Sorry, no chatbot is available for your query.");
            continue;
          }

          conversation = await prisma.conversation.create({
            data: {
              recipient,
              chatbotId,
              answeringQuestion: false,
            },
          });

          console.log("New conversation created:", conversation);
        }

        const chatbotData = await prisma.chatbot.findUnique({
          where: { id: conversation.chatbotId },
          include: { nodes: true, edges: true },
        });

        if (!chatbotData) {
          console.warn(`Chatbot with ID ${conversation.chatbotId} not found.`);
          await sendMessage(recipient, "Sorry, the associated chatbot is unavailable.");
          continue;
        }

        // Handle button reply
        if (message?.interactive?.button_reply) {
          const parts = message?.interactive?.button_reply.id.split("_node_");
          const buttonId = "source_" + parts[0];
          const nodeId = parseInt(parts[1]);

          const selectedEdge = chatbotData.edges.find(
            (edge) =>
              edge.sourceHandle === buttonId && edge.sourceId === nodeId
          );

          const nextNodeId = selectedEdge
            ? chatbotData.nodes.find((node) => node.id === selectedEdge.targetId)?.nodeId
            : null;

          if (nextNodeId) {
            await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient);
          }
          continue;
        }

        // Handle text responses to questions
        if (conversation.answeringQuestion) {
          const currentNode = await prisma.node.findFirst({
            where: { id: conversation.currentNodeId },
          });
        
          if (currentNode?.type === "question") {
            const { validation } = currentNode.data?.question_data;
        
            if (message?.type === "text" && text) {
              // Validate text-based response
              const isValid = validateUserResponse(text, validation);
        
              if (isValid) {
                await prisma.conversation.update({
                  where: { id: conversation.id },
                  data: { answeringQuestion: false },
                });
        
                console.log("Text response is valid. Proceeding to the next node...");
                // Add your next node logic here
              } else {
                console.warn("Text response is invalid.");
                await sendMessage(
                  recipient,
                  { type: "text", message: validation?.errorMessage || "Invalid response." },
                  true
                );
              }
            } else if (["image", "video", "audio", "document"].includes(message?.type)) {
              // Validate media response
              const mediaId = message[message.type]?.id; // e.g., message.image.id, message.video.id
              const isValid = await validateUserResponse(mediaId, validation, message.type);
        
              if (isValid) {
                await prisma.conversation.update({
                  where: { id: conversation.id },
                  data: { answeringQuestion: false },
                });
        
                console.log(`${message.type} response is valid. Proceeding to the next node...`);
                // Add your next node logic here
              } else {
                console.warn(`${message.type} response is invalid.`);
                await sendMessage(
                  recipient,
                  { type: "text", message: validation?.errorMessage || "Invalid response type. Please provide a valid response." },
                  true
                );
              }
            } else {
              console.warn("Unsupported response type or missing required fields.");
              await sendMessage(
                recipient,
                { type: "text", message: validation?.errorMessage || "Invalid response." },
                true
              );
            }
          }
        
          continue;
        }
        
        // Handle keyword-based text messages
        if (text) {
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
            await processChatFlow(chatbotId, recipient);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.sendStatus(500);
  }
};
