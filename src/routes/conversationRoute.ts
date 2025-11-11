import express from "express";
import {
  getConversationStatus,
  solveConversation,
  createNewConversation,
  deleteConversation,
} from "../controllers/conversationController";
import multer from "multer";

const router = express.Router();
const storage = multer.memoryStorage(); // ⬅️ Enables buffer access
const upload = multer({ storage });

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
router.post("/",upload.single('headerImage'), createNewConversation);

/**
 * Delete the latest conversation for a contact and all related data
 */
router.delete("/:contactId", deleteConversation);

export default router;
