import express from "express";
import { 
    createRoutingMaterial, 
    getAllRoutingMaterials, 
    getRoutingMaterialById, 
    updateRoutingMaterial, 
    deleteRoutingMaterial 
} from "../controllers/routingMaterialController";

const router = express.Router();

router.post("/", createRoutingMaterial); // ✅ Create
router.get("/", getAllRoutingMaterials); // ✅ Read (All)
router.get("/:id", getRoutingMaterialById); // ✅ Read (Single)
router.put("/:id", updateRoutingMaterial); // ✅ Update
router.delete("/:id", deleteRoutingMaterial); // ✅ Delete

export default router;
