import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';
import axios from 'axios';
export const createNode = async (req: Request, res: Response) => {
//   const { chatId, nodeId, data } = req.body;
//   try {
//     const node = await prisma.node.create({
//       data: { chatId, nodeId, data },
//     });
//     res.status(201).json(node);
//   } catch (error: unknown) {
//     if (error instanceof Error) {
//         res.status(500).send(error.message); // Safely access the message property
//     } else {
//         res.status(500).send('An unknown error occurred.');
//     }
// }

};

export const getNode = async (req: Request, res: Response) => {
//   const { chatId, id } = req.query;
//   try {
//     const nodes = await prisma.node.findMany({
//       where: chatId ? { chatId: String(chatId) } : { id: Number(id) },
//     });
//     res.status(200).json(nodes);
//   } catch (error: unknown) {
//     if (error instanceof Error) {
//         res.status(500).send(error.message); // Safely access the message property
//     } else {
//         res.status(500).send('An unknown error occurred.');
//     }
// }

};

export const deleteNodeByChatId = async (req: Request, res: Response) => {
//   const { chat_id } = req.params;
//   try {
//     const deleteResult = await prisma.node.deleteMany({
//       where: { chatId: chat_id },
//     });

//     if (deleteResult.count === 0) {
//       return res.status(404).send('No nodes found with the specified chat_id');
//     }
//     res.status(200).send(`Nodes with chat_id ${chat_id} deleted successfully.`);
//   } catch (error: unknown) {
//     if (error instanceof Error) {
//         res.status(500).send(error.message); // Safely access the message property
//     } else {
//         res.status(500).send('An unknown error occurred.');
//     }
// }

};

export const webhookVerification =async (req: Request, res: Response) => {
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
        const text = message?.text?.body.toLowerCase();

        if (recipient && text) {
          const match = chatbotResponses.find((response) => text.includes(response.keyword));
          const reply = match ? match.response : "I'm sorry, I didn't understand that.";
          await sendMessage(recipient, reply);
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.sendStatus(500);
  }
};
// Dummy data for chatbot interaction
const chatbotResponses = [
  { keyword: 'hello', response: 'Hi! How can I assist you today?' },
  { keyword: 'help', response: 'Sure! Please provide more details about your issue.' },
  { keyword: 'price', response: 'Our product prices start from $10. Let me know if you need a detailed catalog.' },
  { keyword: 'bye', response: 'Goodbye! Have a great day!' }
];

// Meta WhatsApp API Configuration
const metaWhatsAppAPI = {
  baseURL: 'https://graph.facebook.com/v15.0',
  phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
  accessToken: 'YOUR_ACCESS_TOKEN',
};

// Function to send a message using WhatsApp API
const sendMessage = async (recipient: string, message: string) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: recipient,
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error sending message:', error);
    throw new Error('Failed to send message');
  }
};
export const handleIncomingMessage=async (req: Request, res: Response) =>{
  const VERIFY_TOKEN = 'YOUR_VERIFY_TOKEN';

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

export const createChatFlow = async (req: Request, res: Response) => {
  const { chatBotName, nodes, edges } = req.body;

  try {
    const chatbot = await prisma.chatbot.create({
      data: {
        name: chatBotName,
        description: "Generated flow",
        status: "ACTIVE",
      },
    });

    const createdNodes = await prisma.$transaction(
      nodes.map((node: any) =>
        prisma.node.create({
          data: {
            chatId: chatbot.id,
            nodeId: node.id,
            type: node.type,
            data: node.data,
            positionX: node.position.x,
            positionY: node.position.y,
          },
        })
      )
    );

    const createdEdges = await prisma.$transaction(
      edges.map((edge: any) =>
        prisma.edge.create({
          data: {
            chatId: chatbot.id,
            sourceId: createdNodes.find((n) => n.nodeId === edge.source)?.id,
            targetId: createdNodes.find((n) => n.nodeId === edge.target)?.id,
          },
        })
      )
    );

    res.status(201).json({
      message: 'Chat flow created successfully',
      chatbot,
      nodes: createdNodes,
      edges: createdEdges,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create chat flow' });
  }
};

// Fetch nodes by Chatbot ID
export const getNodesByChatId = async (req: Request, res: Response) => {
  const { chatId } = req.params;

  try {
    const nodes = await prisma.node.findMany({
      where: { chatId: parseInt(chatId) },
    });
    res.status(200).json(nodes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch nodes by chatId' });
  }
};

// Fetch nodes by Chatbot Name
export const getNodesByChatName = async (req: Request, res: Response) => {
  const { chatName } = req.params;

  try {
    const chatbot = await prisma.chatbot.findFirst({
      where: { name: chatName },
    });

    if (!chatbot) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }

    const nodes = await prisma.node.findMany({
      where: { chatId: chatbot.id },
    });
    res.status(200).json(nodes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch nodes by chatName' });
  }
};

// Update a specific node
export const updateNode = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data, position } = req.body;

  try {
    const updatedNode = await prisma.node.update({
      where: { id: parseInt(id) },
      data: { data, positionX: position.x, positionY: position.y },
    });
    res.status(200).json(updatedNode);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update node' });
  }
};

// Delete a specific node
export const deleteNode = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await prisma.node.delete({
      where: { id: parseInt(id) },
    });
    res.status(200).json({ message: 'Node deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete node' });
  }
};

export const getPaginatedChatbots = async (req:Request, res:Response) => {
  try {
    // Extract and cast query parameters
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;

    // Calculate the offset
    const offset = (page - 1) * limit;

    // Fetch chatbots with pagination
    const chatbots = await prisma.chatbot.findMany({
      skip: offset,
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });

    // Get total count for pagination metadata
    const total = await prisma.chatbot.count();

    res.status(200).json({
      chatbots,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Error fetching chatbots:', error);
    res.status(500).json({ message: 'Failed to fetch chatbots' });
  }
};