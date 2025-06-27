import express from "express";
import {
  getAllMedia,
  getMediaById,
  uploadMedia,
  updateMedia,
  deleteMedia,
} from "../controllers/uploadMediaController";
import { authenticateJWT } from "../middlewares/authMiddleware";
import multer from "multer";

const router = express.Router();
//use memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Apply authentication middleware to all routes
router.use(authenticateJWT);

// CRUD routes for media
router.get("/", getAllMedia);
router.get("/:id", getMediaById);
router.post("/", upload.single("file"), uploadMedia);
router.put("/:id", updateMedia);
router.delete("/:id", deleteMedia);

export default router; 