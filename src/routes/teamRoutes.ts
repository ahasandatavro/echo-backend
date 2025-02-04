import express from "express";
import {
  getTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  addUsersToTeam,
  removeUsersFromTeam,
} from "../controllers/teamController";

const router = express.Router();

router.get("/", getTeams);
router.get("/:id", getTeamById);
router.post("/", createTeam);
router.put("/:id", updateTeam);
router.delete("/:id", deleteTeam);
router.post("/:id/add-users", addUsersToTeam);
router.post("/:id/remove-users", removeUsersFromTeam);

export default router;
