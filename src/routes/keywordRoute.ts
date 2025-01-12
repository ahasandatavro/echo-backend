// routes/keywordRoutes.ts
import express from 'express';
import {
  createKeyword,
  getAllKeywords,
  updateKeyword,
  deleteKeyword,
} from '../controllers/keywordController';

const router = express.Router();

// Create a new Keyword
router.post('/', createKeyword);

// Get all Keywords
router.get('/', getAllKeywords);

// Update a Keyword by ID
router.put('/:id', updateKeyword);

// Delete a Keyword by ID
router.delete('/:id', deleteKeyword);

export default router;
