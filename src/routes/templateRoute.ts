import { Router } from "express";
import {
  getAllTemplates,
  createTemplate,
  deleteTemplate,
} from "../controllers/templateController";

const router: Router = Router();

router.get("/", getAllTemplates);
router.post("/", createTemplate);
router.delete("/:templateName", deleteTemplate);

export default router;
