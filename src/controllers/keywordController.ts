// @ts-nocheck
// controllers/keywordController.ts
import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';

// Create a new Keyword

export const createKeyword = async (req: Request, res: Response) => {
  const { value, chatbotId, textId, matchType, fuzzyPercent, replyMaterialIds, routingMaterialIds, userIds, assignedUserId, teamId,templateIds } = req.body;

  try {
    // Ensure user is authenticated
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: "Unauthorized. User not found." });
    }

    // Create keyword associated with the user
    const keyword = await prisma.keyword.create({
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
  } catch (error) {
    console.error("Error creating Keyword:", error);
    res.status(500).json({ error: "Failed to create Keyword" });
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
