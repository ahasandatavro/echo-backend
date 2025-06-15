import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * ✅ Get Default Action Settings for a specific BusinessPhoneNumber
 */

export const getDefaultActionSettings = async (req: Request, res: Response) => {
  const { businessPhoneNumberId } = req.params;
  const bp=await prisma.businessPhoneNumber.findFirst({
    where: { metaPhoneNumberId: businessPhoneNumberId},
    select: { id: true },
  });
  if (!bp){
    return res.status(400).json({ message: "Business PhoneNumber not found" });
  }
  try {
    const settings = await prisma.defaultActionSettings.findUnique({
      where: { businessPhoneNumberId: bp?.id },
    });

    if (!settings) {
      return res.status(200).json({ message: "Settings not created yet" });
    }

    // ✅ Ensure workingHours is always returned in the correct format
    const formattedWorkingHours = settings.workingHours || {
      Monday: { open: false, times: [] },
      Tuesday: { open: false, times: [] },
      Wednesday: { open: false, times: [] },
      Thursday: { open: false, times: [] },
      Friday: { open: false, times: [] },
      Saturday: { open: false, times: [] },
      Sunday: { open: false, times: [] },
    };

    // ✅ Format response properly
    const responsePayload = {
      businessPhoneNumberId: settings.businessPhoneNumberId,
      workingHours: formattedWorkingHours, // Ensure working hours are always structured properly

      // ✅ Checkbox states mapped correctly
      cb1: settings.outsideWorkingHoursEnabled || false,
      cb2: settings.noAgentOnlineEnabled || false,
      cb3: settings.fallbackMessageEnabled || false,
      cb4: settings.noResponseAfter24hEnabled || false,
      cb5: settings.expiredChatReassignmentDisabled || false,
      cb6: settings.noKeywordMatchReplyEnabled || false,
      cb7: settings.roundRobinAssignmentEnabled || false,
      cb8: settings.welcomeMessageEnabled || false,
      cb9: settings.waitingMessageEnabled || false,

      // ✅ Selected materials correctly formatted
      selectedMaterials: {
        cb1: settings.outsideWorkingHoursMaterialId
          ? {
              materialId: settings.outsideWorkingHoursMaterialId.toString(),
              materialType: settings.outsideWorkingHoursMaterialType,
            }
          : null,

        cb2: settings.noAgentOnlineMaterialId
          ? {
              materialId: settings.noAgentOnlineMaterialId.toString(),
              materialType: settings.noAgentOnlineMaterialType,
            }
          : null,

        cb3: settings.fallbackMessageMaterialId
          ? {
              materialId: settings.fallbackMessageMaterialId.toString(),
              materialType: settings.fallbackMessageMaterialType,
            }
          : null,

        cb4: settings.noResponseAfter24hMaterialId
          ? {
              materialId: settings.noResponseAfter24hMaterialId.toString(),
              materialType: settings.noResponseAfter24hMaterialType,
            }
          : null,
      },
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};


/**
 * ✅ Create or Update Default Action Settings for a specific BusinessPhoneNumber
 */
export const createOrUpdateDefaultActionSettings = async (req: Request, res: Response) => {
  const {
    businessPhoneNumberId,
    workingHours,
    selectedMaterials, // ✅ Contains cb1, cb2, etc. with materialId & materialType
    cb1, cb2, cb3, cb4, cb5, cb6, cb7, cb8,cb9 // ✅ Extract checkboxes
  } = req.body;

  try {
    // ✅ Mapping checkboxes to Prisma fields
    const bp=await prisma.businessPhoneNumber.findFirst({
      where: { metaPhoneNumberId: businessPhoneNumberId},
      select: { id: true },
    });
    if (!bp){
      return res.status(400).json({ message: "Business PhoneNumber not found" });
    }
    const updateData = {
      businessPhoneNumberId: bp?.id,
      workingHours,

      // ✅ Map checkbox flags to Prisma fields
      outsideWorkingHoursEnabled: cb1 || false,
      noAgentOnlineEnabled: cb2 || false,
      fallbackMessageEnabled: cb3 || false,
      noResponseAfter24hEnabled: cb4 || false,
      expiredChatReassignmentDisabled: cb5 || false,
      noKeywordMatchReplyEnabled: cb6 || false,
      roundRobinAssignmentEnabled: cb7 || false,
      welcomeMessageEnabled: cb8 || false,
      waitingMessageEnabled: cb9 || false,

      // ✅ Map selectedMaterials dynamically
      outsideWorkingHoursMaterialId: Number(selectedMaterials?.cb1?.materialId) || null,
      outsideWorkingHoursMaterialType: selectedMaterials?.cb1?.materialType || null,

      noAgentOnlineMaterialId: Number(selectedMaterials?.cb2?.materialId) || null,
      noAgentOnlineMaterialType: selectedMaterials?.cb2?.materialType || null,

      fallbackMessageMaterialId: Number(selectedMaterials?.cb3?.materialId) || null,
      fallbackMessageMaterialType: selectedMaterials?.cb3?.materialType || null,

      noResponseAfter24hMaterialId: Number(selectedMaterials?.cb4?.materialId) || null,
      noResponseAfter24hMaterialType: selectedMaterials?.cb4?.materialType || null,
    };

    // ✅ Check if settings already exist
    const existingSettings = await prisma.defaultActionSettings.findUnique({
      where: { businessPhoneNumberId: bp?.id },
    });

    if (existingSettings) {
      // ✅ Update existing settings
      const updatedSettings = await prisma.defaultActionSettings.update({
        where: { businessPhoneNumberId: bp?.id},
        data: updateData,
      });

      return res.status(200).json(updatedSettings);
    } else {
      // ✅ Create new settings
      const newSettings = await prisma.defaultActionSettings.create({
        data: updateData,
      });

      return res.status(201).json(newSettings);
    }
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};


/**
 * ✅ Delete Default Action Settings for a specific BusinessPhoneNumber
 */
export const deleteDefaultActionSettings = async (req: Request, res: Response) => {
  const { businessPhoneNumberId } = req.params;

  try {
    const existingSettings = await prisma.defaultActionSettings.findUnique({
      where: { businessPhoneNumberId: Number(businessPhoneNumberId) },
    });

    if (!existingSettings) {
      return res.status(404).json({ message: "Settings not found" });
    }

    await prisma.defaultActionSettings.delete({
      where: { businessPhoneNumberId: Number(businessPhoneNumberId) },
    });

    res.status(200).json({ message: "Settings deleted successfully" });
  } catch (error) {
    console.error("Error deleting settings:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
