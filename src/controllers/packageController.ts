import { Request, Response } from 'express';

interface PackagePricing {
  name: string;
  price: {
    monthly: number;
    yearly: number;
  };
  currency: string;
  canPurchase: boolean;
}

export const packageController = {
  async getAvailablePackages(req: Request, res: Response) {
    try {
      // Get package configuration from environment variable
      const packagesConfig = process.env.PACKAGES_CONFIG;
      
      let packages: PackagePricing[];
      
      if (packagesConfig) {
        try {
          const fullPackages = JSON.parse(packagesConfig);
          // Extract only pricing information
          packages = fullPackages.map((pkg: any) => ({
            name: pkg.name,
            price: pkg.price,
            currency: pkg.currency,
            canPurchase: pkg.canPurchase
          }));
        } catch (error) {
          console.error('Error parsing PACKAGES_CONFIG:', error);
          // Fallback to default configuration
          packages = getDefaultPackages();
        }
      } else {
        // Use default configuration if no environment variable is set
        packages = getDefaultPackages();
      }

      res.json({
        success: true,
        data: packages,
        message: 'Available packages retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching packages:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error while fetching packages'
      });
    }
  },

  async getPackageByName(req: Request, res: Response) {
    try {
      const { packageName } = req.params;
      
      // Get package configuration from environment variable
      const packagesConfig = process.env.PACKAGES_CONFIG;
      
      let packages: PackagePricing[];
      
      if (packagesConfig) {
        try {
          const fullPackages = JSON.parse(packagesConfig);
          // Extract only pricing information
          packages = fullPackages.map((pkg: any) => ({
            name: pkg.name,
            price: pkg.price,
            currency: pkg.currency,
            canPurchase: pkg.canPurchase
          }));
        } catch (error) {
          console.error('Error parsing PACKAGES_CONFIG:', error);
          // Fallback to default configuration
          packages = getDefaultPackages();
        }
      } else {
        // Use default configuration if no environment variable is set
        packages = getDefaultPackages();
      }

      const packageData = packages.find(pkg => pkg.name === packageName);

      if (!packageData) {
        return res.status(404).json({
          success: false,
          error: 'Package not found'
        });
      }

      res.json({
        success: true,
        data: packageData,
        message: 'Package retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching package:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error while fetching package'
      });
    }
  }
};

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