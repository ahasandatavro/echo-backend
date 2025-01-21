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
          orderBy: {
            updatedAt: 'desc', // Orders by the most recently updated conversation
          },
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
              answeringQuestion: true,
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
         // await sendMessage(recipient, "Sorry, the associated chatbot is unavailable.");
          continue;
        }

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
        
          // Find the current node data
          const currentNode = chatbotData.nodes.find((node) => node.id === nodeId);
        
          if (currentNode?.data?.buttons_data?.saveAnswerVariable) {
            const variableName = currentNode?.data?.buttons_data?.saveAnswerVariable.startsWith("@")
              ? currentNode?.data?.buttons_data?.saveAnswerVariable.slice(1)
              : currentNode?.data?.buttons_data?.saveAnswerVariable;
        
            // Find the conversation
            const conversation = await prisma.conversation.findFirst({
              where: { recipient, chatbotId: currentNode.chatId },
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
                // Update the existing variable with the button reply title
                await prisma.variable.update({
                  where: { id: existingVariable.id },
                  data: { value: message.interactive.button_reply.title, nodeId:currentNode.id },
                });
              } else {
                // Create a new variable with the button reply title
                await prisma.variable.create({
                  data: {
                    name: variableName,
                    value: message.interactive.button_reply.title,
                    chatbotId: currentNode.chatId,
                    conversationId: conversation.id,
                  },
                });
              }
            }
          }
        
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
            const { validation, validationFailureExitCount = 3, saveAnswerVariable } =
              currentNode.data?.question_data || {};
          
            let failureCount = conversation.validationFailureCount;
          
            if (message?.type === "text" && text) {
              const isValid = validateUserResponse(text, validation);
          
              if (isValid) {
                await prisma.conversation.update({
                  where: { id: conversation.id },
                  data: { answeringQuestion: false, validationFailureCount: 0 },
                });
          
                // Save the response to the variable table if saveAnswerVariable exists
                if (saveAnswerVariable) {
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
                }
          
                console.log("Text response is valid. Proceeding to the next node...");
                const nextNodeId = getNextNodeIdFromQuestion(chatbotData, null, currentNode.id);
                if (nextNodeId) {
                  await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient);
                }
              } else {
                // Increment failure count
                failureCount += 1;
          
                if (failureCount >= validationFailureExitCount) {
                  // End the chat flow after exceeding failure limit
                  await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: { answeringQuestion: false, validationFailureCount: 0 },
                  });
          
                  await sendMessage(
                    recipient,
                    {
                      type: "text",
                      message: `You have given incorrect answers ${validationFailureExitCount} times. Closing chatflow.`,
                    },
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
                    true
                  );
                }
              }
            }
          }
          
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
            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { answeringQuestion: false },
            });
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

const getNextNodeIdFromQuestion = (
  chatbotData: any, // The chatbot data with nodes and edges
  buttonId: string | null, // Optional button ID for branching logic
  currentNodeId: number // The current node's ID
): string | null => {
  // Find the outgoing edge from the current node
  const outgoingEdge = chatbotData.edges.find((edge: any) => {
    // Match the sourceId with the current node's ID
    // Optionally check for buttonId in the sourceHandle for branching
    return edge.sourceId === currentNodeId && (!buttonId || edge.sourceHandle === buttonId);
  });

  if (!outgoingEdge) {
    console.warn(`No outgoing edge found for node ID: ${currentNodeId}`);
    return null;
  }

  // Find the target node ID from the edge
  const nextNode = chatbotData.nodes.find((node: any) => node.id === outgoingEdge.targetId);

  if (!nextNode) {
    console.warn(`No target node found for edge from node ID: ${currentNodeId}`);
    return null;
  }

  return nextNode.nodeId;
};
