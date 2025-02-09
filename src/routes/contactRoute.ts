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
  removeTag
} from "../controllers/contactController";

const router = Router();
const upload = multer({ dest: "uploads/" });

router.get("/", getAllContacts);
router.get("/:id", getContactById);
router.get("/:id/messages", getMessagesByContactId);
router.post("/", createContact);
router.put("/:id", updateContact);
router.delete("/:id", deleteContact);

router.get("/:id/attributes", getAttributes);
router.put("/:id/attributes", updateAttribute);
router.get("/:id/notes", getNotes);
router.post("/:id/notes", addNote);

router.get("/:id/tags", getTags);
router.post("/:id/tags", addTag);
router.delete("/:id/tags/:tag", removeTag);

router.post("/upload", upload.single("file"), uploadContacts);

export default router;
