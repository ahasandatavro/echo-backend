import { Router } from "express";
import {
  getAllTemplates,
  createTemplate,
  deleteTemplate,
} from "../controllers/templateController";
import multer from "multer";

const upload = multer({ dest: "uploads/" });
const router: Router = Router();

router.get("/", getAllTemplates);
router.post("/", upload.single("file"),createTemplate);
router.delete("/:templateName", deleteTemplate);

export default router;
