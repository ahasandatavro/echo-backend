import { Router } from "express";
import { getAnalytics } from "../controllers/analyticsController";

const router = Router();

router.get("/", getAnalytics);

export default router;