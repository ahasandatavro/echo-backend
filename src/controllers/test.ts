// @ts-nocheck
import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';
import { metaWhatsAppAPI } from '../config/metaConfig';
import axios from 'axios';

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


const processNode = async (nodeId: string, nodes: any[], edges: any[], recipient: string) => {
  try {
    const currentNode = nodes.find((node) => node.nodeId === nodeId);

    if (!currentNode) {
      console.error(`Node with ID ${nodeId} not found in nodes array.`);
      return;
    }

    console.log(`Processing node:`, {
      nodeId: currentNode.nodeId,
      type: currentNode.type,
    });

    // Handle start node
    if (currentNode.type === 'start') {
      const outgoingEdge = edges.find((edge) => edge.sourceId === currentNode.id);
      if (!outgoingEdge) {
        console.warn(`No outgoing edge found for start node ID ${currentNode.id}`);
        return;
      }

      const nextNodeId = nodes.find((node) => node.id === outgoingEdge.targetId)?.nodeId;
      if (!nextNodeId) {
        console.warn(`No target node found for edge with source ID ${currentNode.id}`);
        return;
      }

      await processNode(nextNodeId, nodes, edges, recipient);
      return;
    }

    // Handle message nodes
    if (currentNode.type === 'message') {
      const messageData = currentNode.data?.message_data?.messages;

      if (messageData && messageData.length > 0) {
        for (const message of messageData) {
          console.log(`Sending message:`, message);
          await sendMessage(recipient, message);
        }
      }

      const outgoingEdge = edges.find((edge) => edge.sourceId === currentNode.id);
      if (!outgoingEdge) {
        console.warn(`No outgoing edge found for message node ID ${currentNode.id}`);
        return;
      }

      const nextNodeId = nodes.find((node) => node.id === outgoingEdge.targetId)?.nodeId;
      if (!nextNodeId) {
        console.warn(`No target node found for edge with source ID ${currentNode.id}`);
        return;
      }

      console.log(`Moving to next node: ${nextNodeId}`);
      await processNode(nextNodeId, nodes, edges, recipient);
      return;
    }

    // Handle button nodes
    if (currentNode.type === 'buttons') {
      const buttonData = currentNode.data?.buttons_data;
      if (buttonData) {
        const buttons = buttonData.buttons?.map((button, index) => ({
          type: 'reply',
          reply: { id: `source_${index}`, title: button.button },
        }));

        const buttonMessage = {
          text: buttonData.bodyText || 'Please select an option:',
          buttons,
          header: buttonData.headerText,
          footer: buttonData.footerText,
        };

        console.log(`Sending button message:`, buttonMessage);
        await sendMessageWithButtons(recipient, buttonMessage);
      }
      return; // Buttons wait for user interaction
    }

    // Handle list nodes
    if (currentNode.type === 'list') {
      const listData = currentNode.data?.list_data;
      if (listData) {
        const sections = listData.sections.map((section) => ({
          title: section.sectionTitle,
          rows: section.rows?.map((row) => ({ id: row, title: row })),
        }));

        const listMessage = {
          text: listData.bodyText || 'Please select an option:',
          sections,
          buttonText: listData.buttonText,
          header: listData.headerText,
          footer: listData.footerText,
        };

        console.log(`Sending list message:`, listMessage);
        await sendMessageWithList(recipient, listMessage);
      }
      return; // Lists wait for user interaction
    }

    // Handle question nodes
    if (currentNode.type === 'question') {
      const questionData = currentNode.data?.question_data;
      if (questionData) {
        const questionMessage = {
          text: questionData.questionText,
          options: questionData.answerVariants?.map((variant) => ({
            id: variant,
            title: variant,
          })),
        };

        console.log(`Sending question message:`, questionMessage);
        await sendQuestion(recipient, questionMessage);
      }
      return; // Questions wait for user interaction
    }

    console.warn(`Unhandled node type: ${currentNode.type}`);
  } catch (error) {
    console.error('Error in processNode:', error);
  }
};

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

const sendMessageWithButtons = async (recipient: string, buttonMessage: any) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;

    // Validate and filter buttons to ensure all have valid `id` and `title`
    const validButtons = buttonMessage.buttons.filter(
      (button: any) => button.reply?.id && button.reply?.title
    );

    if (validButtons.length === 0) {
      throw new Error('No valid buttons provided.');
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: buttonMessage.header ? { type: 'text', text: buttonMessage.header } : undefined,
        body: { text: buttonMessage.text },
        footer: buttonMessage.footer ? { text: buttonMessage.footer } : undefined,
        action: { buttons: validButtons },
      },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('Button message sent successfully.');
  } catch (error) {
    console.error('Error sending button message:', error.response?.data || error.message);
  }
};


const sendMessageWithList = async (recipient: string, listMessage: any) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'interactive',
      interactive: {
        type: 'list',
        header: listMessage.header ? { type: 'text', text: listMessage.header } : undefined,
        body: { text: listMessage.text },
        footer: listMessage.footer ? { text: listMessage.footer } : undefined,
        action: {
          button: listMessage.buttonText,
          sections: listMessage.sections.map((section: any) => ({
            title: section.title,
            rows: section.rows.map((row: any) => ({
              id: row.id,
              title: row.title,
              description: row.description || '',
            })),
          })),
        },
      },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error sending list message:', error);
  }
};

const sendQuestion = async (recipient: string, questionMessage: any) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;

    // Validate options for the question
    const validOptions = questionMessage.options.filter(
      (option: any) => option.id && option.title
    );

    if (validOptions.length === 0) {
      throw new Error('No valid options provided for the question.');
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: questionMessage.text },
        action: {
          buttons: validOptions.map((option: any) => ({
            type: 'reply',
            reply: { id: option.id, title: option.title },
          })),
        },
      },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('Question message sent successfully.');
  } catch (error) {
    console.error('Error sending question message:', error.response?.data || error.message);
  }
};



// Webhook Verification Logic
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

        if (message?.interactive?.button_reply) {
          const buttonId = message.interactive.button_reply.id;

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

        if (recipient && message?.text?.body) {
          const text = message.text.body.toLowerCase();

          const keyword = await prisma.keyword.findFirst({
            where: {
              value: {
                contains: text,
                mode: 'insensitive',
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
const processChatFlow = async (chatbotId: number, recipient: string) => {
  try {
    const chatbotData = await prisma.chatbot.findUnique({
      where: { id: chatbotId },
      include: { nodes: true, edges: true },
    });

    if (!chatbotData) {
      await sendMessage(recipient, { type: 'text', message: 'Chatbot flow not found.' });
      return;
    }

    const startNode = chatbotData.nodes.find((node) => node.type === 'start');
    if (!startNode) {
      await sendMessage(recipient, { type: 'text', message: 'Chatbot start node not configured.' });
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
