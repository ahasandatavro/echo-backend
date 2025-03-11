import express from "express";
import {
updateBusinessSettings,
getBusinessSettings
} from "../controllers/businessAccountController"
import multer from "multer";

//const upload = multer({ dest: "uploads/" });
const router = express.Router();

router.post("/", updateBusinessSettings);
router.get("/", getBusinessSettings);
//router.put("/:userId", getBusinessSettings);

export default router;
