// @ts-nocheck
import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';
import {s3} from '../config/s3Config'

// Function to get chatbot limits from environment variables
const getChatbotLimits = () => {
  try {
    const config = process.env.CHATBOT_LIMITS_CONFIG;
    if (!config) {
      throw new Error('CHATBOT_LIMITS_CONFIG not found in environment variables');
    }
    return JSON.parse(config);
  } catch (error) {
    console.error('Error parsing CHATBOT_LIMITS_CONFIG:', error);
    // Return default limits if parsing fails
    return { "Free": 0, "Growth": 3, "Pro": 10, "Business": 100 };
  }
};

const getNodeLimits = () => {
  try {
    const config = process.env.NODES_LIMITS_CONFIG;
    if (!config) {
      throw new Error('NODES_LIMITS_CONFIG not found in environment variables');
    }
    return JSON.parse(config);
  } catch (error) {
    console.error('Error parsing NODES_LIMITS_CONFIG:', error);
    // Return default limits if parsing fails
    return { "Free": 5, "Growth": 50, "Pro": 80, "Business": 100 };
  }
};

// Function to check if user can create more chatbots
const checkChatbotCreationLimit = async (userId: number, packageName: string) => {
  const limits = getChatbotLimits();
  const limit = limits[packageName];

  if (limit === undefined) {
    throw new Error(`Unknown package: ${packageName}`);
  }

  const userChatbotCount = await prisma.chatbot.count({
    where: { ownerId: userId },
  });

  if (userChatbotCount >= limit) {
    const nextPackage = packageName === "Free" ? "Growth" : 
                       packageName === "Growth" ? "Pro" : 
                       packageName === "Pro" ? "Business" : "Enterprise";
    throw new Error(`${packageName} plan allows maximum ${limit} chatbots. Please upgrade to ${nextPackage} plan for more chatbots.`);
  }

  return true;
};

const checkNodeLengthLimit = (nodeCount: number, packageName: string) => {
  const limits = getNodeLimits();
  const limit = limits[packageName];

  if (limit === undefined) {
    throw new Error(`Unknown package: ${packageName}`);
  }

  if (nodeCount > limit) {
    const nextPackage = packageName === "Free" ? "Growth" : 
                       packageName === "Growth" ? "Pro" : 
                       packageName === "Pro" ? "Business" : "Enterprise";
    
    return {
      error: `${packageName} plan allows maximum ${limit} nodes per chatbot. Please upgrade to ${nextPackage} plan for more nodes.`,
      currentNodes: nodeCount,
      maxAllowed: limit,
      package: packageName
    };
  }
  
  return null; // No error
};

export const createNode = async (req: Request, res: Response) => {
};
export const getChatbotLibrary = async (req: Request, res: Response) => {
  try {


    const chatbots = await  prisma.chatbot.findMany({
      where:   {ownerId: null}
    })

    res.status(200).json({
      chatbots
    });
  } catch (error) {
    console.error('Error fetching chatbots:', error);
    res.status(500).json({ message: 'Failed to fetch chatbots' });
  }

}
export const getNode = async (req: Request, res: Response) => {

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
    await prisma.nodeVisit.deleteMany({
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
    const user:any=req.user;
    const dbUser=await prisma.user.findFirst({
      where: { id: user.userId },
    })

    // Check user's package subscription and chatbot creation limits
    const dbUserPackage = await prisma.packageSubscription.findFirst({
      where: { userId: dbUser?.id, isActive: true },
    });
    const userPackage=dbUserPackage?.packageName;
    if (!userPackage) {
      return res.status(403).json({ 
        error: "No active subscription found. Please upgrade your plan to create chatbots." 
      });
    }

    // Check node length limits based on package
    const nodeCount = nodes?.length || 0;
    
    const nodeLimitError = checkNodeLengthLimit(nodeCount, userPackage);
    if (nodeLimitError) {
      return res.status(403).json(nodeLimitError);
    }

    // Check if user can create more chatbots based on their package
    try {
      await checkChatbotCreationLimit(dbUser.id, userPackage);
    } catch (limitError) {
      return res.status(403).json({ 
        error: limitError instanceof Error ? limitError.message : "Failed to check chatbot limits" 
      });
    }

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
        ownerId: dbUser?.id
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
    await prisma.nodeVisit.deleteMany({
      where: { nodeId: parseInt(id) }
    });
    await prisma.node.delete({
      where: { id: parseInt(id) },
    });
    res.status(200).json({ message: 'Node deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete node' });
  }
};

export const getPaginatedChatbots = async (req: Request, res: Response) => {
  try {
    const { userId } = req.user as { userId: number };
    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!dbUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const page   = parseInt((req.query.page  as string) ?? "1",  10);
    const limit  = parseInt((req.query.limit as string) ?? "10", 10);
    const search = (req.query.search as string)?.trim();
    const offset = (page - 1) * limit;

    // combine the search filter and createdById into one `where`
    const whereFilter = {
      ownerId: dbUser.id,
      ...(search
        ? { name: { contains: search, mode: 'insensitive' } }
        : {}),
    };

    const [chatbots, total] = await prisma.$transaction([
      prisma.chatbot.findMany({
        where:   whereFilter,     // <-- use the combined filter here
        skip:    offset,
        take:    limit,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.chatbot.count({
        where: whereFilter,       // <-- and here
      }),
    ]);

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

  try {
    // Validate if the chatbot exists
    const chatbot = await prisma.chatbot.findUnique({
      where: { id: chatIdNumber },
    });

    if (!chatbot) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }

    // Check if this is a library chatbot (no ownerId)
    if (!chatbot.ownerId) {
      return res.status(403).json({ 
        error: 'Library chatbots cannot be modified. Please create a copy of this chatbot to make changes.' 
      });
    }

    // Get user information for package validation
    const user: any = req.user;
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId },
    });

    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check user's package subscription
    const userPackage = user.activeSubscription?.packageName;
    
    if (!userPackage) {
      return res.status(403).json({ 
        error: "No active subscription found. Please upgrade your plan to update chatbots." 
      });
    }

    //save chatbot name in chatbot table if there's chatbot name in req.body
    const { nodes, edges, chatBotName } = req.body;

    // Check node length limits based on package
    const nodeCount = nodes?.length || 0;
    
    const nodeLimitError = checkNodeLengthLimit(nodeCount, userPackage);
    if (nodeLimitError) {
      return res.status(403).json(nodeLimitError);
    }

    if(chatBotName){
      await prisma.chatbot.update({
        where: { id: chatIdNumber },
        data: { name: chatBotName },
      });
    }

    // Use a transaction to update nodes and edges atomically
    await prisma.$transaction([
      // Delete existing edges first to avoid foreign key constraint violations
      prisma.edge.deleteMany({
        where: { chatId: chatIdNumber },
      }),
      // Delete existing node visits for nodes in this chat flow
      prisma.nodeVisit.deleteMany({
        where: { node: { chatId: chatIdNumber } }
      }),
      // Delete existing nodes after edges and visits have been removed
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
