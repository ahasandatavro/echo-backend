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