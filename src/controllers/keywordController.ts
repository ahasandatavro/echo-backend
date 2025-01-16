// @ts-nocheck
// controllers/keywordController.ts
import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';

// Create a new Keyword
export const createKeyword = async (req: Request, res: Response) => {
  const { value, chatbotId, textId, matchType, fuzzyPercent } = req.body;

  try {
    const keyword = await prisma.keyword.create({
      data: {
        value,
        chatbotId,
        textId,
        matchType,
        fuzzyPercent,
      },
    });
    res.status(201).json({ message: 'Keyword created successfully', keyword });
  } catch (error) {
    console.error('Error creating Keyword:', error);
    res.status(500).json({ error: 'Failed to create Keyword' });
  }
};

// Get all Keywords
export const getAllKeywords = async (req: Request, res: Response) => {
  try {
    const keywords = await prisma.keyword.findMany({
      include: {
        chatbot: true,
        text: true,
      },
    });
    res.status(200).json(keywords);
  } catch (error) {
    console.error('Error fetching Keywords:', error);
    res.status(500).json({ error: 'Failed to fetch Keywords' });
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
