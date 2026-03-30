import fs from 'fs';
import https from 'https';
import path from 'path';

let httpsOptions: https.ServerOptions = {};

try {
  // Check if certs directory exists
  const certsDir = path.join(__dirname, '../../certs');
  if (!fs.existsSync(certsDir)) {
    console.warn('⚠️  Certs directory not found. Creating directory...');
    fs.mkdirSync(certsDir, { recursive: true });
  }

  // Check for certificate files
  const privateKeyPath = path.join(certsDir, 'private.key');
  const certificatePath = path.join(certsDir, 'certificate.crt');
  const caBundlePath = path.join(certsDir, 'ca_bundle.crt');

  if (!fs.existsSync(privateKeyPath)) {
    console.warn('⚠️  private.key not found in certs directory');
  }
  if (!fs.existsSync(certificatePath)) {
    console.warn('⚠️  certificate.crt not found in certs directory');
  }
  if (!fs.existsSync(caBundlePath)) {
    console.warn('⚠️  ca_bundle.crt not found in certs directory');
  }

  // Only set up HTTPS if all required files exist
  if (fs.existsSync(privateKeyPath) && fs.existsSync(certificatePath)) {
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    const certificate = fs.readFileSync(certificatePath, 'utf8');

    httpsOptions = {
      key: privateKey,
      cert: certificate
    };

    // Add CA bundle if it exists
    if (fs.existsSync(caBundlePath)) {
      const caBundle = fs.readFileSync(caBundlePath, 'utf8');
      httpsOptions.ca = caBundle;
    }
  } else {
    console.warn('⚠️  HTTPS not configured. Missing required certificate files.');
  }
} catch (error) {
  console.error('❌ Error setting up HTTPS:', error);
}

export { httpsOptions };