import { Router } from "express";
import {
  getAllTemplates,
  createTemplate,
  deleteTemplate,
  createBroadcast,
  getBroadcastStats
} from "../controllers/templateController";
import multer from "multer";

const upload = multer({ dest: "uploads/" });
const router: Router = Router();

router.get("/", getAllTemplates);
router.post("/", upload.single("file"),createTemplate);
router.post("/brodcast", createBroadcast);
router.get("/brodcast/:id/stats", getBroadcastStats);
router.delete("/:templateName", deleteTemplate);

export default router;
