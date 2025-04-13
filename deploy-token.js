// deploy-token.js
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const CLI = require("cli-spinner").Spinner;

// Configuration
const RPC_URL = "https://tea-sepolia.g.alchemy.com/public";
const CHAIN_ID = 10218;
const TOKEN_FACTORY_ADDRESS = "0x847d23084C474E7a0010Da5Fa869b40b321C8D7b";

// TokenFactory ABI - Only the createToken function we need
const TOKEN_FACTORY_ABI = [
  {
    "inputs": [
      {"internalType": "string", "name": "name", "type": "string"},
      {"internalType": "string", "name": "symbol", "type": "string"},
      {"internalType": "uint256", "name": "totalSupply", "type": "uint256"},
      {"internalType": "address", "name": "recipient", "type": "address"}
    ],
    "name": "createToken",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// Token name generators
const prefixes = [
  "Moon", "Pepe", "Doge", "Shib", "Floki", "Baby", "Based", "Chad", "Elon", "Inu",
  "Alpha", "Beta", "Sigma", "Gamma", "Delta", "Omega", "Mega", "Super", "Hyper", "Ultra",
  "Rocket", "Star", "Stellar", "Cosmic", "Galactic", "Space", "Cyber", "Crypto", "Diamond", "Gold",
  "Safe", "Fair", "Lucky", "Rich", "Wealth", "Gain", "Profit", "Meme", "Meta", "Web3",
  "AI", "Tech", "Future", "Quantum", "Defi", "Yield", "Farm", "Stake", "Swap", "Exchange"
];

const suffixes = [
  "Moon", "Rocket", "Lambo", "Elon", "Mars", "Coin", "Token", "Finance", "Cash", "Money",
  "Blocks", "Chain", "Network", "Protocol", "Swap", "Exchange", "Defi", "Base", "Capital", "Wealth",
  "Gains", "Profit", "Rich", "Millionaire", "Billionaire", "Gold", "Diamond", "Hands", "Ape", "Degen",
  "Dao", "Hub", "Labs", "Tech", "AI", "Meta", "Pay", "NFT", "World", "Universe",
  "Star", "Galaxy", "Planet", "Cosmic", "Crypto", "Bit", "Byte", "Hash", "Node", "Mint"
];

// Generate a random token name
function generateTokenName() {
  const useDoubleName = Math.random() > 0.5;
  
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  
  if (useDoubleName) {
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    return `${prefix} ${suffix}`;
  } else {
    return prefix;
  }
}

// Generate a token symbol (2-6 characters, all caps)
function generateTokenSymbol(name) {
  const words = name.split(" ");
  
  if (words.length > 1) {
    // Take first letter of each word
    return words.map(word => word[0]).join("").toUpperCase();
  } else {
    // Take first 2-5 letters
    const length = Math.floor(Math.random() * 4) + 2; // 2-5 characters
    return name.substring(0, length).toUpperCase();
  }
}

// Generate random token supply (between 100,000 and 1 billion)
function generateTokenSupply() {
  // Generate a random number between 100,000 and 1,000,000,000
  return Math.floor(Math.random() * 999900000) + 100000;
}

// Read valid private keys from file (either pk.txt or wallet.txt)
function readPrivateKeys() {
  try {
    // Try to read from pk.txt first
    let content;
    try {
      content = fs.readFileSync(path.join(__dirname, "pk.txt"), "utf8");
    } catch (error) {
      // If pk.txt fails, try wallet.txt
      try {
        content = fs.readFileSync(path.join(__dirname, "wallet.txt"), "utf8");
      } catch (e) {
        throw new Error("Could not read private key from pk.txt or wallet.txt");
      }
    }
    
    // Parse and validate private keys
    const privateKeys = [];
    const lines = content.split("\n");
    
    for (const line of lines) {
      const cleanLine = line.trim();
      // Check if it's a valid 64-character hex string (private key format)
      if (cleanLine.length === 64 && /^[0-9a-fA-F]{64}$/.test(cleanLine)) {
        privateKeys.push(cleanLine);
      }
    }
    
    if (privateKeys.length === 0) {
      throw new Error("No valid private keys found in the files");
    }
    
    return privateKeys;
  } catch (error) {
    console.error(chalk.red(`Error reading private keys: ${error.message}`));
    throw error;
  }
}

// Creating spinners with different formats
const createSpinner = (text, format = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏") => {
  const spinner = new CLI(`${text} %s`);
  spinner.setSpinnerString(format);
  return spinner;
};

// Deploy a token with a specific wallet
async function deployTokenWithWallet(privateKey, walletIndex, totalWallets) {
  try {
    console.log(chalk.cyan("=".repeat(60)));
    console.log(chalk.yellow.bold(`🚀 TEA SEPOLIA TOKEN DEPLOYMENT (${walletIndex+1}/${totalWallets}) 🚀`));
    console.log(chalk.cyan("=".repeat(60)));
    
    // Connect to the provider using ethers v6 syntax
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Create a wallet instance
    const wallet = new ethers.Wallet(privateKey, provider);
    const address = wallet.address;
    console.log(chalk.green(`✅ Using address: ${chalk.yellow(address)}`));
    
    // Get current balance
    const balanceSpinner = createSpinner(chalk.blue("Checking wallet balance..."));
    balanceSpinner.start();
    const balance = await provider.getBalance(address);
    balanceSpinner.stop(true);
    const formattedBalance = ethers.formatEther(balance);
    console.log(chalk.green(`💰 Current balance: ${chalk.yellow(formattedBalance)} TEA`));
    
    // Check if we have enough balance
    if (balance < ethers.parseEther("0.005")) {
      console.error(chalk.red("❌ Not enough balance to deploy a token (need at least 0.005 TEA)"));
      return { success: false, error: "Insufficient balance", address };
    }
    
    // Generate token details
    const tokenDetailsSpinner = createSpinner(chalk.blue("Generating token details..."));
    tokenDetailsSpinner.start();
    const tokenName = generateTokenName();
    const tokenSymbol = generateTokenSymbol(tokenName);
    const tokenSupply = generateTokenSupply();
    tokenDetailsSpinner.stop(true);
    
    console.log(chalk.magenta("✨ Token Details:"));
    console.log(chalk.green(`📝 Name: ${chalk.yellow(tokenName)}`));
    console.log(chalk.green(`🔤 Symbol: ${chalk.yellow(tokenSymbol)}`));
    console.log(chalk.green(`📊 Supply: ${chalk.yellow(tokenSupply.toLocaleString())}`));
    console.log(chalk.green(`👤 Recipient: ${chalk.yellow(address)}`));
    
    // Create contract instance
    const contractSpinner = createSpinner(chalk.blue("Preparing contract interaction..."));
    contractSpinner.start();
    const tokenFactory = new ethers.Contract(TOKEN_FACTORY_ADDRESS, TOKEN_FACTORY_ABI, wallet);
    
    // Get gas price (in v6 we use getFeeData())
    const feeData = await provider.getFeeData();
    // Increase gas price by 10% to ensure faster confirmation
    const adjustedGasPrice = feeData.gasPrice * BigInt(110) / BigInt(100);
    
    // Prepare transaction options
    const options = {
      gasPrice: adjustedGasPrice,
      gasLimit: 800000, // Adjust as needed, based on earlier successful TX used around 600,000
    };
    contractSpinner.stop(true);
    
    // Deploy the token
    console.log(chalk.blue("🔄 Sending transaction to create token..."));
    const txSpinner = createSpinner(chalk.blue("Transaction in progress..."), "⣾⣽⣻⢿⡿⣟⣯⣷");
    txSpinner.start();
    const tx = await tokenFactory.createToken(
      tokenName,
      tokenSymbol,
      tokenSupply,
      address,
      options
    );
    
    txSpinner.stop(true);
    console.log(chalk.green(`📝 Transaction hash: ${chalk.yellow(tx.hash)}`));
    console.log(chalk.yellow(`🔍 Explorer: https://sepolia.tea.xyz/tx/${tx.hash}`));
    
    // Wait for confirmation
    const confirmSpinner = createSpinner(chalk.blue("Waiting for confirmation..."), "🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛");
    confirmSpinner.start();
    const receipt = await tx.wait();
    confirmSpinner.stop(true);
    
    console.log(chalk.green(`✅ Transaction confirmed in block ${chalk.yellow(receipt.blockNumber)}`));
    console.log(chalk.green(`⛽ Gas used: ${chalk.yellow(receipt.gasUsed.toString())}`));
    
    console.log(chalk.cyan("=".repeat(60)));
    console.log(chalk.yellow.bold(`🎉 Successfully deployed token: ${chalk.green(tokenName)} (${chalk.green(tokenSymbol)})`));
    console.log(chalk.cyan("=".repeat(60)));
    
    return {
      success: true,
      address,
      txHash: tx.hash,
      tokenName,
      tokenSymbol,
      tokenSupply,
      blockNumber: receipt.blockNumber
    };
    
  } catch (error) {
    console.log(chalk.red("=".repeat(60)));
    console.error(chalk.red.bold("❌ Error deploying token:"));
    console.error(chalk.red(error.message));
    if (error.reason) console.error(chalk.red("Reason:", error.reason));
    if (error.data) console.error(chalk.red("Error data:", error.data));
    console.log(chalk.red("=".repeat(60)));
    return { success: false, error: error.message };
  }
}

async function deployToken() {
  try {
    // Read all private keys
    const privateKeys = readPrivateKeys();
    console.log(chalk.blue(`Found ${chalk.yellow(privateKeys.length)} wallets in pk.txt`));
    
    const results = [];
    
    // Deploy a token for each private key
    for (let i = 0; i < privateKeys.length; i++) {
      // If not the first wallet, add a small delay to prevent rate limiting
      if (i > 0) {
        console.log(chalk.yellow(`\nWaiting 3 seconds before deploying with next wallet...\n`));
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      const result = await deployTokenWithWallet(privateKeys[i], i, privateKeys.length);
      results.push(result);
    }
    
    // Display summary
    console.log(chalk.cyan("=".repeat(60)));
    console.log(chalk.yellow.bold("📊 DEPLOYMENT SUMMARY"));
    console.log(chalk.cyan("=".repeat(60)));
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.success) {
        successCount++;
        console.log(chalk.green(`✅ Wallet ${i+1}: ${result.address.substring(0, 10)}... - ${result.tokenName} (${result.tokenSymbol}) - Tx: ${result.txHash.substring(0, 10)}...`));
      } else {
        failCount++;
        console.log(chalk.red(`❌ Wallet ${i+1}: ${result.address ? result.address.substring(0, 10) : 'Unknown'}... - ${result.error}`));
      }
    }
    
    console.log(chalk.cyan("=".repeat(60)));
    console.log(chalk.yellow(`Total Attempts: ${chalk.white(results.length)}`));
    console.log(chalk.green(`Success: ${chalk.white(successCount)}`));
    console.log(chalk.red(`Failed: ${chalk.white(failCount)}`));
    console.log(chalk.cyan("=".repeat(60)));
    
    return {
      success: successCount > 0,
      totalAttempts: results.length,
      successCount,
      failCount,
      results
    };
    
  } catch (error) {
    console.error(chalk.red.bold("❌ Fatal error:"), error);
    return { success: false, error: error.message };
  }
}

// If script is run directly
if (require.main === module) {
  deployToken()
    .then(result => {
      if (result && result.success) {
        console.log(chalk.green.bold("✅ Token deployment completed successfully!"));
      } else {
        console.log(chalk.red.bold("❌ Token deployment failed."));
      }
      process.exit(0);
    })
    .catch(error => {
      console.error(chalk.red.bold("❌ Fatal error:"), error);
      process.exit(1);
    });
}

// Export for use in menu.js
module.exports = { deployToken };