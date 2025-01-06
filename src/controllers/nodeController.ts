import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';
import axios from 'axios';
export const createNode = async (req: Request, res: Response) => {
  const { chatId, nodeId, data } = req.body;
  try {
    const node = await prisma.node.create({
      data: { chatId, nodeId, data },
    });
    res.status(201).json(node);
  } catch (error: unknown) {
    if (error instanceof Error) {
        res.status(500).send(error.message); // Safely access the message property
    } else {
        res.status(500).send('An unknown error occurred.');
    }
}

};

export const getNode = async (req: Request, res: Response) => {
  const { chatId, id } = req.query;
  try {
    const nodes = await prisma.node.findMany({
      where: chatId ? { chatId: String(chatId) } : { id: Number(id) },
    });
    res.status(200).json(nodes);
  } catch (error: unknown) {
    if (error instanceof Error) {
        res.status(500).send(error.message); // Safely access the message property
    } else {
        res.status(500).send('An unknown error occurred.');
    }
}

};

export const deleteNodeByChatId = async (req: Request, res: Response) => {
  const { chat_id } = req.params;
  try {
    const deleteResult = await prisma.node.deleteMany({
      where: { chatId: chat_id },
    });

    if (deleteResult.count === 0) {
      return res.status(404).send('No nodes found with the specified chat_id');
    }
    res.status(200).send(`Nodes with chat_id ${chat_id} deleted successfully.`);
  } catch (error: unknown) {
    if (error instanceof Error) {
        res.status(500).send(error.message); // Safely access the message property
    } else {
        res.status(500).send('An unknown error occurred.');
    }
}

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