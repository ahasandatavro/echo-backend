// import { Request, Response } from 'express';
// //import { prisma } from '../models/prismaClient';
// import axios from 'axios';

// export const webhookVerification =async (req: Request, res: Response) => {
//     try {
//       const { entry } = req.body;
  
//       if (!entry || !Array.isArray(entry)) {
//         return res.status(400).send('Invalid request');
//       }
  
//       for (const item of entry) {
//         const changes = item.changes;
  
//         if (!changes || !Array.isArray(changes)) continue;
  
//         for (const change of changes) {
//           const message = change.value?.messages?.[0];
//           const recipient = message?.from;
//           const text = message?.text?.body.toLowerCase();
  
//           if (recipient && text) {
//             const match = chatbotResponses.find((response) => text.includes(response.keyword));
//             const reply = match ? match.response : "I'm sorry, I didn't understand that.";
//             await sendMessage(recipient, reply);
//           }
//         }
//       }
  
//       res.sendStatus(200);
//     } catch (error) {
//       console.error('Webhook processing error:', error);
//       res.sendStatus(500);
//     }
//   };
//   // Dummy data for chatbot interaction
//   const chatbotResponses = [
//     { keyword: 'hello', response: 'Hi! How can I assist you today?' },
//     { keyword: 'help', response: 'Sure! Please provide more details about your issue.' },
//     { keyword: 'price', response: 'Our product prices start from $10. Let me know if you need a detailed catalog.' },
//     { keyword: 'bye', response: 'Goodbye! Have a great day!' }
//   ];
  
//   // Meta WhatsApp API Configuration
//   const metaWhatsAppAPI = {
//     baseURL: process.env.META_BASE_URL,
//     phoneNumberId: process.env.META_PHONE_NUMBER_ID,
//     accessToken: process.env.META_ACCESS_TOKEN,
//   };
  
//   // Function to send a message using WhatsApp API
//   const sendMessage = async (recipient: string, message: string) => {
//     try {
//       const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
//       const response = await axios.post(
//         url,
//         {
//           messaging_product: 'whatsapp',
//           to: recipient,
//           text: { body: message },
//         },
//         {
//           headers: {
//             Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );
//       return response.data;
//     } catch (error) {
//       console.error('Error sending message:', error);
//       throw new Error('Failed to send message');
//     }
//   };
//   export const handleIncomingMessage=async (req: Request, res: Response) =>{
//     const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
  
//     const mode = req.query['hub.mode'];
//     const token = req.query['hub.verify_token'];
//     const challenge = req.query['hub.challenge'];
  
//     if (mode && token === VERIFY_TOKEN) {
//       console.log('Webhook verified');
//       res.status(200).send(challenge);
//     } else {
//       res.sendStatus(403);
//     }
//   }
import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient'; // Import Prisma client
import axios from 'axios';

// Meta WhatsApp API Configuration
const metaWhatsAppAPI = {
  baseURL: process.env.META_BASE_URL,
  phoneNumberId: process.env.META_PHONE_NUMBER_ID,
  accessToken: process.env.META_ACCESS_TOKEN,
};

// Webhook Verification for WhatsApp
export const handleIncomingMessage = async (req: Request, res: Response) => {
  console.log("entered");
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
        const text = message?.text?.body.toLowerCase();

        if (recipient && text) {
          // Fetch matching keyword and chatbot
          const keyword = await prisma.keyword.findFirst({
            where: {
              value: {
                contains: text,
              },
            },
            include: {
              chatbot: true, // Include the chatbot
            },
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
    // Fetch chatbot's nodes and edges
    const chatbotData = await prisma.chatbot.findUnique({
      where: { id: chatbotId },
      include: {
        nodes: {
          include: { edgesOut: true },
        },
        edges: true,
      },
    });

    if (!chatbotData) {
      await sendMessage(recipient, "Chatbot flow not found.");
      return;
    }

    // Find the starting node
    const startNode = chatbotData.nodes.find((node) => node.type === "start");
    if (!startNode) {
      await sendMessage(recipient, "Chatbot start node not configured.");
      return;
    }

    // Process the first node
    await processNode(startNode?.nodeId, chatbotData.nodes,chatbotData.edges, recipient);
  } catch (error) {
    console.error('Error processing chatbot flow:', error);
    throw new Error('Failed to process chatbot flow');
  }
};
const sendMessageWithButtons = async (recipient: string, buttonMessage: any) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
    const response = await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to: recipient,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: buttonMessage.text,
          },
          action: {
            buttons: buttonMessage.buttons,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${metaWhatsAppAPI.accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error("Error sending button message:", error);
    throw new Error("Failed to send button message");
  }
};

// Process a node based on its type
// const processNode = async (node: any, edges: any[], recipient: string) => {
//   try {
//     if (node.type === "message") {
//       // Handle message nodes
//       const messages = node.data.message_data?.messages || [];
//       for (const message of messages) {
//         if (message.type === "text") {
//           await sendMessage(recipient, message.message);
//         }
//       }
//     } else if (node.type === "buttons") {
//       // Handle button nodes
//       const buttonsData = node.data.buttons_data;
//       const buttons = buttonsData.buttons.map(
//         (button: any) => button.button
//       ).join('\n');

//       await sendMessage(
//         recipient,
//         `${buttonsData.bodyText}\nOptions:\n${buttons}`
//       );

//       // Wait for user response to proceed
//       const userResponse = await waitForUserResponse(recipient);
//       const selectedEdge = edges.find(
//         (edge) => edge.sourceId === node.id && edge.sourceHandle === userResponse
//       );

//       if (selectedEdge) {
//         const nextNode = edges.find((edge) => edge.id === selectedEdge.targetId);
//         if (nextNode) {
//           await processNode(nextNode, edges, recipient);
//         }
//       }
//     }
//   } catch (error) {
//     console.error('Error processing node:', error);
//     throw new Error('Failed to process node');
//   }
// };
const processNode = async (nodeId: string, nodes: any[], edges: any[], recipient: string) => {
  try {
    // Find the node by nodeId
    const currentNode = nodes.find((node) => node.nodeId === nodeId);

    if (!currentNode) {
      console.error(`Node with ID ${nodeId} not found.`);
      return;
    }

    // Handle Start Node
    if (currentNode.type === "start") {
      console.log("Processing Start Node...");
      const outgoingEdge = edges.find((edge) => edge.sourceId === currentNode.id);
      if (outgoingEdge) {
        const nextNodeId = nodes.find((node) => node.id === outgoingEdge.targetId)?.nodeId;
        if (nextNodeId) {
          await processNode(nextNodeId, nodes, edges, recipient); // Process the next node
        }
      }
      return;
    }

    // Handle Message Node
    if (currentNode.type === "message") {
      const messageData = currentNode.data?.message_data?.messages;

      if (messageData && messageData.length > 0) {
        for (const message of messageData) {
          await sendMessage(recipient, message.message); // Send the message to the recipient
        }
      }

      // Get the next node and process it
      const outgoingEdge = edges.find((edge) => edge.sourceId === currentNode.id);
      if (outgoingEdge) {
        const nextNodeId = nodes.find((node) => node.id === outgoingEdge.targetId)?.nodeId;
        if (nextNodeId) {
          await processNode(nextNodeId, nodes, edges, recipient); // Process the next node
        }
      }
    }

    // Handle Button Node
    if (currentNode.type === "buttons") {
      const buttonData = currentNode.data?.buttons_data;
      if (buttonData) {
        const buttons = buttonData.buttons.map((button: any, index: number) => ({
          type: "reply",
          reply: { id: `source_${index}`, title: button.button },
        }));

        const buttonMessage = {
          text: buttonData.bodyText || "Please select an option:",
          buttons: buttons,
        };

        // Send button message to the user
        await sendMessageWithButtons(recipient, buttonMessage);
      }
    }
  } catch (error) {
    console.error("Error in processNode:", error);
  }
};

// Send a message using WhatsApp API
const sendMessage = async (recipient: string, message: string) => {
  try {
    const url = `${metaWhatsAppAPI.baseURL}/${metaWhatsAppAPI.phoneNumberId}/messages`;
    await axios.post(
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
  } catch (error) {
    console.error('Error sending message:', error);
    throw new Error('Failed to send message');
  }
};

// Simulate waiting for a user response
const waitForUserResponse = async (recipient: string): Promise<string> => {
  // Mock implementation
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("source_0"); // Example: User selects the first button
    }, 2000);
  });
};
