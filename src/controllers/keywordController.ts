// @ts-nocheck
// controllers/keywordController.ts
import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';

// Create a new Keyword

export const createKeyword = async (req: Request, res: Response) => {
  const {  id, value, chatbotId, textId, matchType, fuzzyPercent, replyMaterialIds, routingMaterialIds, userIds, assignedUserId, teamId,templateIds } = req.body;

  try {
    // Ensure user is authenticated
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: "Unauthorized. User not found." });
    }

    let keyword;

    if (id) {
      // ✅ Update existing keyword
      keyword = await prisma.keyword.update({
        where: { id: Number(id) },
        data: {
          value,
          chatbotId,
          textId,
          matchType,
          fuzzyPercent,
          userId: req.user.userId, // ✅ Associate with logged-in user

          // ✅ Update replyMaterials (First, remove all then add new ones)
          replyMaterials: {
            deleteMany: {}, // Remove existing associations
            create: replyMaterialIds.map((replyMaterialId: number) => ({
              replyMaterial: { connect: { id: replyMaterialId } },
            })),
          },

          // ✅ Update routingMaterials (Remove and re-add)
          routingMaterials: {
            deleteMany: {},
            create: routingMaterialIds.map((routingMaterialId: number) => ({
              routingMaterial: { connect: { id: routingMaterialId } },
            })),
          },

          // ✅ Update keywordTemplates (Remove and re-add)
          keywordTemplates: {
            deleteMany: {},
            create: templateIds.map((templateId: number) => ({
              template: { connect: { id: Number(templateId) } },
            })),
          },
        },
        include: {
          replyMaterials: { include: { replyMaterial: true } },
          routingMaterials: { include: { routingMaterial: true } },
          keywordTemplates: { include: { template: true } },
        },
      });

      res.status(200).json({ message: "Keyword updated successfully", keyword });
    } else {
      // ✅ Create new keyword
      keyword = await prisma.keyword.create({
        data: {
          value,
          chatbotId,
          textId,
          matchType,
          fuzzyPercent,
          userId: req.user.userId, // ✅ Associate with logged-in user
          replyMaterials: {
            create: replyMaterialIds.map((replyMaterialId: number) => ({
              replyMaterial: { connect: { id: replyMaterialId } },
            })),
          },
          routingMaterials: {
            create: routingMaterialIds.map((routingMaterialId: number) => ({
              routingMaterial: { connect: { id: routingMaterialId } },
            })),
          },
          keywordTemplates: {
            create: templateIds.map((templateId: number) => ({
              template: { connect: { id: Number(templateId) } }, // ✅ Connect each template
            })),
          },
        },
        include: {
          replyMaterials: { include: { replyMaterial: true } },
          routingMaterials: { include: { routingMaterial: true } },
          keywordTemplates: { include: { template: true } },
        },
      });

      res.status(201).json({ message: "Keyword created successfully", keyword });
    }
  } catch (error) {
    console.error("Error creating/updating Keyword:", error);
    res.status(500).json({ error: "Failed to create/update Keyword" });
  }
};

export const getAllKeywords = async (req: Request, res: Response) => {
  try {
    const keywords = await prisma.keyword.findMany({
      include: {
        replyMaterials: {
          include: {
            replyMaterial: {
              select: { id: true, type: true, name: true, fileUrl: true }, // Only select necessary fields
            },
          },
        },
        routingMaterials: {
          include: {
            routingMaterial: {
              select: { id: true, type: true, materialName: true }, // Include only required fields
            },
          },
        },
        chatbot: { // ✅ Include chatbot details
          select: { id: true, name: true }, // Fetch chatbot ID and Name
        },
        keywordTemplates: { // ✅ Include templates
          include: { template: { select: { id: true, name: true } } },
        },
      },
    });

    // ✅ Format Data to Match UI Requirements
    const formattedKeywords = keywords.map((keyword) => ({
      id: keyword.id,
      value: keyword.value,
      triggered: 0, // Placeholder for trigger count
      matchType: keyword.matchType,
      fuzzyPercent: keyword.fuzzyPercent,
      chatbot: keyword.chatbot ? { // ✅ Include chatbot if available
        id: keyword.chatbot.id,
        name: keyword.chatbot.name,
      } : null,
      templates: keyword.keywordTemplates.map((item) => ({
        id: item.template.id,
        name: item.template.name,
      })),
      replyMaterials: [
        ...keyword.replyMaterials.map((item) => ({
          id: item.replyMaterial.id,
          type: item.replyMaterial.type,
          name: item.replyMaterial.name,
          fileUrl: item.replyMaterial.fileUrl,
        })),
        ...keyword.routingMaterials.map((item) => ({
          id: item.routingMaterial.id,
          type: item.routingMaterial.type,
          name: item.routingMaterial.materialName,
        })),
      ],
    }));

    res.status(200).json(formattedKeywords);
  } catch (error) {
    console.error("Error fetching Keywords:", error);
    res.status(500).json({ error: "Failed to fetch Keywords" });
  }
};
export const getKeywordById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Fetch keyword by ID, including all related entities
    const keyword = await prisma.keyword.findUnique({
      where: { id: Number(id) },
      include: {
        replyMaterials: {
          include: {
            replyMaterial: {
              select: { id: true, type: true, name: true, fileUrl: true },
            },
          },
        },
        routingMaterials: {
          include: {
            routingMaterial: {
              select: { id: true, type: true, materialName: true },
            },
          },
        },
        chatbot: {
          select: { id: true, name: true },
        },
        keywordTemplates: {
          include: { template: { select: { id: true, name: true } } },
        },
      },
    });

    // If keyword not found, return a 404 error
    if (!keyword) {
      return res.status(404).json({ error: "Keyword not found" });
    }

    // ✅ Format Data to Match UI Requirements
    const formattedKeyword = {
      id: keyword.id,
      value: keyword.value,
      triggered: 0, // Placeholder for trigger count
      matchType: keyword.matchType,
      fuzzyPercent: keyword.fuzzyPercent,
      chatbot: keyword.chatbot
        ? { id: keyword.chatbot.id, name: keyword.chatbot.name }
        : null,
      templates: keyword.keywordTemplates.map((item) => ({
        id: item.template.id,
        name: item.template.name,
      })),
      replyMaterials: [
        ...keyword.replyMaterials.map((item) => ({
          id: item.replyMaterial.id,
          type: item.replyMaterial.type,
          name: item.replyMaterial.name,
          fileUrl: item.replyMaterial.fileUrl,
        })),
        ...keyword.routingMaterials.map((item) => ({
          id: item.routingMaterial.id,
          type: item.routingMaterial.type,
          name: item.routingMaterial.materialName,
        })),
      ],
    };

    res.status(200).json(formattedKeyword);
  } catch (error) {
    console.error("Error fetching keyword by ID:", error);
    res.status(500).json({ error: "Failed to fetch keyword" });
  }
};

// Update a Keyword
export const updateKeyword = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { value, chatbotId, textId, matchType, fuzzyPercent } = req.body;

  try {
    const updatedKeyword = await prisma.keyword.update({
      where: { id: parseInt(id) },
      data: {
        value,
        chatbotId,
        textId,
        matchType,
        fuzzyPercent,
      },
    });
    res.status(200).json({ message: 'Keyword updated successfully', updatedKeyword });
  } catch (error) {
    console.error('Error updating Keyword:', error);
    res.status(500).json({ error: 'Failed to update Keyword' });
  }
};

// Delete a Keyword
export const deleteKeyword = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await prisma.keyword.delete({
      where: { id: parseInt(id) },
    });
    res.status(200).json({ message: 'Keyword deleted successfully' });
  } catch (error) {
    console.error('Error deleting Keyword:', error);
    res.status(500).json({ error: 'Failed to delete Keyword' });
  }
};
