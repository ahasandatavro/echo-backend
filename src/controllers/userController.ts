import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from 'bcrypt';
import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import { json } from "body-parser";
const prisma = new PrismaClient();
interface UserResponse {
  id: number;
  firstName?: string;
  lastName?: string;
  email: string;
  phoneNumber?: string;
  role: string;
  team: string; // Comma-separated team names
}
// Get all users with pagination
export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "5" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const users = await prisma.user.findMany({
      skip,
      take: parseInt(limit as string),
      include: {
        teams: {
          select: {
            name: true,
          },
        },
      },
    });
    const formattedUsers: UserResponse[] = users.map((user) => ({
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phoneNumber: user.phoneNumber|| "",
        role: user.role|| "USER",
        team: user.teams.map((team) => team.name).join(", "), // Convert teams to comma-separated string
      }));
  
      const totalRows = await prisma.user.count();
      res.json({ data: formattedUsers, totalRows });
  } catch (error) {
    res.status(500).json({ error: "Error fetching users" });
  }
};

// Get a single user by ID
export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.params.id) },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const formattedUser: any = {
      id: user.id,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      phoneNumber: user.phoneNumber|| "",
      role: user.role|| "USER", 
    };
    res.json(formattedUser);
  } catch (error) {
    res.status(500).json({ error: "Error fetching user" });
  }
};


export const getUserByEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.params;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const phoneNumberRecord = await prisma.businessPhoneNumber.findFirst({
      where: {
        metaPhoneNumberId: user.selectedPhoneNumberId || "",
      },
    });

    // Format the base user data from the local database
    const formattedUser: any = {
      id: user.id,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      phoneNumber: user.phoneNumber || "",
      about: user.about || "",
      businessAddress: user.businessAddress || "",
      businessDescription: user.businessDescription || "",
      businessIndustry: user.businessIndustry || "Other",
      image: user.image || "",
      website1: user.website1 || "",
      website2: user.website2 || "",
      phone_number: phoneNumberRecord?.phoneNumber,
      role: user.role || "USER",
    };

    // If selectedPhoneNumberId exists, fetch WhatsApp business profile from Facebook Graph API
    if (user.selectedPhoneNumberId) {
      const fbUrl = `https://graph.facebook.com/v22.0/${user.selectedPhoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`;
      const accessToken = process.env.META_ACCESS_TOKEN;
      if (!accessToken) {
        console.error("Facebook access token is not set");
      } else {
        try {
          const fbResponse = await axios.get(fbUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
          const fbData = fbResponse.data.data[0];
          // Override or merge fields from the Facebook response if available
          formattedUser.about = fbData.about || formattedUser.about;
          formattedUser.businessAddress = fbData.address || formattedUser.businessAddress;
          formattedUser.businessDescription = fbData.description || formattedUser.businessDescription;
          formattedUser.email = fbData.email || formattedUser.email;
          formattedUser.image = fbData.profile_picture_url || formattedUser.image;
          if (fbData.websites && Array.isArray(fbData.websites)) {
            formattedUser.website1 = fbData.websites[0] || formattedUser.website1;
            formattedUser.website2 = fbData.websites[1] || formattedUser.website2;
          }
        } catch (fbError) {
          console.error("Error fetching WhatsApp business profile from Facebook:", fbError);
        }
      }
    }

    res.json(formattedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching user" });
  }
};

export const updateUserByEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Get the email from URL params and retrieve the user.
    const { email } = req.params;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // 2. Extract additional fields from the request body.
    // 'websites' is expected to be an array (e.g. [website1, website2]).
    const { about, address, description, vertical, websites } = req.body;
     const webs=JSON.parse(websites);
    // 3. Set initial profilePictureHandle from the existing user record.
    let profilePictureHandle = user.image;

    // 4. If a new image file is provided (as req.file), process it to obtain a new media handle.
    if (req.file) {
      const filePath = req.file.path;

      // Step 4a: Initiate the media upload to WhatsApp via Facebook API.
      const mediaUploadResponse = await axios.post(
        `${process.env.META_BASE_URL}/${process.env.META_APP_ID}/uploads`,
        null,
        {
          params: {
            file_name: req.file.originalname,
            file_length: req.file.size,
            file_type: req.file.mimetype,
            access_token: process.env.META_ACCESS_TOKEN,
          },
          headers: {
            Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          },
        }
      );
      const mediaUploadId = mediaUploadResponse.data.id; // e.g. "upload:1233"

      // Optionally, you can try to retrieve the media URL here if needed.
      // Step 4b: Upload the file chunk using FormData.
      const form = new FormData();
      form.append("file_offset", "0");
      form.append("file", fs.createReadStream(filePath));
      const fileSize = fs.statSync(filePath).size;
      const headers = {
        Authorization: `OAuth ${process.env.META_ACCESS_TOKEN}`,
        file_offset: "0",
        "Content-Length": fileSize,
        ...form.getHeaders(),
      };
      const mediaIdResponse = await axios.post(
        `${process.env.META_BASE_URL}/${mediaUploadId}`,
        form,
        { headers }
      );

      // If upload is successful, update the profile picture handle.
      if (mediaIdResponse.data && mediaIdResponse.data.h) {
        profilePictureHandle = mediaIdResponse.data.h;
      } else {
        res.status(400).json({ error: "Failed to upload media to WhatsApp" });
        return;
      }
    }

    // 5. Prepare the payload to update the WhatsApp Business Profile.
    if (user.selectedPhoneNumberId) {
      const fbUrl = `https://graph.facebook.com/v22.0/${user.selectedPhoneNumberId}/whatsapp_business_profile`;
      const fbPayload = {
        messaging_product: "whatsapp",
        about,
        address,
        description,
        vertical,
        email, // using the email from the URL params or body
        website:JSON.parse(websites), // expects an array
        // profile_picture_handle: profilePictureHandle,
      };

      // Make the POST request to Facebook's API.
      const fbResponse = await axios.post(fbUrl, fbPayload, {
        headers: {
          "Authorization": `Bearer ${process.env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      });

      // Check if Facebook update was successful (you may adjust based on fbResponse data).
      if (fbResponse.status !== 200 && fbResponse.status !== 201) {
        res.status(400).json({ error: "Failed to update WhatsApp Business Profile on Facebook" });
        return;
      }
    } else {
      res.status(400).json({ error: "User does not have a selected phone number ID" });
      return;
    }

    // 6. Only after the Facebook API call succeeds, update the user record in the local database.
    const updatedUser = await prisma.user.update({
      where: { email },
      data: {
        about: about ?? user.about,
        businessAddress: address ?? user.businessAddress,
        businessDescription: description ?? user.businessDescription,
        businessIndustry: vertical ?? user.businessIndustry,
        // image: profilePictureHandle,
        website1: websites && websites[0] ? websites[0] : user.website1,
        website2: websites && websites[1] ? websites[1] : user.website2,
      },
    });

    res.json({ message: "User updated successfully", updatedUser });
  } catch (error: any) {
    console.error("Error updating user:", error);
    res.status(500).json({
      error: "Error updating user",
      details: error.response?.data || error.message,
    });
  }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, role, firstName, lastName, phoneNumber } = req.body;

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ error: "Email already exists" });
      return;
    }
 const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: { email, password:hashedPassword, role, firstName, lastName, phoneNumber },
    });
    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ error: "Error creating user" });
  }
};

// Update user by ID
export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, phoneNumber, role } = req.body;
    const updatedUser = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { firstName, lastName, phoneNumber, role },
    });
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: "Error updating user" });
  }
};

// Delete user
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.user.delete({
      where: { id: parseInt(req.params.id) },
    });
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error deleting user" });
  }
};



export const getContacts = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the logged-in user's ID (set by your auth middleware)
    const user:any=req.user;
    const userId:any = user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Retrieve the user's business account and its associated phone numbers
    const businessAccounts = await prisma.businessAccount.findMany({
      where: { userId },
      include: { phoneNumbers: true },
    });

    if (!businessAccounts|| businessAccounts.length === 0) {
      res.status(404).json({ error: "Business account not found" });
      return;
    }

    // Map the phone numbers to the expected UI format
    const groupedContacts = businessAccounts.map((account) => ({
      businessAccountId: account.metaWabaId,
      phoneNumbers: account.phoneNumbers.map((phone) => ({
        displayName: phone.displayName || "",
        phoneNumber: phone.phoneNumber || "",
        phoneNumberId: phone.metaPhoneNumberId,
        connectionStatus: phone.connectionStatus || "",
        subscription: phone.subscription || "",
      })),
    }));

    res.status(200).json(groupedContacts);
  } catch (error: any) {
    console.error("Error retrieving contacts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};


export const updateSelectedContact = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the logged-in user's ID (assumed to be set by your authentication middleware)
    const user:any = req.user; // Replace with actual user id retrieval
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Get the selected phone number id and waba id from the request body
    const { selectedPhoneNumberId, selectedWabaId } = req.body;
    if (!selectedPhoneNumberId || !selectedWabaId) {
      res.status(400).json({ error: "Both selectedPhoneNumberId and selectedWabaId are required" });
      return;
    }

    // Update the user record
    const updatedUser = await prisma.user.update({
      where: { id: user.userId },
      data: {
        selectedPhoneNumberId,
        selectedWabaId,
      },
    });

    res.status(200).json(updatedUser.id);
  } catch (error: any) {
    console.error("Error updating selected contact:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};


export const getUserTagsAttributes = async (req: Request, res: Response) => {
  try {

       const reqUser: any = req.user;
        const user = await prisma.user.findFirst({
          where: { id: reqUser.userId },
        });
    
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        if (!user.selectedWabaId) {
          return res.status(400).json({ error: "User does not have a selected WABA ID" });
        }
    

    res.json({
      tags: user.tags || [],
      attributes: user.attributes || {},
    });
  } catch (error: any) {
    console.error("Error fetching user tags/attributes:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};

/** ----------------------------------
 *            TAGS
 * ---------------------------------- */

// GET /users/:id/tags?search=&page=&rowsPerPage=
export const getTags = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const user = await prisma.user.findFirst({
      where: { id: reqUser.userId },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    const search = (req.query.search as string) || "";
    const page = parseInt(req.query.page as string, 10) || 1;
    const rowsPerPage = parseInt(req.query.rowsPerPage as string, 10) || 5;
    
    const allTags = user.tags || [];
    // Filter by search
    const filtered = allTags.filter((tag) =>
      tag.toLowerCase().includes(search.toLowerCase())
    );
    // Pagination
    const totalRows = filtered.length;
    const startIndex = (page - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    //const pageData = filtered.slice(startIndex, endIndex);
    const pageData = allTags;

    return res.json({
      data: pageData,
      totalRows,
      currentPage: page,
      rowsPerPage,
    });
  } catch (error: any) {
    console.error("Error getting tags:", error);
    return res.status(500).json({ error: error.message });
  }
};

// POST /users/tags  { "tag": "newTag" }
export const createTag = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const user = await prisma.user.findFirst({
      where: { id: reqUser.userId },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    const { tag } = req.body;

    if (!tag) return res.status(400).json({ error: "Tag is required" });

    const allTags = user.tags || [];
    if (allTags.includes(tag)) {
      return res.status(400).json({ error: "Tag already exists" });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { tags: [...allTags, tag] },
    });

    res.json({ message: "Tag created", tags: updatedUser.tags });
  } catch (error: any) {
    console.error("Error creating tag:", error);
    return res.status(500).json({ error: error.message });
  }
};

// PUT /users/:id/tags/:oldTag   { "newTag": "renamedTag" }
export const updateTag = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const user = await prisma.user.findFirst({
      where: { id: reqUser.userId },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    const { oldTag } = req.params;
    const { newTag } = req.body;

    const allTags = user.tags || [];
    if (!allTags.includes(oldTag)) {
      return res.status(404).json({ error: "Tag not found" });
    }
    if (allTags.includes(newTag)) {
      return res.status(400).json({ error: "New tag name already exists" });
    }

    // Replace oldTag with newTag
    const updatedTags = allTags.map((t) => (t === oldTag ? newTag : t));

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { tags: updatedTags },
    });

    res.json({ message: "Tag updated", tags: updatedUser.tags });
  } catch (error: any) {
    console.error("Error updating tag:", error);
    return res.status(500).json({ error: error.message });
  }
};

// DELETE /users/:id/tags/:tag
export const deleteTag = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const user = await prisma.user.findFirst({
      where: { id: reqUser.userId },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    const tagToDelete = req.params.tag;

    const updatedTags = user.tags.filter((t) => t !== tagToDelete);

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { tags: updatedTags },
    });

    res.json({ message: "Tag deleted", tags: updatedUser.tags });
  } catch (error: any) {
    console.error("Error deleting tag:", error);
    return res.status(500).json({ error: error.message });
  }
};

/** ----------------------------------
 *         ATTRIBUTES
 * ---------------------------------- */

// GET /users/:id/attributes?search=&page=&rowsPerPage=
export const getAttributes = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const user = await prisma.user.findFirst({
      where: { id: reqUser.userId },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    const search = (req.query.search as string) || "";
    const page = parseInt(req.query.page as string, 10) || 1;
    const rowsPerPage = parseInt(req.query.rowsPerPage as string, 10) || 5;
    // If attributes is an array of strings:
    const allAttrs = (user.attributes as string[]) || [];
    const filtered = allAttrs.filter((attr) =>
      attr.toLowerCase().includes(search.toLowerCase())
    );

    const totalRows = filtered.length;
    const startIndex = (page - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
   // const pageData = filtered.slice(startIndex, endIndex);
   const pageData =allAttrs;

    return res.json({
      data: pageData,
      totalRows,
      currentPage: page,
      rowsPerPage,
    });
  } catch (error: any) {
    console.error("Error getting attributes:", error);
    return res.status(500).json({ error: error.message });
  }
};

// POST /users/attributes  { "attribute": "newAttr" }
export const createAttribute = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const user = await prisma.user.findFirst({
      where: { id: reqUser.userId },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    const { attribute } = req.body;

    if (!attribute) return res.status(400).json({ error: "Attribute is required" });

    const allAttrs = (user.attributes as string[]) || [];
    if (allAttrs.includes(attribute)) {
      return res.status(400).json({ error: "Attribute already exists" });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { attributes: [...allAttrs, attribute] },
    });

    res.json({ message: "Attribute created", attributes: updatedUser.attributes });
  } catch (error: any) {
    console.error("Error creating attribute:", error);
    return res.status(500).json({ error: error.message });
  }
};

// PUT /users/:id/attributes/:oldAttr   { "newAttr": "renamedAttr" }
export const updateAttribute = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const user = await prisma.user.findFirst({
      where: { id: reqUser.userId },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    const { oldAttr } = req.params;
    const { newAttr } = req.body;

    const allAttrs = (user.attributes as string[]) || [];
    if (!allAttrs.includes(oldAttr)) {
      return res.status(404).json({ error: "Attribute not found" });
    }
    if (allAttrs.includes(newAttr)) {
      return res.status(400).json({ error: "New attribute name already exists" });
    }

    const updatedAttrs = allAttrs.map((a) => (a === oldAttr ? newAttr : a));

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { attributes: updatedAttrs },
    });

    res.json({ message: "Attribute updated", attributes: updatedUser.attributes });
  } catch (error: any) {
    console.error("Error updating attribute:", error);
    return res.status(500).json({ error: error.message });
  }
};

// DELETE /users/:id/attributes/:attr
export const deleteAttribute = async (req: Request, res: Response) => {
  try {
    const reqUser: any = req.user;
    const user = await prisma.user.findFirst({
      where: { id: reqUser.userId },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    const attrToDelete = req.params.attr;

    const allAttrs = (user.attributes as string[]) || [];
    const updatedAttrs = allAttrs.filter((a) => a !== attrToDelete);

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { attributes: updatedAttrs },
    });

    res.json({ message: "Attribute deleted", attributes: updatedUser.attributes });
  } catch (error: any) {
    console.error("Error deleting attribute:", error);
    return res.status(500).json({ error: error.message });
  }
};
