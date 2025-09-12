import express from "express";
import {
  getConversationStatus,
  solveConversation,
  createNewConversation,
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

export default router;
