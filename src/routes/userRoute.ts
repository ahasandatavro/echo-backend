import express from "express";
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getContacts,
  updateSelectedContact,
  getUserByEmail,
  updateUserByEmail,
  getUserTagsAttributes,
  getTags,
  createTag,
  updateTag,
  deleteTag,
  getAllAttributes,
  createAttribute,
  updateAttribute,
  deleteAttribute,
  getBasicAttributes,
} from "../controllers/userController"
import multer from "multer";

const upload = multer({ dest: "uploads/" });
const router = express.Router();

router.get("/", getUsers);
router.get("/contacts", getContacts);
router.get("/email/:email", getUserByEmail);
router.post("/email/:email",upload.single("file"),updateUserByEmail);
router.post("/", createUser);
router.put("/selected-contact", updateSelectedContact);
router.get("/tags", getTags);
router.post("/tags", createTag);
router.put("/tags/:oldTag", updateTag);
router.delete("/tags/:tag", deleteTag);

router.get("/attributes", getBasicAttributes);
router.get("/attributes/all", getAllAttributes);
router.post("/attributes", createAttribute);
router.put("/attributes/:oldAttr", updateAttribute);
router.delete("/attributes/:attr", deleteAttribute);
router.get("/tags-attributes", getUserTagsAttributes);

router.get("/:id", getUserById);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);


export default router;
