import express from "express";
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getContacts
} from "../controllers/userController"

const router = express.Router();

router.get("/", getUsers);
router.get("/contacts", getContacts);
router.get("/:id", getUserById);
router.post("/", createUser);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);


export default router;
