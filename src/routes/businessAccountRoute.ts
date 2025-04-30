import express from "express";
import {
updateBusinessSettings,
getBusinessSettings
} from "../controllers/businessAccountController"

//const upload = multer({ dest: "uploads/" });
const router = express.Router();
import multer from "multer";

const upload = multer({ dest: "uploads/" });
router.post("/", upload.single("file"), updateBusinessSettings);
router.get("/", getBusinessSettings);
//router.put("/:userId", getBusinessSettings);

export default router;
