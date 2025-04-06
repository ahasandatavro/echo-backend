import express from "express";
import {
  getConversationStatus,
  solveConversation,
  createNewConversation,
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

/**
 * Create a new contact and send a template
 */
router.post("/", createNewConversation);

export default router;
