// XenoTerm License Server Configuration
// IMPORTANT: Change these values before deploying!

module.exports = {
  // Server
  port: 3000,

  // YunGouOS - Replace with your real credentials
  // Register at https://merchant.yungouos.com
  yungouos: {
    merchantId: 'YOUR_MERCHANT_ID',   // YunGouOS 商户号
    apiKey: 'YOUR_API_KEY',           // YunGouOS 商户密钥
  },

  // Product
  product: {
    name: 'XenoTerm License',
    price: 99.00,  // CNY, adjust as needed
    trialDays: 15,
  },

  // License signing secret (change this to a random string!)
  licenseSecret: '012a91f83ff088b7876cf490a16d1f8ad77a24a5179edd1664876b7e1c0ba406',

  // Callback URL - set to your domain after DNS setup
  // e.g. https://api.yourdomain.com/api/pay/callback
  callbackUrl: 'http://39.105.198.48:3000/api/pay/callback',
};
