// @ts-nocheck
import { Request, Response } from "express";
import {
  processChatFlow,
  processNode,
  sendMessage,
  sendMessageWithButtons,
} from "../processors/webhook/webhookProcessor";
import { prisma } from "../models/prismaClient";

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

// Main Webhook Handler
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

        // Handle button reply
        if (message?.interactive?.button_reply) {
          const parts = message?.interactive?.button_reply.id.split("_node_");
          const buttonId = "source_" + parts[0]; // "source_1"
          const nodeId = parseInt(parts[1]);
          console.log(`User clicked button: ${buttonId}`);

          const conversation = await prisma.conversation.findFirst({
            where: { recipient },
          });

          if (conversation?.chatbotId) {
            const chatbotData = await prisma.chatbot.findUnique({
              where: { id: conversation.chatbotId },
              include: { nodes: true, edges: true },
            });

            if (chatbotData) {
              const selectedEdge = chatbotData.edges.find(
                (edge) =>
                  edge.sourceHandle === buttonId && edge.sourceId === nodeId
              );
              if (!selectedEdge) {
                console.warn("No matching edge found for:", {
                  buttonId,
                  nodeId,
                });
              } else {
                console.log("Found Edge:", selectedEdge);
              }
              const potentialMatches = chatbotData.edges.filter(
                (edge) => edge.sourceId === nodeId
              );
              console.log("Potential Matches for Node ID:", potentialMatches);

              const exactMatches = potentialMatches.filter(
                (edge) => edge.sourceHandle === buttonId
              );
              console.log("Exact Matches:", exactMatches);

              if (exactMatches.length === 0) {
                console.warn(
                  "No exact matches found. Double-check `sourceHandle` or `source` values."
                );
              }
              const nextNodeId = selectedEdge
                ? chatbotData.nodes.find(
                    (node) => node.id === selectedEdge.targetId
                  )?.nodeId
                : null;

              if (nextNodeId) {
                await processNode(
                  nextNodeId,
                  chatbotData.nodes,
                  chatbotData.edges,
                  recipient
                );
              }
            }
          }
        }

        // Handle text messages
        const text = message?.text?.body.toLowerCase();
        if (recipient && text) {
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
