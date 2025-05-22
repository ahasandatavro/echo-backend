import { prisma } from "../../models/prismaClient";

interface Attribute {
    key: string;
    value: string;
  }
  
  export const  ProcessRulesForAttributes = async (
    existingAttributes: Attribute[],
    parsedAttributes: Attribute[],
    bp: any
  ) => {
    const addedAttributes: Attribute[] = [];
    const updatedAttributes: Attribute[] = [];
 
    const existingMap = new Map(existingAttributes.map(attr => [attr.key, attr.value]));
  
    for (const attr of parsedAttributes) {
      if (!existingMap.has(attr.key)) {
        addedAttributes.push(attr);
      } else if (existingMap.get(attr.key) !== attr.value) {
        updatedAttributes.push(attr);
      }
    }
  
    if (addedAttributes.length > 0) {
      //await handleNewAttributesAdded(addedAttributes, userId);
    }
  
    if (updatedAttributes.length > 0) {
     // await handleExistingAttributesUpdated(updatedAttributes, userId);
    }
  
    // Optional: detect removed attributes
    const parsedKeys = new Set(parsedAttributes.map(attr => attr.key));
    const removedAttributes = existingAttributes.filter(attr => !parsedKeys.has(attr.key));
  
    if (removedAttributes.length > 0) {
     // await handleAttributesRemoved(removedAttributes, userId);
    }
  };
  
  // Example implementations of handlers
  
  // const handleNewAttributesAdded = async (attrs: Attribute[], userId: number) => {
  //   const bp = await prisma.businessPhoneNumber.findFirst({
  //       where: {
  //         userId: userId,
  //       },
  //     });
  //   const activeRules = await prisma.rule.findMany({
  //       where: {
  //         businessPhoneNumberId: bp?.id,
  //         status: "Active",
  //         triggerType: "whatsappMessage",
  //       },
  //     });
      
  //     if (activeRules.length > 0) {
  //       for (const rule of activeRules) {
  //        // await processRuleForMessage(rule, sender, message, phoneNumberId, dbUser?.id);
  //       }
  //     }
  // };
  
  const handleExistingAttributesUpdated = async (attrs: Attribute[], userId: number) => {
    console.log("✏️ Existing attributes updated:", attrs);
    // Your logic here
  };
  
  const handleAttributesRemoved = async (attrs: Attribute[], userId: number) => {
    console.log("❌ Attributes removed:", attrs);
    // Your logic here
  };
  