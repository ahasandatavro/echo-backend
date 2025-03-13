import express from "express";
import { createAgent, updateAgent, deleteAgent} from "../controllers/agentController"

const router = express.Router();

router.post("/", createAgent); // Create Agent
router.put("/:id", updateAgent); // Update Agent
router.delete("/:id",  deleteAgent); // Delete Agent

export default router;
