import { Router } from "express";
import multer from "multer";
import {
  getAllContacts,
  getContactById,
  createContact,
  updateContact,
  deleteContact,
  uploadContacts
} from "../controllers/contactController";

const router = Router();
const upload = multer({ dest: "uploads/" });

router.get("/", getAllContacts);
router.get("/:id", getContactById);
router.post("/", createContact);
router.put("/:id", updateContact);
router.delete("/:id", deleteContact);
// Upload CSV contacts
router.post("/upload", upload.single("file"), uploadContacts);

export default router;
