const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Konfigurasi default
const config = {
  rpcUrl: 'https://tea-sepolia.g.alchemy.com/v2/SaDcd0bg2n0-McmiqFjNekXRHRc3fML5',
  stakingContract: '0x04290DACdb061C6C9A0B9735556744be49A64012',
  pkFilePath: './pk.txt',
  minStake: 1.0,
  maxStake: 2.0,
  minUnstake: 0.5,
  maxUnstake: 1.0,
  delayBetweenTx: 5000, // 5 detik
  delayAfterStake: 2 * 60 * 1000, // 2 menit
  randomAmounts: true
};

// ABI minimal untuk fungsi stake dan withdraw
const ABI = [
  {
    "inputs": [],
    "name": "stake",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_amount",
        "type": "uint256"
      }
    ],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

// Fungsi untuk membaca private key dari file
function readPrivateKeys(filePath) {
  try {
    const pkPath = path.resolve(filePath);
    const fileContent = fs.readFileSync(pkPath, 'utf8');
    
    // Split by new line dan hapus baris kosong atau whitespace
    const privateKeys = fileContent
      .split('\n')
      .map(key => key.trim())
      .filter(key => key.length > 0 && key !== "");
    
    if (privateKeys.length === 0) {
      throw new Error('No private keys found in the file');
    }
    
    return privateKeys;
  } catch (error) {
    console.error(`Error membaca private key: ${error.message}`);
    throw error;
  }
}

// Fungsi untuk menghasilkan jumlah acak dalam rentang tertentu
function getRandomAmount(min, max) {
  return (Math.random() * (max - min) + min).toFixed(3);
}

// Fungsi untuk menunda eksekusi
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fungsi untuk stake tokens
async function stakeTokens(wallet, contract, amount) {
  try {
    const amountWei = ethers.parseEther(amount.toString());
    
    // Check balance
    const balance = await wallet.provider.getBalance(wallet.address);
    if (balance < amountWei) {
      console.log(`[${wallet.address}] Balance tidak cukup. Memiliki ${ethers.formatEther(balance)} TEA, membutuhkan ${amount} TEA`);
      return false;
    }
    
    console.log(`[${wallet.address}] Staking ${amount} TEA...`);
    
    // Execute stake transaction
    const tx = await contract.stake({ 
      value: amountWei
    });
    
    console.log(`[${wallet.address}] Transaction sent: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    console.log(`[${wallet.address}] Stake berhasil! Block: ${receipt.blockNumber}`);
    
    return true;
  } catch (error) {
    console.error(`[${wallet.address}] Error saat stake: ${error.message}`);
    return false;
  }
}

// Fungsi untuk unstake tokens
async function unstakeTokens(wallet, contract, amount) {
  try {
    const amountWei = ethers.parseEther(amount.toString());
    
    // Check staked balance
    const stakedBalance = await contract.balanceOf(wallet.address);
    if (stakedBalance < amountWei) {
      console.log(`[${wallet.address}] Staked balance tidak cukup. Memiliki ${ethers.formatEther(stakedBalance)} stTEA, membutuhkan ${amount} stTEA`);
      return false;
    }
    
    console.log(`[${wallet.address}] Unstaking ${amount} stTEA...`);
    
    // Execute withdraw transaction
    const tx = await contract.withdraw(amountWei);
    
    console.log(`[${wallet.address}] Transaction sent: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    console.log(`[${wallet.address}] Unstake berhasil! Block: ${receipt.blockNumber}`);
    
    return true;
  } catch (error) {
    console.error(`[${wallet.address}] Error saat unstake: ${error.message}`);
    return false;
  }
}

// Fungsi utama
async function main() {
  try {
    console.log("Starting auto stake/unstake process...");
    
    // Parse command line arguments jika ada
    if (process.argv.length > 2) {
      // Parse min/max stake jika disediakan
      if (process.argv[2] && process.argv[3]) {
        config.minStake = parseFloat(process.argv[2]);
        config.maxStake = parseFloat(process.argv[3]);
      }
      
      // Parse min/max unstake jika disediakan
      if (process.argv[4] && process.argv[5]) {
        config.minUnstake = parseFloat(process.argv[4]);
        config.maxUnstake = parseFloat(process.argv[5]);
      }
      
      // Parse delay jika disediakan
      if (process.argv[6]) {
        config.delayAfterStake = parseInt(process.argv[6]) * 60 * 1000; // Convert dari menit ke ms
      }
    }
    
    console.log("Configuration:", {
      minStake: config.minStake,
      maxStake: config.maxStake,
      minUnstake: config.minUnstake,
      maxUnstake: config.maxUnstake,
      delayAfterStake: config.delayAfterStake / 1000 / 60 + " minutes"
    });
    
    // Baca private keys dari file
    const privateKeys = readPrivateKeys(config.pkFilePath);
    console.log(`Found ${privateKeys.length} wallets`);
    
    // Setup provider
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    
    // Array untuk menyimpan wallet dan jumlah stake/unstake
    const walletInfo = [];
    
    // Inisialisasi wallet dan lihat balances
    for (const privateKey of privateKeys) {
      try {
        // Skip invalid private keys
        if (!privateKey || privateKey.length < 64) {
          console.log(`Skipping invalid private key: ${privateKey}`);
          continue;
        }
        
        // Add 0x prefix if missing
        const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
        
        const wallet = new ethers.Wallet(formattedKey, provider);
        const contract = new ethers.Contract(config.stakingContract, ABI, wallet);
        
        // Cek balance TEA
        const balance = await provider.getBalance(wallet.address);
        const balanceInTea = ethers.formatEther(balance);
        
        // Cek staked balance
        const stakedBalance = await contract.balanceOf(wallet.address);
        const stakedBalanceInTea = ethers.formatEther(stakedBalance);
        
        console.log(`[${wallet.address}] Balance: ${balanceInTea} TEA, Staked: ${stakedBalanceInTea} stTEA`);
        
        // Tentukan jumlah stake berdasarkan balance dan config
        let stakeAmount;
        if (config.randomAmounts) {
          // Random amount antara min dan max, dan tidak lebih dari 90% dari balance
          const maxPossible = Math.min(config.maxStake, parseFloat(balanceInTea) * 0.9);
          if (maxPossible > config.minStake) {
            stakeAmount = getRandomAmount(config.minStake, maxPossible);
          } else {
            stakeAmount = Math.min(config.minStake, parseFloat(balanceInTea) * 0.9);
          }
        } else {
          stakeAmount = config.stakeAmount || 1.0;
        }
        
        // Tentukan jumlah unstake
        let unstakeAmount;
        if (config.randomAmounts) {
          // Random amount antara min dan max
          unstakeAmount = getRandomAmount(config.minUnstake, config.maxUnstake);
        } else {
          unstakeAmount = config.unstakeAmount || 0.5;
        }
        
        walletInfo.push({
          wallet,
          contract,
          stakeAmount,
          unstakeAmount
        });
      } catch (error) {
        console.error(`Error initializing wallet with private key: ${error.message}`);
      }
    }
    
    if (walletInfo.length === 0) {
      throw new Error("No valid wallets found after initialization.");
    }
    
    // 1. Proses Stake untuk semua wallet
    console.log("=== STARTING STAKE PROCESS ===");
    let stakeSuccess = 0;
    
    for (const info of walletInfo) {
      const result = await stakeTokens(info.wallet, info.contract, info.stakeAmount);
      if (result) stakeSuccess++;
      
      // Delay between transactions
      if (walletInfo.indexOf(info) < walletInfo.length - 1) {
        console.log(`Waiting ${config.delayBetweenTx/1000} seconds before next transaction...`);
        await sleep(config.delayBetweenTx);
      }
    }
    
    console.log(`Stake completed for ${stakeSuccess}/${walletInfo.length} wallets`);
    
    // Delay setelah semua stake
    console.log(`Waiting ${config.delayAfterStake/1000/60} minutes before starting unstake...`);
    await sleep(config.delayAfterStake);
    
    // 2. Proses Unstake untuk semua wallet
    console.log("=== STARTING UNSTAKE PROCESS ===");
    let unstakeSuccess = 0;
    
    for (const info of walletInfo) {
      // Update staked balance (karena sudah berubah setelah stake)
      const stakedBalance = await info.contract.balanceOf(info.wallet.address);
      const stakedBalanceInTea = ethers.formatEther(stakedBalance);
      
      // Jika unstake amount lebih besar dari staked balance, gunakan staked balance
      let actualUnstakeAmount = info.unstakeAmount;
      const maxUnstakePossible = parseFloat(stakedBalanceInTea);
      
      if (maxUnstakePossible < actualUnstakeAmount) {
        console.log(`[${info.wallet.address}] Adjusting unstake amount to available balance: ${maxUnstakePossible} stTEA`);
        actualUnstakeAmount = maxUnstakePossible;
      }
      
      if (actualUnstakeAmount > 0) {
        const result = await unstakeTokens(info.wallet, info.contract, actualUnstakeAmount);
        if (result) unstakeSuccess++;
      } else {
        console.log(`[${info.wallet.address}] Skipping unstake, no staked balance`);
      }
      
      // Delay between transactions
      if (walletInfo.indexOf(info) < walletInfo.length - 1) {
        console.log(`Waiting ${config.delayBetweenTx/1000} seconds before next transaction...`);
        await sleep(config.delayBetweenTx);
      }
    }
    
    console.log(`Unstake completed for ${unstakeSuccess}/${walletInfo.length} wallets`);
    console.log("Auto stake/unstake process completed!");
    
    // Exit with success
    process.exit(0);
    
  } catch (error) {
    console.error("Error in auto stake/unstake process:", error);
    // Exit with error
    process.exit(1);
  }
}

// Run the main function
main();
