const emailStyles = `
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333333;
      margin: 0;
      padding: 0;
      background-color: #f4f4f4;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #ffffff;
    }
    .header {
      text-align: center;
      padding: 20px 0;
      background-color: #007bff;
      color: white;
      border-radius: 5px 5px 0 0;
    }
    .content {
      padding: 30px 20px;
    }
    h1 {
      color: #fff !important;
      margin: 0;
      font-size: 24px;
    }
    p {
      margin: 15px 0;
    }
    ul {
      margin: 15px 0;
      padding-left: 20px;
    }
    li {
      margin: 10px 0;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background-color: #007bff;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      font-weight: bold;
      margin: 20px 0;
    }
    .button:hover {
      background-color: #0056b3;
    }
    .footer {
      text-align: center;
      padding: 20px;
      color: #666666;
      font-size: 14px;
      border-top: 1px solid #eeeeee;
    }
  </style>
`;

export const welcomeEmailTemplate = (firstName: string, verificationLink: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${emailStyles}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to ZiloChat!</h1>
    </div>
    <div class="content">
      <h2>Hello ${firstName},</h2>
      <p>Thank you for joining our platform. We're excited to have you on board!</p>
      <p>With ZiloChat, you can:</p>
      <ul>
        <li>Manage your WhatsApp business communications</li>
        <li>Connect with your customers seamlessly</li>
        <li>Automate your messaging workflows</li>
      </ul>
      <p>To get started, please verify your email address by clicking the button below:</p>
      <div style="text-align: center;">
        <a href="${verificationLink}" class="button">Verify Email Address</a>
      </div>
      <p>If you have any questions, feel free to reach out to our support team.</p>
    </div>
    <div class="footer">
      <p>Best regards,<br>The ZiloChat Team</p>
    </div>
  </div>
</body>
</html>
`;

export const resetPasswordEmailTemplate = (firstName: string, resetLink: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${emailStyles}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to ZiloChat!</h1>
    </div>
    <div class="content">
      <h2>Hello ${firstName},</h2>
      <p>We received a request to reset your password for your ZiloChat account.</p>
      <p>To ensure the security of your account, please click the button below to reset your password:</p>
      <div style="text-align: center;">
        <a href="${resetLink}" class="button" style="font-weight: bold; color: #fff;">Reset Password</a>
      </div>
      <p>Important security notes:</p>
      <ul>
        <li>This link will expire in 1 hour</li>
        <li>If you didn't request this password reset, please ignore this email</li>
        <li>For security reasons, we recommend using a strong password</li>
      </ul>
      <p>If you have any questions or need assistance, feel free to reach out to our support team.</p>
    </div>
    <div class="footer">
      <p>Best regards,<br>The ZiloChat Team</p>
    </div>
  </div>
</body>
</html>
`;
