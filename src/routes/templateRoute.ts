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
  syncTemplatesController,
  getBroadcastById
} from "../controllers/templateController";
import multer from "multer";
import { authenticateJWT } from "../middlewares/authMiddleware";

const storage = multer.memoryStorage(); // ⬅️ Enables buffer access
const upload = multer({ storage });
//const upload = multer({ dest: "uploads/" });
const router: Router = Router();

router.get("/", authenticateJWT, getAllTemplates);
router.get("/sync", syncTemplatesController);
router.get("/approved", authenticateJWT, getAllApprovedTemplates);
router.get("/library", authenticateJWT, getTemplatesLibrary);
router.post("/",authenticateJWT, upload.fields([
  { name: "file", maxCount: 1 },
  { name: "carouselFiles[]", maxCount: 10 }
]), createTemplate);
router.get('/brodcast', authenticateJWT, getBroadcasts);
router.post("/brodcast", authenticateJWT, upload.single('headerImage'), createBroadcast);
router.get("/brodcast/:id", authenticateJWT, getBroadcastById);
router.put("/brodcast/:id", authenticateJWT, updateBroadcast);
router.delete("/brodcast/:id", authenticateJWT, deleteBroadcast);
router.get("/brodcast/:id/stats", authenticateJWT, getBroadcastStats);
router.get("/:templateName", authenticateJWT, getTemplateByName);
router.delete("/:templateName", authenticateJWT, deleteTemplate);


export default router;
