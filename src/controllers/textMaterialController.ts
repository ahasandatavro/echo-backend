// @ts-nocheck
// controllers/textMaterialController.ts
import { Request, Response } from 'express';
import { prisma } from '../models/prismaClient';

export const createTextMaterial = async (req: Request, res: Response) => {
  const { name, content } = req.body;

  try {
    const textMaterial = await prisma.textMaterial.create({
      data: { name, content },
    });
    res.status(201).json({ message: 'TextMaterial created successfully', textMaterial });
  } catch (error) {
    console.error('Error creating TextMaterial:', error);
    res.status(500).json({ error: 'Failed to create TextMaterial' });
  }
};

export const getAllTextMaterials = async (req: Request, res: Response) => {
  try {
    const textMaterials = await prisma.textMaterial.findMany();
    res.status(200).json(textMaterials);
  } catch (error) {
    console.error('Error fetching TextMaterials:', error);
    res.status(500).json({ error: 'Failed to fetch TextMaterials' });
  }
};

export const updateTextMaterial = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, content } = req.body;

  try {
    const updatedTextMaterial = await prisma.textMaterial.update({
      where: { id: parseInt(id) },
      data: { name, content },
    });
    res.status(200).json({ message: 'TextMaterial updated successfully', updatedTextMaterial });
  } catch (error) {
    console.error('Error updating TextMaterial:', error);
    res.status(500).json({ error: 'Failed to update TextMaterial' });
  }
};

export const deleteTextMaterial = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await prisma.textMaterial.delete({
      where: { id: parseInt(id) },
    });
    res.status(200).json({ message: 'TextMaterial deleted successfully' });
  } catch (error) {
    console.error('Error deleting TextMaterial:', error);
    res.status(500).json({ error: 'Failed to delete TextMaterial' });
  }
};
