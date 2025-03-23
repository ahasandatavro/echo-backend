import { Request, Response } from 'express';
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// Get all rules for the current user
export const getAllRules = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const userId = reqUser.userId;
    
    const rules = await prisma.rule.findMany({
      where: { userId },
      orderBy: { lastUpdated: 'desc' },
    });
    
    return res.status(200).json({ data: rules });
  } catch (error) {
    console.error('Error fetching rules:', error);
    return res.status(500).json({ error: 'Failed to fetch rules' });
  }
};

// Get a specific rule
export const getRule = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const userId = reqUser.userId;
    const { id } = req.params;
    
    const rule = await prisma.rule.findFirst({
      where: { 
        id: parseInt(id),
        userId
      }
    });
    
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    
    return res.status(200).json({ data: rule });
  } catch (error) {
    console.error('Error fetching rule:', error);
    return res.status(500).json({ error: 'Failed to fetch rule' });
  }
};

// Create a new rule
export const createRule = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const userId = reqUser.userId;
    const { name, triggerType, action, status, conditions, actionData } = req.body;
    
    if (!name || !triggerType || !action) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Always ensure conditions and actionData are at least empty objects
    const safeConditions = conditions || {};
    const safeActionData = actionData || {};
    
    console.log('Creating rule with conditions:', safeConditions);
    console.log('Creating rule with actionData:', safeActionData);
    
    const rule = await prisma.rule.create({
      data: {
        name,
        triggerType,
        action,
        status: status || 'Active',
        conditions: safeConditions,
        actionData: safeActionData,
        userId,
      },
    });
    
    return res.status(201).json({ data: rule });
  } catch (error) {
    console.error('Error creating rule:', error);
    return res.status(500).json({ error: 'Failed to create rule' });
  }
};

// Update a rule
export const updateRule = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const userId = reqUser.userId;
    const { id } = req.params;
    const { name, triggerType, action, status, conditions, actionData } = req.body;
    
    const ruleId = parseInt(id);
    
    // Verify the rule exists and belongs to the user
    const existingRule = await prisma.rule.findFirst({
      where: { 
        id: ruleId,
        userId
      }
    });
    
    if (!existingRule) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    
    // Ensure conditions and actionData are never null
    const safeConditions = conditions !== undefined ? (conditions || {}) : existingRule.conditions;
    const safeActionData = actionData !== undefined ? (actionData || {}) : existingRule.actionData;
    
    console.log('Updating rule with conditions:', safeConditions);
    console.log('Updating rule with actionData:', safeActionData);
    
    const updatedRule = await prisma.rule.update({
      where: { id: ruleId },
      data: {
        name: name !== undefined ? name : existingRule.name,
        triggerType: triggerType !== undefined ? triggerType : existingRule.triggerType,
        action: action !== undefined ? action : existingRule.action,
        status: status !== undefined ? status : existingRule.status,
        conditions: safeConditions,
        actionData: safeActionData,
      },
    });
    
    return res.status(200).json({ data: updatedRule });
  } catch (error) {
    console.error('Error updating rule:', error);
    return res.status(500).json({ error: 'Failed to update rule' });
  }
};

// Delete a rule
export const deleteRule = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const userId = reqUser.userId;
    const { id } = req.params;
    
    const ruleId = parseInt(id);
    
    // Verify the rule exists and belongs to the user
    const existingRule = await prisma.rule.findFirst({
      where: { 
        id: ruleId,
        userId
      }
    });
    
    if (!existingRule) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    
    await prisma.rule.delete({
      where: { id: ruleId },
    });
    
    return res.status(204).send();
  } catch (error) {
    console.error('Error deleting rule:', error);
    return res.status(500).json({ error: 'Failed to delete rule' });
  }
};

// Helper function to validate and parse JSON
function validateAndParseJSON(data: any): any {
  if (data === null) {
    // Use Prisma.JsonNull for null values
    return { Prisma: { kind: 'null' } };
  }
  
  if (data === undefined) {
    // Return empty object for undefined values
    return {};
  }
  
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('Error parsing JSON string:', e);
      return {};
    }
  }
  
  if (typeof data === 'object') {
    return data;
  }
  
  return {};
} 