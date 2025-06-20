import { Request, Response } from 'express';
import { getPackageConfiguration } from '../utils/packageUtils';

export const packageController = {
  async getAvailablePackages(req: Request, res: Response) {
    try {
      const packages = getPackageConfiguration();

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
      
      const packages = getPackageConfiguration();
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