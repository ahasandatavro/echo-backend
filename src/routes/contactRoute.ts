import { Router } from "express";
import multer from "multer";
import {
  getAllContacts,
  getContactById,
  createContact,
  updateContact,
  deleteContact,
  uploadContacts,
  getMessagesByContactId,
  getAttributes,
  updateAttribute,
  getNotes,
  addNote,
  getTags,
  addTag,
  removeTag,
  getChatHistory,
  updateChatStatusAndAssignment,
  expireInactiveChats,
  sendMessageController,
  getAllImportedContacts,
  uploadCSV,
  importContacts,
  triggerChatbotByPhoneNumber,
  getCurrentAssignments,
  getContactStatus,
  getFilteredAttributesByKeyword,
  getAttributeOptionsForUser,
  getCountriesByPhoneNumber,
  getContactsAnalytics,
  getUsersAnalytics
} from "../controllers/contactController";
import { authenticateJWT } from '../middlewares/authMiddleware';
const router = Router();
const upload = multer({ dest: "uploads/" });

router.get("/", authenticateJWT, getAllContacts);
router.get("/imported", authenticateJWT, getAllImportedContacts);
router.get("/attributes", authenticateJWT, getFilteredAttributesByKeyword);
router.get("/attribute-options", authenticateJWT, getAttributeOptionsForUser);
router.get("/countries", authenticateJWT, getCountriesByPhoneNumber);
router.get("/analytics", authenticateJWT, getContactsAnalytics);
router.get("/analytics/users", authenticateJWT, getUsersAnalytics);
router.get("/:id", authenticateJWT, getContactById);
router.get("/:id/messages", authenticateJWT, getMessagesByContactId);
router.post("/", authenticateJWT, createContact);
router.put("/:id", authenticateJWT, updateContact);
router.delete("/:id", authenticateJWT, deleteContact);

router.get("/:id/attributes", authenticateJWT, getAttributes);
router.put("/:id/attributes", authenticateJWT, updateAttribute);
router.get("/:id/notes", authenticateJWT, getNotes);
router.post("/:id/notes", authenticateJWT, addNote);
router.get("/:id/assignments", authenticateJWT, getCurrentAssignments);
router.get("/:id/status", getContactStatus);


router.get("/:id/tags", authenticateJWT, getTags);
router.post("/:id/tags", authenticateJWT, addTag);
router.delete("/:id/tags/:tag", authenticateJWT, removeTag);

router.post("/upload", authenticateJWT, upload.single("file"), uploadContacts);
router.post("/upload-csv", authenticateJWT, upload.single("file"), uploadCSV);
router.post("/import", authenticateJWT, importContacts);

router.get("/:contactId/chat-history", authenticateJWT, getChatHistory);
router.put("/:id/chat-status", authenticateJWT, updateChatStatusAndAssignment);
router.post("/expire-timers", authenticateJWT, expireInactiveChats);

router.post("/:contactId/send-message", authenticateJWT, upload.single("file"), sendMessageController);
router.post(
  "/phone/:phoneNumber/trigger-chatbot",
  authenticateJWT,
  triggerChatbotByPhoneNumber
);

export default router;
