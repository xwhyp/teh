const { spawn } = require("child_process");
const fs = require("fs");
const readline = require("readline");
const { ethers } = require("ethers");
const chalk = require("chalk");

// Variabel global untuk menyimpan konfigurasi stake
let stakeConfig = {
    minStake: "1.0",
    maxStake: "2.0",
    minUnstake: "0.5",
    maxUnstake: "1.0",
    delayAfterStake: "2"
};

// Fungsi untuk konversi PK ke address dan simpan ke wallet.txt (otomatis)
function ensureWalletFileExists() {
    try {
        let needsConversion = false;
        
        // Cek apakah pk.txt ada
        if (!fs.existsSync("pk.txt")) {
            console.log(chalk.yellow("⚠️ File pk.txt tidak ditemukan. Harap buat file dengan private key terlebih dahulu."));
            return false;
        }
        
        // Baca private key dari pk.txt
        const privateKeys = fs.readFileSync("pk.txt", "utf8")
            .split("\n")
            .filter(line => line.trim() !== "")
            .map(line => line.trim());
        
        // Cek apakah wallet.txt ada
        if (!fs.existsSync("wallet.txt")) {
            needsConversion = true;
        } else {
            // Jika wallet.txt ada, cek apakah jumlah address sama dengan jumlah PK
            const addresses = fs.readFileSync("wallet.txt", "utf8")
                .split("\n")
                .filter(line => line.trim() !== "");
            
            if (addresses.length !== privateKeys.length) {
                needsConversion = true;
            }
        }
        
        // Jika perlu konversi, lakukan konversi
        if (needsConversion) {
            // Konversi masing-masing PK ke address
            const addresses = privateKeys.map(pk => {
                try {
                    const wallet = new ethers.Wallet(pk);
                    return wallet.address;
                } catch (error) {
                    return null;
                }
            }).filter(addr => addr !== null);
            
            // Simpan ke wallet.txt
            fs.writeFileSync("wallet.txt", addresses.join("\n"));
        }
        
        return true;
    } catch (error) {
        console.error(chalk.red("❌ Error saat konversi PK ke address:"), error.message);
        return false;
    }
}

// Fungsi sederhana untuk input pengguna dengan default yang langsung digunakan
function askQuestion(question, defaultValue) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(chalk.cyan(question), (answer) => {
            rl.close();
            resolve(answer.trim() || defaultValue);
        });
    });
}

// Fungsi untuk mendapatkan semua konfigurasi di awal
async function getAllConfigurations() {
    try {
        // 1. Konfigurasi TX
        console.log(chalk.yellow("\n🔧 === Konfigurasi TX === 🔧"));
                
        // Untuk konfigurasi yang tidak perlu input manual, gunakan default
        const txCount = await askQuestion("Jumlah transaksi per alamat tujuan (default: 1): ", "1");
        const gasPrice = await askQuestion("Gas price (default: 10): ", "10");
        const gasLimit = await askQuestion("Gas limit (default: 210000): ", "210000");
        const delayMin = await askQuestion("Delay minimum dalam detik (default: 5): ", "5");
        const delayMax = await askQuestion("Delay maximum dalam detik (default: 15): ", "15");
        const minAmount = await askQuestion("Jumlah minimum (default: 0.0001): ", "0.0001");
        const maxAmount = await askQuestion("Jumlah maximum (default: 0.001): ", "0.001");
        
        // Baca alamat dari list.txt
        let addresses = [];
        try {
            addresses = fs.readFileSync("list.txt", "utf8")
                .split("\n")
                .filter(line => line.trim() !== "");
            console.log(chalk.green(`📋 ${addresses.length} alamat dibaca dari list.txt.`));
        } catch (error) {
            console.log(chalk.yellow("⚠️ File list.txt tidak ditemukan atau kosong, menggunakan alamat random:"));
            // Generate beberapa alamat random sebagai fallback
            addresses = [];
            for (let i = 0; i < 3; i++) {
                const randomWallet = ethers.Wallet.createRandom();
                addresses.push(randomWallet.address);
            }
            console.log(chalk.green(`🔑 3 alamat random telah dibuat.`));
        }
        
        // Konfigurasi TX dengan nilai dari input
        const txConfig = {
            addresses,
            gasPrice,
            gasLimit,
            txCount: parseInt(txCount),
            delayMin: parseInt(delayMin),
            delayMax: parseInt(delayMax),
            minAmount: parseFloat(minAmount),
            maxAmount: parseFloat(maxAmount),
            useAllWallets: true  // Selalu gunakan semua wallet secara otomatis
        };
        
        // Simpan konfigurasi ke file
        fs.writeFileSync("tx_config.json", JSON.stringify(txConfig, null, 2));
        console.log(chalk.green("✅ Konfigurasi TX telah disimpan ke tx_config.json"));
        
        // 2. Konfigurasi Stake/Unstake
        console.log(chalk.yellow("\n🔧 === Konfigurasi Stake/Unstake === 🔧"));
        
        stakeConfig.minStake = await askQuestion("Jumlah minimum untuk stake (default: 1.0): ", "1.0");
        stakeConfig.maxStake = await askQuestion("Jumlah maximum untuk stake (default: 2.0): ", "2.0");
        stakeConfig.minUnstake = await askQuestion("Jumlah minimum untuk unstake (default: 0.5): ", "0.5");
        stakeConfig.maxUnstake = await askQuestion("Jumlah maximum untuk unstake (default: 1.0): ", "1.0");
        stakeConfig.delayAfterStake = await askQuestion("Delay setelah stake dalam menit (default: 2): ", "2");
        
        console.log(chalk.green("✅ Konfigurasi Stake/Unstake telah disimpan"));
        
        return {
            txConfig: txConfig,
            stakeConfig: stakeConfig
        };
    } catch (error) {
        console.error(chalk.red("❌ Error saat mendapatkan konfigurasi:"), error.message);
        return {
            txConfig: null,
            stakeConfig: stakeConfig
        };
    }
}

// Fungsi untuk menjalankan faucet.js
function runFaucet() {
    return new Promise((resolve) => {
        // Pastikan wallet.txt sudah ada dan sesuai
        if (!ensureWalletFileExists()) {
            console.log(chalk.red("❌ Tidak dapat menjalankan faucet: wallet.txt tidak ada atau tidak valid."));
            resolve("failed");
            return;
        }
        
        console.log(chalk.blue("\n🚰 Menjalankan script faucet.js..."));
        
        // Clear any existing marker file
        try {
            if (fs.existsSync("faucet_waiting.marker")) {
                fs.unlinkSync("faucet_waiting.marker");
            }
        } catch (e) {}
        
        // Setup untuk proses faucet dengan cli-spinner
        const faucetProcess = spawn("node", ["faucet.js"], {
            stdio: 'inherit', // Inherit semua stream (penting untuk cli-spinner)
            env: {
                ...process.env, 
                FORCE_COLOR: "1", 
                TERM: "xterm-256color",
                // Penting untuk cli-spinner:
                NODE_NO_READLINE: "1"
            }
        });
        
        // Set up file watching for marker
        const markerFile = "faucet_waiting.marker";
        const markerCheckInterval = setInterval(() => {
            try {
                if (fs.existsSync(markerFile)) {
                    clearInterval(markerCheckInterval);
                    try { fs.unlinkSync(markerFile); } catch(e) {}
                    resolve("completed");
                }
            } catch (e) {}
        }, 2000); // Check every 2 seconds
        
        faucetProcess.on("close", (code) => {
            clearInterval(markerCheckInterval);
            console.log(chalk.green(`\n✅ Script faucet.js selesai dengan kode: ${chalk.yellow(code || 0)}\n`));
            resolve("completed");
        });
    });
}

// Fungsi untuk menjalankan tx.js dengan konfigurasi yang disimpan
async function runDailyTx(config = null) {
    try {
        // Pastikan wallet.txt sudah ada dan sesuai
        if (!ensureWalletFileExists()) {
            console.log(chalk.red("❌ Tidak dapat menjalankan daily TX: wallet.txt tidak ada atau tidak valid."));
            return "failed";
        }
        
        console.log(chalk.blue("\n💸 Menjalankan script TX harian..."));
        
        // Jika tidak ada config yang valid, gunakan config dari file
        if (!config && fs.existsSync("tx_config.json")) {
            try {
                config = JSON.parse(fs.readFileSync("tx_config.json", "utf8"));
                console.log(chalk.cyan("📂 Menggunakan konfigurasi yang tersimpan dari tx_config.json"));
            } catch (e) {
                console.error(chalk.red("❌ Error membaca konfigurasi tersimpan:"), e.message);
                config = null;
            }
        }
        
        // Pastikan useAllWallets selalu true (untuk memastikan menggunakan semua wallet)
        if (config) {
            config.useAllWallets = true;
        }
        
        // Jalankan tx.js dengan config
        try {
            const txModule = require('./tx.js');
            await txModule.runWithConfig(config);
            console.log(chalk.green("\n✅ Script tx.js selesai\n"));
            return "completed";
        } catch (error) {
            console.error(chalk.red(`\n❌ Error saat menjalankan tx.js: ${error.message}\n`));
            return "failed";
        }
    } catch (error) {
        console.error(chalk.red("❌ Error saat menjalankan script TX:"), error.message);
        return "failed";
    }
}

// Fungsi untuk menjalankan deploy-token.js
function runDeployToken() {
    return new Promise((resolve) => {
        // Pastikan wallet.txt sudah ada dan sesuai
        if (!ensureWalletFileExists()) {
            console.log(chalk.red("❌ Tidak dapat menjalankan deploy token: wallet.txt tidak ada atau tidak valid."));
            resolve("failed");
            return;
        }
        
        console.log(chalk.blue("\n🪙 Menjalankan script deploy-token.js..."));
        
        const deployTokenProcess = spawn("node", ["deploy-token.js"], {
            stdio: 'inherit',
            env: {
                ...process.env,
                FORCE_COLOR: "1",
                TERM: "xterm-256color"
            }
        });
        
        deployTokenProcess.on("close", (code) => {
            console.log(chalk.green(`\n✅ Script deploy-token.js selesai dengan kode: ${chalk.yellow(code || 0)}\n`));
            resolve("completed");
        });
    });
}

// Fungsi untuk menjalankan stake.js
async function runStake() {
    try {
        // Pastikan wallet.txt sudah ada dan sesuai
        if (!ensureWalletFileExists()) {
            console.log(chalk.red("❌ Tidak dapat menjalankan stake: wallet.txt tidak ada atau tidak valid."));
            return "failed";
        }
        
        console.log(chalk.blue("\n📊 Menjalankan script stake.js..."));
        console.log(chalk.cyan(`Menggunakan konfigurasi: Min Stake=${stakeConfig.minStake}, Max Stake=${stakeConfig.maxStake}, Min Unstake=${stakeConfig.minUnstake}, Max Unstake=${stakeConfig.maxUnstake}, Delay=${stakeConfig.delayAfterStake} menit`));
        
        // Jalankan stake.js dengan argumen command line
        const stakeProcess = spawn("node", [
            "stake.js",
            stakeConfig.minStake,
            stakeConfig.maxStake,
            stakeConfig.minUnstake, 
            stakeConfig.maxUnstake,
            stakeConfig.delayAfterStake
        ], {
            stdio: 'inherit',
            env: {
                ...process.env,
                FORCE_COLOR: "1",
                TERM: "xterm-256color"
            }
        });
        
        return new Promise((resolve) => {
            stakeProcess.on("close", (code) => {
                console.log(chalk.green(`\n✅ Script stake.js selesai dengan kode: ${chalk.yellow(code || 0)}\n`));
                resolve(code === 0 ? "completed" : "failed");
            });
        });
    } catch (error) {
        console.error(chalk.red("❌ Error saat menjalankan script stake:"), error.message);
        return "failed";
    }
}

// Fungsi utama untuk menjalankan semua script secara berurutan
async function runAllProcess() {
    try {
        // 1. Pastikan wallet.txt sudah ada dan sesuai
        if (!ensureWalletFileExists()) {
            console.log(chalk.red("❌ Tidak dapat menjalankan otomatisasi: wallet.txt tidak ada atau tidak valid."));
            return;
        }
        
        console.log(chalk.magenta("\n🔄 ==== OTOMATISASI TEA SEPOLIA ==== 🔄"));
        
        // 2. Dapatkan semua konfigurasi di awal
        const configs = await getAllConfigurations();
        
        // 3. Jalankan Faucet
        console.log(chalk.magenta("\n[1/4] Menjalankan Faucet"));
        await runFaucet();
        
        // 4. Jalankan TX
        console.log(chalk.magenta("\n[2/4] Menjalankan Daily TX"));
        await runDailyTx(configs.txConfig);
        
        // 5. Jalankan Deploy Token
        console.log(chalk.magenta("\n[3/4] Menjalankan Deploy Token"));
        await runDeployToken();
        
        // 6. Jalankan Stake
        console.log(chalk.magenta("\n[4/4] Menjalankan Stake/Unstake"));
        await runStake();
        
        console.log(chalk.green.bold("\n✅ ==== SEMUA PROSES OTOMATISASI SELESAI ==== ✅"));
        
        // 7. Tanyakan jika ingin menjalankan lagi dalam 24 jam
        const runAgain = await askQuestion("\nJalankan otomatisasi lagi dalam 24 jam? (y/n): ", "y");
        
        if (runAgain.toLowerCase() === 'y') {
            const hours = await askQuestion("Jalankan kembali dalam berapa jam? (default: 24): ", "24");
            const timeInMs = parseInt(hours) * 60 * 60 * 1000;
            
            console.log(chalk.yellow(`\n⏰ Menunggu ${hours} jam untuk run berikutnya...`));
            setTimeout(() => {
                runAllProcess();
            }, timeInMs);
        } else {
            console.log(chalk.green.bold("\n👋 Terima kasih, program selesai!"));
            process.exit(0);
        }
    } catch (error) {
        console.error(chalk.red("❌ Error saat menjalankan otomatisasi:"), error.message);
    }
}

// Mulai otomatisasi saat script dijalankan
console.clear();
console.log(chalk.cyan.bold("\n" + "=".repeat(60)));
console.log(chalk.yellow.bold("              TEA SEPOLIA FULL AUTOMATION"));
console.log(chalk.cyan.bold("=".repeat(60)));
console.log(chalk.white("\nScript ini akan menjalankan semua proses secara otomatis dalam urutan:"));
console.log(chalk.white("1. Faucet - Mendapatkan TEA dari faucet"));
console.log(chalk.white("2. TX - Menjalankan transaksi harian"));
console.log(chalk.white("3. Deploy Token - Mendeploy token"));
console.log(chalk.white("4. Stake/Unstake - Menjalankan auto stake dan unstake"));
console.log(chalk.cyan.bold("\n" + "=".repeat(60)));

// Mulai proses otomatisasi
askQuestion("\nTekan Enter untuk memulai otomatisasi... ", "").then(() => {
    runAllProcess();
});
