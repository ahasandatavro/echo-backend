import express from 'express';
import { 
  getAllRules, 
  getRule, 
  createRule, 
  updateRule, 
  deleteRule 
} from "../controllers/ruleController";

const router = express.Router();

// Get all rules for current user
router.get('/', getAllRules);

// Get a specific rule
router.get('/:id', getRule);

// Create a new rule
router.post('/', createRule);

// Update a rule
router.put('/:id', updateRule);

// Delete a rule
router.delete('/:id', deleteRule);

export default router; 