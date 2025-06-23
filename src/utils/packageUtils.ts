import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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