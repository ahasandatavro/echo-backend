// @ts-nocheck
import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';
import {s3} from '../config/s3Config'

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


const deleteFileFromSpace = async (key: string) => {
  try {
    const params = {
      Bucket: process.env.DO_SPACES_BUCKET!,
      Key: key,
    };

    // Ensure `promise` is available
    const result = await s3.deleteObject(params).promise();
    console.log(`File deleted: ${key}`);
    return result;
  } catch (error) {
    console.error(`Failed to delete file: ${key}`, error);
    throw new Error("Failed to delete file");
  }
};

export const deleteNodeByChatId = async (req: Request, res: Response) => {
  const { chat_id } = req.params;

  try {
    const chatId = parseInt(chat_id, 10);

    if (isNaN(chatId)) {
      return res.status(400).json({ error: "Invalid chatId parameter" });
    }

    // Fetch all nodes associated with the chatId
    const nodes = await prisma.node.findMany({
      where: { chatId },
    });

    // Extract URLs from node data
    const fileUrls: string[] = [];
    nodes.forEach((node) => {
      const nodeData = node.data as {
        message_data?: {
          messages: Array<{
            type: string;
            message: {
              url?: string;
            };
          }>;
        };
      };
    
      if (nodeData?.message_data?.messages) {
        nodeData.message_data.messages.forEach((message) => {
          if (
            message.type === "image" ||
            message.type === "video" ||
            message.type === "audio" ||
            message.type === "document"
          ) {
            const url = message.message?.url;
            if (url) fileUrls.push(url);
          }
        });
      }
    });
    

    // Convert URLs to keys (remove the base URL)
    const keys = fileUrls.map((url) =>
      url.replace(`${process.env.DO_SPACES_ENDPOINT}/${process.env.DO_SPACES_BUCKET}/`, "")
    );

    // Delete files from DigitalOcean Spaces
    await Promise.all(keys.map((key) => deleteFileFromSpace(key)));

    // Delete edges associated with the chatId
    const deletedEdges = await prisma.edge.deleteMany({
      where: { chatId },
    });

    // Delete nodes associated with the chatId
    const deletedNodes = await prisma.node.deleteMany({
      where: { chatId },
    });

    // Optionally delete the chatbot itself (if applicable)
    const deletedChatbot = await prisma.chatbot.delete({
      where: { id: chatId },
    });

    res.status(200).json({
      message: `Successfully deleted data for chatId: ${chatId}`,
      deletedEdges: deletedEdges.count,
      deletedNodes: deletedNodes.count,
      deletedChatbot,
      deletedFiles: keys.length,
    });
  } catch (error) {
    console.error("Error deleting data by chatId:", error);
    res.status(500).json({ error: "Failed to delete data by chatId" });
  }
};

export const createChatFlow = async (req: Request, res: Response) => {
  const { chatBotName, nodes, edges } = req.body;

  try {
    // Check for existing chatbot names and append a unique suffix if necessary
    let uniqueChatBotName = chatBotName;
    let suffix = 1;

    while (await prisma.chatbot.findFirst({ where: { name: uniqueChatBotName } })) {
      uniqueChatBotName = `${chatBotName}_${suffix}`;
      suffix++;
    }

    // Create the chatbot with the unique name
    const chatbot = await prisma.chatbot.create({
      data: {
        name: uniqueChatBotName,
        description: "Generated flow",
        status: "ACTIVE",
      },
    });

    // Create nodes
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

    // Create edges
    const createdEdges = await prisma.$transaction(
      edges.map((edge: any) =>
        prisma.edge.create({
          data: {
            chatId: chatbot.id,
            sourceId: createdNodes.find((n) => n.nodeId === edge.source)?.id,
            targetId: createdNodes.find((n) => n.nodeId === edge.target)?.id,
            sourceHandle: edge.sourceHandle || null,
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

// export const createChatFlow = async (req: Request, res: Response) => {
//   const { chatBotName, nodes, edges } = req.body;

//   try {
//     const chatbot = await prisma.chatbot.create({
//       data: {
//         name: chatBotName,
//         description: "Generated flow",
//         status: "ACTIVE",
//       },
//     });

//     const createdNodes = await prisma.$transaction(
//       nodes.map((node: any) =>
//         prisma.node.create({
//           data: {
//             chatId: chatbot.id,
//             nodeId: node.id,
//             type: node.type,
//             data: node.data,
//             positionX: node.position.x,
//             positionY: node.position.y,
//           },
//         })
//       )
//     );

//     const createdEdges = await prisma.$transaction(
//       edges.map((edge: any) =>
//         prisma.edge.create({
//           data: {
//             chatId: chatbot.id,
//             sourceId: createdNodes.find((n) => n.nodeId === edge.source)?.id,
//             targetId: createdNodes.find((n) => n.nodeId === edge.target)?.id,
//           },
//         })
//       )
//     );

//     res.status(201).json({
//       message: 'Chat flow created successfully',
//       chatbot,
//       nodes: createdNodes,
//       edges: createdEdges,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: 'Failed to create chat flow' });
//   }
// };

// Fetch nodes by Chatbot ID
export const getNodesByChatId = async (req: Request, res: Response) => {
  const { chatId } = req.params;
  try {
    const chatbot = await prisma.chatbot.findUnique({
      where: { id: parseInt(chatId) },
    });

    if (!chatbot) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }

    const nodes = await prisma.node.findMany({
      where: { chatId: parseInt(chatId) },
    });

    const edges = await prisma.edge.findMany({
      where: { chatId: parseInt(chatId) },
    });

    res.status(200).json({
      chatbot,
      nodes,
      edges,
    });
  } catch (error) {
    console.error('Error fetching chat flow details:', error);
    res.status(500).json({ error: 'Failed to fetch chat flow details' });
  }
  // try {
  //   const nodes = await prisma.node.findMany({
  //     where: { chatId: parseInt(chatId) },
  //   });
  //   res.status(200).json(nodes);
  // } catch (error) {
  //   console.error(error);
  //   res.status(500).json({ error: 'Failed to fetch nodes by chatId' });
  // }
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



export const updateChatFlow = async (req: Request, res: Response) => {
  const { chatId: chatIdParam } = req.params;
  const chatIdNumber = parseInt(chatIdParam, 10);

  if (isNaN(chatIdNumber)) {
    return res.status(400).json({ error: 'Invalid chatId parameter. Must be a number.' });
  }

  const { nodes, edges } = req.body;

  try {
    // Validate if the chatbot exists
    const chatbot = await prisma.chatbot.findUnique({
      where: { id: chatIdNumber },
    });

    if (!chatbot) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }

    // Use a transaction to update nodes and edges atomically
    await prisma.$transaction([
      // Delete existing edges first to avoid foreign key constraint violations
      prisma.edge.deleteMany({
        where: { chatId: chatIdNumber },
      }),
      // Delete existing nodes after edges have been removed
      prisma.node.deleteMany({
        where: { chatId: chatIdNumber },
      }),

      // Create new nodes
      ...nodes.map((node: any) =>
        prisma.node.create({
          data: {
            chatId: chatIdNumber,
            nodeId: node.id,
            type: node.type,
            data: node.data,
            positionX: node.position.x,
            positionY: node.position.y,
          },
        })
      ),
    ]);

    // Fetch all the newly created nodes to map their `id` values
    const createdNodes = await prisma.node.findMany({
      where: { chatId: chatIdNumber },
    });

    // Create new edges
    const edgeCreationPromises = edges.map((edge: any) => {
      const sourceNode = createdNodes.find((node) => node.nodeId === edge.source);
      const targetNode = createdNodes.find((node) => node.nodeId === edge.target);

      if (!sourceNode || !targetNode) {
        throw new Error(
          `Invalid edge connection: source (${edge.source}) or target (${edge.target}) node not found.`
        );
      }

      return prisma.edge.create({
        data: {
          chatId: chatIdNumber,
          sourceId: sourceNode.id, // Use the integer ID from the Node table
          targetId: targetNode.id, // Use the integer ID from the Node table
          sourceHandle: edge.sourceHandle || null,
        },
      });
    });

    await prisma.$transaction(edgeCreationPromises);

    res.status(200).json({ message: 'Chat flow updated successfully' });
  } catch (error: unknown) {
    console.error(error);

    if (error instanceof Error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to update chat flow' });
  }
};
