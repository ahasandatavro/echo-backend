import { Router } from "express";
import { authenticateJWT } from '../middlewares/authMiddleware';
import { getUserAnalytics } from "../controllers/analyticsController";

const router = Router();

router.get("/", authenticateJWT, getUserAnalytics);

export default router;