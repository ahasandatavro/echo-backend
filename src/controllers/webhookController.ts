
import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';
import axios from 'axios';

// Meta WhatsApp API Configuration
const metaWhatsAppAPI = {
  baseURL: process.env.META_BASE_URL,
  phoneNumberId: process.env.META_PHONE_NUMBER_ID,
  accessToken: process.env.META_ACCESS_TOKEN,
};

// Webhook Verification for WhatsApp
export const handleIncomingMessage = async (req: Request, res: Response) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
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
      return res.status(400).send('Invalid request');
    }

    for (const item of entry) {
      const changes = item.changes;

      if (!changes || !Array.isArray(changes)) continue;

      for (const change of changes) {
        const message = change.value?.messages?.[0];
        const recipient = message?.from;

        // Handle button reply
        if (message?.interactive?.button_reply) {
          const buttonId = message.interactive.button_reply.id;
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
                (edge) => edge.sourceHandle === buttonId
              );

              const nextNodeId = selectedEdge
                ? chatbotData.nodes.find((node) => node.id === selectedEdge.targetId)?.nodeId
                : null;

              if (nextNodeId) {
                await processNode(nextNodeId, chatbotData.nodes, chatbotData.edges, recipient);
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
    console.error('Webhook processing error:', error);
    res.sendStatus(500);
  }
};

// Process Chat Flow based on Chatbot ID
const processChatFlow = async (chatbotId: number, recipient: string) => {
  try {
    const chatbotData = await prisma.chatbot.findUnique({
      where: { id: chatbotId },
      include: { nodes: true, edges: true },
    });

    if (!chatbotData) {
      await sendMessage(recipient, 'Chatbot flow not found.');
      return;
    }

    const startNode = chatbotData.nodes.find((node) => node.type === 'start');
    if (!startNode) {
      await sendMessage(recipient, 'Chatbot start node not configured.');
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
    await processNode(startNode.nodeId, chatbotData.nodes, chatbotData.edges, recipient);
  } catch (error) {
    console.error('Error processing chatbot flow:', error);
  }
};

// Process a node based on its type
const processNode = async (nodeId: string, nodes: any[], edges: any[], recipient: string) => {
  try {
    const currentNode = nodes.find((node) => node.nodeId === nodeId);

    if (!currentNode) {
      console.error(`Node with ID ${nodeId} not found.`);
      return;
    }

    if (currentNode.type === 'start') {
      const outgoingEdge = edges.find((edge) => edge.sourceId === currentNode.id);
      if (outgoingEdge) {
        const nextNodeId = nodes.find((node) => node.id === outgoingEdge.targetId)?.nodeId;
        if (nextNodeId) {
          await processNode(nextNodeId, nodes, edges, recipient);
        }
      }
      return;
    }

    if (currentNode.type === 'message') {
      const messageData = currentNode.data?.message_data?.messages;

      if (messageData && messageData.length > 0) {
        for (const message of messageData) {
          await sendMessage(recipient, message);
        }
      }

      const outgoingEdge = edges.find((edge) => edge.sourceId === currentNode.id);
      if (outgoingEdge) {
        const nextNodeId = nodes.find((node) => node.id === outgoingEdge.targetId)?.nodeId;
        if (nextNodeId) {
          const conversation = await prisma.conversation.findFirst({
            where: { recipient },
          });
          
          if (!conversation) {
            throw new Error('Conversation not found');
          }
          await prisma.conversation.update({
            where:  { id: conversation.id },
            data: {
              lastNodeId: currentNode.id,
              currentNodeId: currentNode.id+1,
            },
          });
          await processNode(nextNodeId, nodes, edges, recipient);
        }
      }
    }

    if (currentNode.type === 'buttons') {
      const buttonData = currentNode.data?.buttons_data;
      if (buttonData) {
        const buttons = buttonData.buttons.map((button: any, index: number) => ({
          type: 'reply',
          reply: { id: `source_${index}`, title: button.button },
        }));

        const buttonMessage = {
          text: buttonData.bodyText || 'Please select an option:',
          buttons: buttons,
        };

        await sendMessageWithButtons(recipient, buttonMessage);
      }
    }
  } catch (error) {
    console.error('Error in processNode:', error);
  }
};

// Send a message
const sendMessage = async (recipient: string, message: any) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
    const payload: any = {
      messaging_product: 'whatsapp',
      to: recipient,
    };

   if (message) {
      // Handle different media types
      switch (message.type) {
        case 'text':
          payload.type = 'text';
          payload.text = { body: message.message };
          break;
        case 'image':
          payload.type = 'image';
          payload.image = { link: message.message.url, caption: message.message.name || '' };
          break;
        case 'audio':
          payload.type = 'audio';
          payload.audio = { link: message.message.url };
          break;
        case 'video':
          payload.type = 'video';
          payload.video = { link: message.message.url, caption: message.message.name || '' };
          break;
        case 'document':
          payload.type = 'document';
          payload.document = { link: message.message.url, caption: message.message.name || '' };
          break;
        default:
          console.error('Unsupported media type:', message.type);
          return;
      }
    }

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error sending message:', error);
  }
};

// Send a button message
const sendMessageWithButtons = async (recipient: string, buttonMessage: any) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: buttonMessage.text },
          action: { buttons: buttonMessage.buttons },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error sending button message:', error);
  }
};
