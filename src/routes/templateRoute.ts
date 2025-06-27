import { Router } from "express";
import {
  getAllTemplates,
  createTemplate,
  deleteTemplate,
  createBroadcast,
  getBroadcastStats,
  getBroadcasts,
  getTemplateByName,
  deleteBroadcast,
  getTemplatesLibrary,
  updateBroadcast,
  getAllApprovedTemplates,
  syncTemplatesController
} from "../controllers/templateController";
import multer from "multer";

const storage = multer.memoryStorage(); // ⬅️ Enables buffer access
const upload = multer({ storage });
//const upload = multer({ dest: "uploads/" });
const router: Router = Router();

router.get("/", getAllTemplates);
router.get("/sync", syncTemplatesController);
router.get("/approved", getAllApprovedTemplates);
router.get("/library", getTemplatesLibrary);
router.post("/", upload.single("file"),createTemplate);
router.get('/brodcast', getBroadcasts);
router.post("/brodcast", createBroadcast);
router.put("/brodcast/:id", updateBroadcast);
router.delete("/brodcast/:id", deleteBroadcast);
router.get("/brodcast/:id/stats", getBroadcastStats);
router.get("/:templateName", getTemplateByName);
router.delete("/:templateName", deleteTemplate);


export default router;
