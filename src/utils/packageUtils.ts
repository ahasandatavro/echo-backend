import { prisma } from "../models/prismaClient";

interface PackagePricing {
  name: string;
  price: {
    monthly: number;
    yearly: number;
  };
  currency: string;
  canPurchase: boolean;
}

export function getPackageConfiguration(): PackagePricing[] {
  const packagesConfig = process.env.PACKAGES_CONFIG;
  
  if (packagesConfig) {
    try {
      const fullPackages = JSON.parse(packagesConfig);
      // Extract only pricing information
      return fullPackages.map((pkg: any) => ({
        name: pkg.name,
        price: pkg.price,
        currency: pkg.currency,
        canPurchase: pkg.canPurchase
      }));
    } catch (error) {
      console.error('Error parsing PACKAGES_CONFIG:', error);
      // Fallback to default configuration
      return getDefaultPackages();
    }
  } else {
    // Use default configuration if no environment variable is set
    return getDefaultPackages();
  }
}

export function validatePackagePricing(
  packageName: string, 
  amount: number, 
  duration: 'monthly' | 'yearly'
): { isValid: boolean; expectedAmount?: number; error?: string } {
  const packages = getPackageConfiguration();
  const packageData = packages.find(pkg => pkg.name === packageName);

  if (!packageData) {
    return { 
      isValid: false, 
      error: 'Invalid package name' 
    };
  }

  if (!packageData.canPurchase) {
    return { 
      isValid: false, 
      error: 'This package cannot be purchased' 
    };
  }

  const expectedAmount = duration === 'monthly' 
    ? packageData.price.monthly 
    : packageData.price.yearly;

  if (amount !== expectedAmount) {
    return { 
      isValid: false, 
      expectedAmount, 
      error: `Invalid amount for ${packageName} package. Expected: ${expectedAmount}, Received: ${amount}` 
    };
  }

  return { isValid: true };
}

// Default package configuration (pricing only)
function getDefaultPackages(): PackagePricing[] {
  return [
    {
      name: 'Free',
      price: {
        monthly: 0,
        yearly: 0
      },
      currency: 'INR',
      canPurchase: false
    },
    {
      name: 'Growth',
      price: {
        monthly: 2499,
        yearly: 24990
      },
      currency: 'INR',
      canPurchase: true
    },
    {
      name: 'Pro',
      price: {
        monthly: 5999,
        yearly: 59990
      },
      currency: 'INR',
      canPurchase: true
    },
    {
      name: 'Business',
      price: {
        monthly: 16999,
        yearly: 169990
      },
      currency: 'INR',
      canPurchase: true
    }
  ];
}

// Get agent limits from environment variables
export function getAgentLimits(): { [key: string]: number } {
  const agentLimitsConfig = process.env.AGENT_LIMITS_CONFIG;
  
  if (agentLimitsConfig) {
    try {
      return JSON.parse(agentLimitsConfig);
    } catch (error) {
      console.error('Error parsing AGENT_LIMITS_CONFIG:', error);
      // Fallback to default configuration
      return getDefaultAgentLimits();
    }
  } else {
    // Use default configuration if no environment variable is set
    return getDefaultAgentLimits();
  }
}

// Default agent limits configuration
function getDefaultAgentLimits(): { [key: string]: number } {
  return {
    'Free': 0,
    'Growth': 3,
    'Pro': 3,
    'Business': 5
  };
}

export interface ContactLimitResult {
  allowed: boolean;
  currentCount: number;
  maxAllowed: number;
  packageName: string;
  message?: string;
}

export interface WebhookLimitResult {
  allowed: boolean;
  currentCount: number;
  maxAllowed: number;
  packageName: string;
  message?: string;
}

export interface KeywordLimitResult {
  allowed: boolean;
  currentCount: number;
  maxAllowed: number;
  packageName: string;
  message?: string;
}

export interface TemplateLimitResult {
  allowed: boolean;
  currentCount: number;
  maxAllowed: number;
  packageName: string;
  message?: string;
}

export interface MediaUploadLimitResult {
  allowed: boolean;
  currentCount: number;
  maxAllowed: number;
  packageName: string;
  message?: string;
}

export interface ChatAssignmentLimitResult {
  allowed: boolean;
  packageName: string;
  message?: string;
}

export const getContactLimitForPackage = (packageName: string): number => {
  const contactLimitsConfig = process.env.CONTACT_LIMITS_CONFIG;
  
  if (contactLimitsConfig) {
    try {
      const limits = JSON.parse(contactLimitsConfig);
      return limits[packageName] || parseInt(process.env.FREE_CONTACT_LIMIT || '10');
    } catch (error) {
      console.error('Error parsing CONTACT_LIMITS_CONFIG:', error);
      // Fallback to default configuration
      return getDefaultContactLimit(packageName);
    }
  } else {
    // Use default configuration if no environment variable is set
    return getDefaultContactLimit(packageName);
  }
};

export const getWebhookLimitForPackage = (packageName: string): number => {
  const webhookLimitsConfig = process.env.WEBHOOK_LIMITS_CONFIG;
  
  if (webhookLimitsConfig) {
    try {
      const limits = JSON.parse(webhookLimitsConfig);
      return limits[packageName] || getDefaultWebhookLimit(packageName);
    } catch (error) {
      console.error('Error parsing WEBHOOK_LIMITS_CONFIG:', error);
      // Fallback to default configuration
      return getDefaultWebhookLimit(packageName);
    }
  } else {
    // Use default configuration if no environment variable is set
    return getDefaultWebhookLimit(packageName);
  }
};

export const getKeywordLimitForPackage = (packageName: string): number => {
  const keywordLimitsConfig = process.env.KEYWORD_LIMITS_CONFIG;
  
  if (keywordLimitsConfig) {
    try {
      const limits = JSON.parse(keywordLimitsConfig);
      return limits[packageName] || getDefaultKeywordLimit(packageName);
    } catch (error) {
      console.error('Error parsing KEYWORD_LIMITS_CONFIG:', error);
      // Fallback to default configuration
      return getDefaultKeywordLimit(packageName);
    }
  } else {
    // Use default configuration if no environment variable is set
    return getDefaultKeywordLimit(packageName);
  }
};

// Default contact limits configuration
function getDefaultContactLimit(packageName: string): number {
  switch (packageName.toLowerCase()) {
    case 'free':
      return 10;
    case 'growth':
      return 10;
    case 'pro':
      return 10;
    case 'business':
      return 999999; // No limit for business
    default:
      return 10; // Default to free limit
  }
}

// Default webhook limits configuration
function getDefaultWebhookLimit(packageName: string): number {
  switch (packageName.toLowerCase()) {
    case 'free':
      return 0; // No webhooks for free
    case 'growth':
      return 0; // No webhooks for growth
    case 'pro':
      return 10; // Max 10 webhooks for pro
    case 'business':
      return 100; // Max 100 webhooks for business
    default:
      return 0; // Default to no webhooks
  }
}

// Default keyword limits configuration
function getDefaultKeywordLimit(packageName: string): number {
  switch (packageName.toLowerCase()) {
    case 'free':
      return 0; // No keywords for free
    case 'growth':
      return 100; // Max 100 keywords for growth
    case 'pro':
      return 500; // Max 500 keywords for pro
    case 'business':
      return 1000; // Max 1000 keywords for business
    default:
      return 0; // Default to no keywords
  }
}

export const checkContactLimit = async (userId: number, newContactsCount: number = 1): Promise<ContactLimitResult> => {
  try {
    // Get user's active subscription
    const activeSubscription = await prisma.packageSubscription.findFirst({
      where: {
        userId,
        isActive: true,
        startDate: {
          lte: new Date()
        },
        endDate: {
          gte: new Date()
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!activeSubscription) {
      return {
        allowed: false,
        currentCount: 0,
        maxAllowed: 0,
        packageName: 'No Subscription',
        message: 'No active subscription found. Please upgrade your package to create contacts.'
      };
    }

    const packageName = activeSubscription.packageName;
    const maxAllowed = getContactLimitForPackage(packageName);

    // If it's business package, no limit
    if (packageName.toLowerCase() === 'business') {
      return {
        allowed: true,
        currentCount: 0,
        maxAllowed,
        packageName
      };
    }

    // Count existing contacts for this user
    const currentCount = await prisma.contact.count({
      where: {
        createdById: userId
      }
    });

    const totalAfterAddition = currentCount + newContactsCount;
    const allowed = totalAfterAddition <= maxAllowed;

    return {
      allowed,
      currentCount,
      maxAllowed,
      packageName,
      message: allowed ? undefined : `Contact limit exceeded. You have ${currentCount} contacts and your ${packageName} package allows maximum ${maxAllowed} contacts. Please upgrade to Business package for unlimited contacts.`
    };
  } catch (error) {
    console.error('Error checking contact limit:', error);
    return {
      allowed: false,
      currentCount: 0,
      maxAllowed: 0,
      packageName: 'Error',
      message: 'Error checking contact limits. Please try again.'
    };
  }
};

export const checkWebhookLimit = async (userId: number, businessPhoneNumberId: number, newWebhooksCount: number = 1): Promise<WebhookLimitResult> => {
  try {
    // Get user's active subscription
    const activeSubscription = await prisma.packageSubscription.findFirst({
      where: {
        userId,
        isActive: true,
        startDate: {
          lte: new Date()
        },
        endDate: {
          gte: new Date()
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!activeSubscription) {
      return {
        allowed: false,
        currentCount: 0,
        maxAllowed: 0,
        packageName: 'No Subscription',
        message: 'No active subscription found. Please upgrade your package to create webhooks.'
      };
    }

    const packageName = activeSubscription.packageName;
    const maxAllowed = getWebhookLimitForPackage(packageName);

    // If maxAllowed is 0, no webhooks allowed
    if (maxAllowed === 0) {
      return {
        allowed: false,
        currentCount: 0,
        maxAllowed: 0,
        packageName,
        message: `Webhook creation is not available in your ${packageName} package. Please upgrade to Pro or Business package to create webhooks.`
      };
    }

    // Count existing webhooks for this business phone number
    const currentCount = await prisma.webhook.count({
      where: {
        businessPhoneNumberId
      }
    });

    const totalAfterAddition = currentCount + newWebhooksCount;
    const allowed = totalAfterAddition <= maxAllowed;

    return {
      allowed,
      currentCount,
      maxAllowed,
      packageName,
      message: allowed ? undefined : `Webhook limit exceeded. You have ${currentCount} webhooks and your ${packageName} package allows maximum ${maxAllowed} webhooks. Please upgrade to Business package for more webhooks.`
    };
  } catch (error) {
    console.error('Error checking webhook limit:', error);
    return {
      allowed: false,
      currentCount: 0,
      maxAllowed: 0,
      packageName: 'Error',
      message: 'Error checking webhook limits. Please try again.'
    };
  }
};

export const checkKeywordLimit = async (userId: number, newKeywordsCount: number = 1): Promise<KeywordLimitResult> => {
  try {
    // Get user's active subscription
    const activeSubscription = await prisma.packageSubscription.findFirst({
      where: {
        userId,
        isActive: true,
        startDate: {
          lte: new Date()
        },
        endDate: {
          gte: new Date()
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!activeSubscription) {
      return {
        allowed: false,
        currentCount: 0,
        maxAllowed: 0,
        packageName: 'No Subscription',
        message: 'No active subscription found. Please upgrade your package to create keywords.'
      };
    }

    const packageName = activeSubscription.packageName;
    const maxAllowed = getKeywordLimitForPackage(packageName);

    // If maxAllowed is 0, no keywords allowed
    if (maxAllowed === 0) {
      return {
        allowed: false,
        currentCount: 0,
        maxAllowed: 0,
        packageName,
        message: `Keyword creation is not available in your ${packageName} package. Please upgrade to Growth, Pro, or Business package to create keywords.`
      };
    }

    // Count existing keywords for this user
    const currentCount = await prisma.keyword.count({
      where: {
        userId
      }
    });

    const totalAfterAddition = currentCount + newKeywordsCount;
    const allowed = totalAfterAddition <= maxAllowed;

    return {
      allowed,
      currentCount,
      maxAllowed,
      packageName,
      message: allowed ? undefined : `Keyword limit exceeded. You have ${currentCount} keywords and your ${packageName} package allows maximum ${maxAllowed} keywords. Please upgrade to Business package for more keywords.`
    };
  } catch (error) {
    console.error('Error checking keyword limit:', error);
    return {
      allowed: false,
      currentCount: 0,
      maxAllowed: 0,
      packageName: 'Error',
      message: 'Error checking keyword limits. Please try again.'
    };
  }
};

export const getTemplateLimitForPackage = (packageName: string): number => {
  const templateLimitsConfig = process.env.TEMPLATE_LIMITS_CONFIG;
  
  if (templateLimitsConfig) {
    try {
      const limits = JSON.parse(templateLimitsConfig);
      return limits[packageName] || getDefaultTemplateLimit(packageName);
    } catch (error) {
      console.error('Error parsing TEMPLATE_LIMITS_CONFIG:', error);
      // Fallback to default configuration
      return getDefaultTemplateLimit(packageName);
    }
  } else {
    // Use default configuration if no environment variable is set
    return getDefaultTemplateLimit(packageName);
  }
};

function getDefaultTemplateLimit(packageName: string): number {
  switch (packageName) {
    case 'Free':
      return 1;
    case 'Growth':
      return 100;
    case 'Pro':
      return 500;
    case 'Business':
      return 1000;
    default:
      return 1; // Default to Free limit
  }
}

export const checkTemplateLimit = async (userId: number, newTemplatesCount: number = 1): Promise<TemplateLimitResult> => {
  try {
    // Get user's active subscription
    const activeSubscription = await prisma.packageSubscription.findFirst({
      where: {
        userId,
        isActive: true,
        startDate: {
          lte: new Date()
        },
        endDate: {
          gte: new Date()
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!activeSubscription) {
      return {
        allowed: false,
        currentCount: 0,
        maxAllowed: 0,
        packageName: 'No Subscription',
        message: 'No active subscription found. Please upgrade your package to create templates.'
      };
    }

    const packageName = activeSubscription.packageName;
    const maxAllowed = getTemplateLimitForPackage(packageName);

    // Count existing templates for this user
    const currentCount = await prisma.template.count({
      where: { userId }
    });

    const allowed = currentCount + newTemplatesCount <= maxAllowed;

    return {
      allowed,
      currentCount,
      maxAllowed,
      packageName,
      message: allowed ? undefined : `Template limit exceeded. You have ${currentCount} templates and your ${packageName} package allows maximum ${maxAllowed} templates. Please upgrade your package to create more templates.`
    };
  } catch (error) {
    console.error('Error checking template limit:', error);
    return {
      allowed: false,
      currentCount: 0,
      maxAllowed: 0,
      packageName: 'Error',
      message: 'Error checking template limit. Please try again.'
    };
  }
};

// Media Upload Limits
export const getMediaUploadLimitForPackage = (packageName: string): number => {
  const mediaUploadLimitsConfig = process.env.MEDIA_UPLOAD_LIMITS_CONFIG;
  
  if (mediaUploadLimitsConfig) {
    try {
      const limits = JSON.parse(mediaUploadLimitsConfig);
      return limits[packageName] || parseInt(process.env.FREE_MEDIA_UPLOAD_LIMIT || '2');
    } catch (error) {
      console.error('Error parsing MEDIA_UPLOAD_LIMITS_CONFIG:', error);
      // Fallback to default configuration
      return getDefaultMediaUploadLimit(packageName);
    }
  } else {
    // Use default configuration if no environment variable is set
    return getDefaultMediaUploadLimit(packageName);
  }
};

function getDefaultMediaUploadLimit(packageName: string): number {
  switch (packageName) {
    case 'Free':
      return 2;
    case 'Growth':
      return 100;
    case 'Pro':
      return 500;
    case 'Business':
      return 1000;
    default:
      return 2; // Default to Free limit
  }
}

export const checkMediaUploadLimit = async (userId: number, newMediaCount: number = 1): Promise<MediaUploadLimitResult> => {
  try {
    // Get user's active subscription
    const activeSubscription = await prisma.packageSubscription.findFirst({
      where: {
        userId,
        isActive: true,
        startDate: {
          lte: new Date()
        },
        endDate: {
          gte: new Date()
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!activeSubscription) {
      return {
        allowed: false,
        currentCount: 0,
        maxAllowed: 0,
        packageName: 'No Subscription',
        message: 'No active subscription found. Please upgrade your package to upload media files.'
      };
    }

    const packageName = activeSubscription.packageName;
    const maxAllowed = getMediaUploadLimitForPackage(packageName);

    // Count existing media files for this user
    const currentCount = await prisma.media.count({
      where: { userId }
    });

    const allowed = currentCount + newMediaCount <= maxAllowed;

    return {
      allowed,
      currentCount,
      maxAllowed,
      packageName,
      message: allowed ? undefined : `Media upload limit exceeded. You have ${currentCount} media files and your ${packageName} package allows maximum ${maxAllowed} media files. Please upgrade your package to upload more media files.`
    };
  } catch (error) {
    console.error('Error checking media upload limit:', error);
    return {
      allowed: false,
      currentCount: 0,
      maxAllowed: 0,
      packageName: 'Error',
      message: 'Error checking media upload limit. Please try again.'
    };
  }
};

// Chat Assignment Limits
export const getChatAssignmentAccessForPackage = (packageName: string): boolean => {
  const chatAssignmentConfig = process.env.CHAT_ASSIGNMENT_ACCESS_CONFIG;
  
  if (chatAssignmentConfig) {
    try {
      const config = JSON.parse(chatAssignmentConfig);
      return config[packageName] || false;
    } catch (error) {
      console.error('Error parsing CHAT_ASSIGNMENT_ACCESS_CONFIG:', error);
      // Fallback to default configuration
      return getDefaultChatAssignmentAccess(packageName);
    }
  } else {
    // Use default configuration if no environment variable is set
    return getDefaultChatAssignmentAccess(packageName);
  }
};

function getDefaultChatAssignmentAccess(packageName: string): boolean {
  switch (packageName) {
    case 'Free':
      return false; // Block proceeding further
    case 'Growth':
    case 'Pro':
    case 'Business':
      return true; // Let proceed
    default:
      return false; // Default to blocked
  }
}

export const checkChatAssignmentAccess = async (userId: number): Promise<ChatAssignmentLimitResult> => {
  try {
    // Get user's active subscription
    const activeSubscription = await prisma.packageSubscription.findFirst({
      where: {
        userId,
        isActive: true,
        startDate: {
          lte: new Date()
        },
        endDate: {
          gte: new Date()
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!activeSubscription) {
      return {
        allowed: false,
        packageName: 'No Subscription',
        message: 'No active subscription found. Please upgrade your package to access chat assignment features.'
      };
    }

    const packageName = activeSubscription.packageName;
    const allowed = getChatAssignmentAccessForPackage(packageName);

    return {
      allowed,
      packageName,
      message: allowed ? undefined : `Chat assignment features are not available in your ${packageName} package. Please upgrade to Growth, Pro, or Business package to access chat assignment features.`
    };
  } catch (error) {
    console.error('Error checking chat assignment access:', error);
    return {
      allowed: false,
      packageName: 'Error',
      message: 'Error checking chat assignment access. Please try again.'
    };
  }
};

export interface PackageAccessResult {
  allowed: boolean;
  packageName: string;
  message?: string;
}

export const checkPackageAccess = async (userId: number, requiredPackage: string = 'Business'): Promise<PackageAccessResult> => {
  try {
    // Get user's active subscription
    const activeSubscription = await prisma.packageSubscription.findFirst({
      where: {
        userId,
        isActive: true,
        startDate: {
          lte: new Date()
        },
        endDate: {
          gte: new Date()
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!activeSubscription) {
      return {
        allowed: false,
        packageName: 'No Subscription',
        message: 'No active subscription found. Please upgrade your package to access this feature.'
      };
    }

    const packageName = activeSubscription.packageName;
    
    // Define package hierarchy (higher index = more features)
    const packageHierarchy = ['Free', 'Growth', 'Pro', 'Business'];
    const userPackageIndex = packageHierarchy.indexOf(packageName);
    const requiredPackageIndex = packageHierarchy.indexOf(requiredPackage);

    const allowed = userPackageIndex >= requiredPackageIndex;

    return {
      allowed,
      packageName,
      message: allowed ? undefined : `This feature is only available for ${requiredPackage} package and above. Your current package is ${packageName}. Please upgrade to ${requiredPackage} package to access this feature.`
    };
  } catch (error) {
    console.error('Error checking package access:', error);
    return {
      allowed: false,
      packageName: 'Error',
      message: 'Error checking package access. Please try again.'
    };
  }
};

export const checkFeatureAccess = async (userId: number, featureName: string): Promise<PackageAccessResult> => {
  try {
    // Get user's active subscription
    const activeSubscription = await prisma.packageSubscription.findFirst({
      where: {
        userId,
        isActive: true,
        startDate: {
          lte: new Date()
        },
        endDate: {
          gte: new Date()
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!activeSubscription) {
      return {
        allowed: false,
        packageName: 'No Subscription',
        message: 'No active subscription found. Please upgrade your package to access this feature.'
      };
    }

    const packageName = activeSubscription.packageName;
    
    // Get feature access configuration from environment
    const featureAccessConfig = process.env.FEATURE_ACCESS_CONFIG;
    let requiredPackages: string[] = [];
    
    if (featureAccessConfig) {
      try {
        const config = JSON.parse(featureAccessConfig);
        requiredPackages = config[featureName] || ['Business']; // Default to Business if not configured
      } catch (error) {
        console.error('Error parsing FEATURE_ACCESS_CONFIG:', error);
        requiredPackages = ['Business']; // Default fallback
      }
    } else {
      // Fallback to individual feature configs
      const individualConfig = process.env[`${featureName.toUpperCase()}_REQUIRED_PACKAGES`];
      if (individualConfig) {
        try {
          requiredPackages = JSON.parse(individualConfig);
        } catch (error) {
          console.error(`Error parsing ${featureName.toUpperCase()}_REQUIRED_PACKAGES:`, error);
          requiredPackages = ['Business']; // Default fallback
        }
      } else {
        requiredPackages = ['Business']; // Default fallback
      }
    }

    // Define package hierarchy (higher index = more features)
    const packageHierarchy = ['Free', 'Growth', 'Pro', 'Business'];
    const userPackageIndex = packageHierarchy.indexOf(packageName);
    
    // Check if user's package is directly in the required packages list
    if (requiredPackages.includes(packageName)) {
      return {
        allowed: true,
        packageName,
        message: undefined
      };
    }
    
    // Check if user's package is higher than any of the required packages
    const hasHigherPackage = requiredPackages.some(reqPackage => {
      const reqPackageIndex = packageHierarchy.indexOf(reqPackage);
      return userPackageIndex > reqPackageIndex;
    });

    // Find the minimum required package for better error messages
    const minRequiredPackage = requiredPackages.reduce((min, current) => {
      const minIndex = packageHierarchy.indexOf(min);
      const currentIndex = packageHierarchy.indexOf(current);
      return currentIndex < minIndex ? current : min;
    }, 'Business');

    return {
      allowed: hasHigherPackage,
      packageName,
      message: hasHigherPackage ? undefined : `This feature is only available for ${minRequiredPackage} package and above. Your current package is ${packageName}. Please upgrade to ${minRequiredPackage} package to access this feature.`
    };
  } catch (error) {
    console.error('Error checking feature access:', error);
    return {
      allowed: false,
      packageName: 'Error',
      message: 'Error checking feature access. Please try again.'
    };
  }
};

export const checkBroadcastAccess = async (userId: number): Promise<PackageAccessResult> => {
  try {
    // Get user's active subscription
    const activeSubscription = await prisma.packageSubscription.findFirst({
      where: {
        userId,
        isActive: true,
        startDate: {
          lte: new Date()
        },
        endDate: {
          gte: new Date()
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!activeSubscription) {
      return {
        allowed: false,
        packageName: 'No Subscription',
        message: 'No active subscription found. Please upgrade your package to access broadcast features.'
      };
    }

    const packageName = activeSubscription.packageName;
    
    // Get broadcast access configuration from environment
    const broadcastAccessConfig = process.env.BROADCAST_ACCESS_CONFIG;
    let restrictedPackages: string[] = [];
    
    if (broadcastAccessConfig) {
      try {
        const config = JSON.parse(broadcastAccessConfig);
        restrictedPackages = config.restrictedPackages || ['Free', 'Pro']; // Default restricted packages
      } catch (error) {
        console.error('Error parsing BROADCAST_ACCESS_CONFIG:', error);
        restrictedPackages = ['Free', 'Pro']; // Default fallback
      }
    } else {
      // Fallback to default restricted packages
      restrictedPackages = ['Free', 'Pro'];
    }

    // Check if user's package is in the restricted list
    const isRestricted = restrictedPackages.includes(packageName);
    
    if (isRestricted) {
      return {
        allowed: false,
        packageName,
        message: `Broadcast features are not available in your ${packageName} package. Please upgrade to Growth or Business package to access broadcast features.`
      };
    }

    return {
      allowed: true,
      packageName,
      message: undefined
    };
  } catch (error) {
    console.error('Error checking broadcast access:', error);
    return {
      allowed: false,
      packageName: 'Error',
      message: 'Error checking broadcast access. Please try again.'
    };
  }
}; 