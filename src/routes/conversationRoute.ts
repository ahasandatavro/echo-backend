import express from "express";
import {
  getConversationStatus,
  solveConversation,
} from "../controllers/conversationController";

const router = express.Router();

/**
 * Get latest chat status for a contact
 */
router.get("/:contactId/status", getConversationStatus);

/**
 * Mark a conversation as solved
 */
router.patch("/:contactId/solve", solveConversation);

export default router;
