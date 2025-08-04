import { Request, Response } from 'express';
import { prisma } from "../models/prismaClient";

// Get all variables
export const getVariables = async (req: Request, res: Response): Promise<void> => {
  try {
    const variables = await prisma.variable.findMany();
    res.status(200).json(variables);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch variables', details: error.message });
  }
};

// Create a new variable
export const createVariable = async (req: Request, res: Response): Promise<void> => {
  const { name, value, chatbotId, conversationId, nodeId } = req.body;
  try {
    const newVariable = await prisma.variable.create({
      data: {
        name,
        value,
        chatbotId,
        conversationId,
        nodeId,
      },
    });
    res.status(201).json(newVariable);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create variable', details: error.message });
  }
};

// Update an existing variable
export const updateVariable = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, value, chatbotId, conversationId, nodeId } = req.body;
  try {
    const updatedVariable = await prisma.variable.update({
      where: { id: parseInt(id, 10) },
      data: {
        name,
        value,
        chatbotId,
        conversationId,
        nodeId,
      },
    });
    res.status(200).json(updatedVariable);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update variable', details: error.message });
  }
};

// Delete a variable
export const deleteVariable = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    await prisma.variable.delete({
      where: { id: parseInt(id, 10) },
    });
    res.status(200).json({ message: 'Variable deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete variable', details: error.message });
  }
};

// Get variables by chatbot ID
export const getVariablesByChatbotId = async (req: Request, res: Response): Promise<void> => {
  const { chatbotId } = req.params;
  try {
    const variables = await prisma.variable.findMany({
      where: { chatbotId: parseInt(chatbotId, 10) },
      distinct: ['name'], 
    });
    res.status(200).json(variables);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch variables by chatbot ID', details: error.message });
  }
};

// Get variables by conversation ID
export const getVariablesByConversationId = async (req: Request, res: Response): Promise<void> => {
  const { conversationId } = req.params;
  try {
    const variables = await prisma.variable.findMany({
      where: { conversationId: parseInt(conversationId, 10) },
    });
    res.status(200).json(variables);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch variables by conversation ID', details: error.message });
  }
};
