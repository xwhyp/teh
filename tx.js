const { ethers } = require("ethers");
const fs = require("fs");
const readline = require("readline");
const cliSpinner = require('cli-spinner').Spinner;
const chalk = require("chalk");

const TEA_RPC_URL = "https://tea-sepolia.g.alchemy.com/public";

// Membaca semua private key dari file pk.txt
function readAllPrivateKeys() {
  try {
    // Baca file pk.txt
    const content = fs.readFileSync("pk.txt", "utf8");
    
    // Pisahkan berdasarkan newline, bersihkan, dan filter hanya private key valid
    const privateKeys = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length === 64 && /^[0-9a-fA-F]{64}$/.test(line));
    
    // Cek apakah ada private key
    if (privateKeys.length === 0) {
      throw new Error("Tidak ada private key valid yang ditemukan di pk.txt");
    }
    
    console.log(chalk.green(`✅ Berhasil membaca ${privateKeys.length} private key dari pk.txt`));
    return privateKeys;
  } catch (error) {
    console.error(chalk.red("Error membaca file pk.txt:"), error.message);
    process.exit(1);
  }
}

// Membuat provider
function getProvider() {
  return new ethers.JsonRpcProvider(TEA_RPC_URL);
}

// Fungsi untuk menghasilkan alamat acak
const generateRandomAddresses = (count) => {
    let addresses = [];
    for (let i = 0; i < count; i++) {
        const randomWallet = ethers.Wallet.createRandom();
        addresses.push(randomWallet.address);
    }
    return addresses;
};

// Fungsi untuk membaca alamat dari list.txt
const readAddressesFromFile = () => {
    try {
        const data = fs.readFileSync("list.txt", "utf8");
        return data.split("\n").filter(line => line.trim() !== "");
    } catch (error) {
        console.error(chalk.red("Error membaca file list.txt:"), error.message);
        return [];
    }
};

// Fungsi untuk mengirim TEA menggunakan semua wallet
const sendTeaWithAllWallets = async (addresses, txCount, minAmount, maxAmount) => {
    // Baca semua private key
    const privateKeys = readAllPrivateKeys();
    const provider = getProvider();
    
    console.log(chalk.cyan.bold(`\n==== MEMULAI PENGIRIMAN TX DENGAN ${privateKeys.length} WALLET ====`));
    console.log(chalk.yellow(`Jumlah alamat tujuan: ${chalk.white.bold(addresses.length)}`));
    console.log(chalk.yellow(`Jumlah TX per alamat: ${chalk.white.bold(txCount)}`));
    console.log(chalk.yellow(`Range amount: ${chalk.white.bold(minAmount)} - ${chalk.white.bold(maxAmount)} TEA`));
    
    // Tampilkan informasi wallet
    console.log(chalk.cyan.bold("\n=== INFORMASI WALLET ==="));
    const wallets = [];
    const walletBalances = [];
    
    for (let i = 0; i < privateKeys.length; i++) {
        const wallet = new ethers.Wallet(privateKeys[i], provider);
        wallets.push(wallet);
        
        const balance = await provider.getBalance(wallet.address);
        walletBalances.push(balance);
        
        console.log(chalk.yellow(`Wallet #${i}: ${chalk.blue(wallet.address)} | Balance: ${chalk.white.bold(ethers.formatEther(balance))} TEA`));
    }
    console.log();
    
    let totalTx = 0;
    let successTx = 0;
    let failedTx = 0;
    
    // Set up loading spinner
    const spinner = new cliSpinner({
        text: '%s Processing transactions...',
        onTick: function(msg) {
            this.clearLine(this.stream);
            this.stream.write(msg);
        }
    });
    
    spinner.setSpinnerString('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏');
    
    // PERUBAHAN PENTING: Kirim transaksi dari SETIAP wallet ke SETIAP alamat tujuan
    for (let walletIndex = 0; walletIndex < wallets.length; walletIndex++) {
        const wallet = wallets[walletIndex];
        
        for (let address of addresses) {
            for (let i = 0; i < txCount; i++) {
                try {
                    // Generate random amount between min and max
                    const range = maxAmount - minAmount;
                    const randomValue = Math.random() * range + parseFloat(minAmount);
                    const amount = randomValue.toFixed(4); // 4 decimal places
                    
                    // Convert to wei (ethers)
                    const valueInWei = ethers.parseEther(amount.toString());
                    
                    // Cek balance wallet
                    const currentBalance = await provider.getBalance(wallet.address);
                    if (currentBalance < valueInWei) {
                        console.log(chalk.yellow(`⚠️ Wallet #${walletIndex} tidak memiliki cukup balance untuk transaksi ini. Melewati...`));
                        failedTx++;
                        continue;
                    }
                    
                    // Start spinner with transaction info
                    spinner.setSpinnerTitle(
                        `%s ${chalk.yellow(`[${++totalTx}]`)} ${chalk.cyan(`Memproses TX: `)}` +
                        `${chalk.white(amount)} ${chalk.green('TEA')} → ${chalk.blue(address.substring(0, 10) + '...')} ` +
                        `dari Wallet #${walletIndex}`
                    );
                    spinner.start();
                    
                    // Send transaction
                    const tx = await wallet.sendTransaction({
                        to: address,
                        value: valueInWei,
                    });
                    
                    // Stop spinner and show successful transaction
                    spinner.stop(true);
                    console.log(
                        `${chalk.green('✓')} ${chalk.yellow(`[${totalTx}]`)} ${chalk.white(`Mengirim ${chalk.bold(amount)} TEA ke ${chalk.blue(address)}`)} | ` +
                        `${chalk.magenta('Dari:')} Wallet #${walletIndex} | ${chalk.magenta('Tx Hash:')} ${chalk.cyan(tx.hash)}`
                    );
                    
                    // Wait for confirmation with small spinner
                    const confirmSpinner = new cliSpinner({
                        text: '%s Menunggu konfirmasi...',
                    });
                    confirmSpinner.setSpinnerString('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏');
                    confirmSpinner.start();
                    
                    await tx.wait();
                    confirmSpinner.stop(true);
                    console.log(`   ${chalk.green('✓')} ${chalk.gray('Transaksi terkonfirmasi!')}`);
                    successTx++;
                } catch (error) {
                    // Stop spinner and show error
                    spinner.stop(true);
                    console.error(
                        `${chalk.red('✗')} ${chalk.yellow(`[${totalTx}]`)} ` +
                        `${chalk.red(`Gagal mengirim ke ${address} dari Wallet #${walletIndex}:`)} ${chalk.white(error.message)}`
                    );
                    failedTx++;
                }
            }
        }
    }
    
    // Tampilkan report dengan format yang lebih bagus
    console.log(`\n${chalk.cyan.bold('╔══════════════════════════════════════╗')}`);
    console.log(`${chalk.cyan.bold('║')} ${chalk.white.bold('         REPORT PENGIRIMAN TX        ')} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('╠══════════════════════════════════════╣')}`);
    console.log(`${chalk.cyan.bold('║')} ${chalk.yellow('Total transaksi:  ')} ${chalk.white.bold(totalTx.toString().padStart(18, ' '))} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('║')} ${chalk.green('Transaksi berhasil:')} ${chalk.white.bold(successTx.toString().padStart(18, ' '))} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('║')} ${chalk.red('Transaksi gagal:   ')} ${chalk.white.bold(failedTx.toString().padStart(18, ' '))} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('╠══════════════════════════════════════╣')}`);
    
    // Tampilkan perubahan balance untuk setiap wallet
    console.log(`${chalk.cyan.bold('║')} ${chalk.white.bold('         PERUBAHAN BALANCE          ')} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('╠══════════════════════════════════════╣')}`);
    
    for (let i = 0; i < wallets.length; i++) {
        const oldBalance = walletBalances[i];
        const newBalance = await provider.getBalance(wallets[i].address);
        const balanceUsed = oldBalance - newBalance;
        
        console.log(`${chalk.cyan.bold('║')} ${chalk.yellow(`Wallet #${i}:`)} ${chalk.white.bold(ethers.formatEther(balanceUsed).padStart(25, ' '))} ${chalk.green('TEA')} ${chalk.cyan.bold('║')}`);
    }
    
    console.log(`${chalk.cyan.bold('╚══════════════════════════════════════╝')}`);
    
    // Progress bar visualisasi
    const successRate = (successTx / totalTx) * 100;
    const successBar = '█'.repeat(Math.floor(successRate / 5));
    const failBar = '░'.repeat(20 - Math.floor(successRate / 5));
    
    console.log(`\n${chalk.white.bold('Progress:')} ${chalk.green(successBar)}${chalk.red(failBar)} ${chalk.white.bold(successRate.toFixed(1) + '%')}`);
    console.log(`${chalk.cyan.bold('==== SELESAI ====')}\n`);
    
    return { totalTx, successTx, failedTx };
};

// Fungsi untuk mengirim TEA dengan satu wallet tertentu
const sendTeaWithSingleWallet = async (addresses, txCount, minAmount, maxAmount, walletIndex) => {
    // Baca semua private key
    const privateKeys = readAllPrivateKeys();
    const provider = getProvider();
    
    // Validasi wallet index
    if (walletIndex < 0 || walletIndex >= privateKeys.length) {
        console.log(chalk.yellow(`⚠️ Wallet index ${walletIndex} tidak valid, menggunakan wallet #0`));
        walletIndex = 0;
    }
    
    // Inisialisasi wallet
    const wallet = new ethers.Wallet(privateKeys[walletIndex], provider);
    
    console.log(chalk.cyan.bold(`\n==== MEMULAI PENGIRIMAN TX DENGAN WALLET #${walletIndex} ====`));
    console.log(chalk.yellow(`Wallet Address: ${chalk.blue(wallet.address)}`));
    console.log(chalk.yellow(`Jumlah alamat tujuan: ${chalk.white.bold(addresses.length)}`));
    console.log(chalk.yellow(`Jumlah TX per alamat: ${chalk.white.bold(txCount)}`));
    console.log(chalk.yellow(`Range amount: ${chalk.white.bold(minAmount)} - ${chalk.white.bold(maxAmount)} TEA`));
    
    const walletBalance = await provider.getBalance(wallet.address);
    console.log(chalk.yellow(`Balance wallet: ${chalk.white.bold(ethers.formatEther(walletBalance))} TEA\n`));
    
    let totalTx = 0;
    let successTx = 0;
    let failedTx = 0;
    
    // Set up loading spinner
    const spinner = new cliSpinner({
        text: '%s Processing transactions...',
        onTick: function(msg) {
            this.clearLine(this.stream);
            this.stream.write(msg);
        }
    });
    
    spinner.setSpinnerString('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏');
    
    for (let address of addresses) {
        for (let i = 0; i < txCount; i++) {
            try {
                // Generate random amount between min and max
                const range = maxAmount - minAmount;
                const randomValue = Math.random() * range + parseFloat(minAmount);
                const amount = randomValue.toFixed(4); // 4 decimal places
                
                // Convert to wei (ethers)
                const valueInWei = ethers.parseEther(amount.toString());
                
                // Start spinner with transaction info
                spinner.setSpinnerTitle(`%s ${chalk.yellow(`[${++totalTx}]`)} ${chalk.cyan(`Memproses TX: `)}${chalk.white(amount)} ${chalk.green('TEA')} → ${chalk.blue(address.substring(0, 10) + '...')} `);
                spinner.start();
                
                // Send transaction
                const tx = await wallet.sendTransaction({
                    to: address,
                    value: valueInWei,
                });
                
                // Stop spinner and show successful transaction
                spinner.stop(true);
                console.log(
                    `${chalk.green('✓')} ${chalk.yellow(`[${totalTx}]`)} ${chalk.white(`Mengirim ${chalk.bold(amount)} TEA ke ${chalk.blue(address)}`)} | ${chalk.magenta('Tx Hash:')} ${chalk.cyan(tx.hash)}`
                );
                
                // Wait for confirmation with small spinner
                const confirmSpinner = new cliSpinner({
                    text: '%s Menunggu konfirmasi...',
                });
                confirmSpinner.setSpinnerString('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏');
                confirmSpinner.start();
                
                await tx.wait();
                confirmSpinner.stop(true);
                console.log(`   ${chalk.green('✓')} ${chalk.gray('Transaksi terkonfirmasi!')}`);
                successTx++;
            } catch (error) {
                // Stop spinner and show error
                spinner.stop(true);
                console.error(`${chalk.red('✗')} ${chalk.yellow(`[${totalTx}]`)} ${chalk.red(`Gagal mengirim ke ${address}:`)} ${chalk.white(error.message)}`);
                failedTx++;
            }
        }
    }
    
    // Tampilkan report dengan format yang lebih bagus
    console.log(`\n${chalk.cyan.bold('╔══════════════════════════════════════╗')}`);
    console.log(`${chalk.cyan.bold('║')} ${chalk.white.bold('         REPORT PENGIRIMAN TX        ')} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('╠══════════════════════════════════════╣')}`);
    console.log(`${chalk.cyan.bold('║')} ${chalk.yellow('Total transaksi:  ')} ${chalk.white.bold(totalTx.toString().padStart(18, ' '))} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('║')} ${chalk.green('Transaksi berhasil:')} ${chalk.white.bold(successTx.toString().padStart(18, ' '))} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('║')} ${chalk.red('Transaksi gagal:   ')} ${chalk.white.bold(failedTx.toString().padStart(18, ' '))} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('╠══════════════════════════════════════╣')}`);
    
    const finalBalance = await provider.getBalance(wallet.address);
    const balanceUsed = walletBalance - finalBalance;
    
    console.log(`${chalk.cyan.bold('║')} ${chalk.yellow('Balance awal:    ')} ${chalk.white.bold(ethers.formatEther(walletBalance).padStart(18, ' '))} ${chalk.green('TEA')} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('║')} ${chalk.yellow('Balance akhir:   ')} ${chalk.white.bold(ethers.formatEther(finalBalance).padStart(18, ' '))} ${chalk.green('TEA')} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('║')} ${chalk.yellow('TEA terpakai:    ')} ${chalk.white.bold(ethers.formatEther(balanceUsed).padStart(18, ' '))} ${chalk.green('TEA')} ${chalk.cyan.bold('║')}`);
    console.log(`${chalk.cyan.bold('╚══════════════════════════════════════╝')}`);
    
    // Progress bar visualisasi
    const successRate = (successTx / totalTx) * 100;
    const successBar = '█'.repeat(Math.floor(successRate / 5));
    const failBar = '░'.repeat(20 - Math.floor(successRate / 5));
    
    console.log(`\n${chalk.white.bold('Progress:')} ${chalk.green(successBar)}${chalk.red(failBar)} ${chalk.white.bold(successRate.toFixed(1) + '%')}`);
    console.log(`${chalk.cyan.bold('==== SELESAI ====')}\n`);
    
    return { totalTx, successTx, failedTx };
};

// Fungsi untuk meminta input parameter
const getUserInput = async () => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    
    const question = (prompt) => {
        return new Promise((resolve) => {
            rl.question(chalk.cyan(prompt), (answer) => {
                resolve(answer.trim());
            });
        });
    };
    
    try {
        console.log(chalk.cyan.bold("\n==== KONFIGURASI TX ===="));
        
        // Baca semua private key terlebih dahulu
        const privateKeys = readAllPrivateKeys();
        
        // Tanyakan mode wallet
        const walletMode = await question(
            "Pilih mode wallet (ketik angka):\n" +
            "1. Gunakan semua wallet secara otomatis (bergantian)\n" +
            "2. Gunakan satu wallet tertentu\n" +
            "Pilihan: "
        );
        
        let walletIndex = -1; // -1 berarti semua wallet
        
        if (walletMode === "2") {
            const indexStr = await question(`Pilih wallet index (0-${privateKeys.length - 1}): `);
            walletIndex = parseInt(indexStr);
            
            if (isNaN(walletIndex) || walletIndex < 0 || walletIndex >= privateKeys.length) {
                console.log(chalk.yellow(`⚠️ Index tidak valid, menggunakan wallet #0`));
                walletIndex = 0;
            }
        } else if (walletMode !== "1") {
            console.log(chalk.yellow(`⚠️ Pilihan tidak valid, menggunakan semua wallet`));
        }
        
        const addressType = await question("Pilih sumber alamat (ketik angka):\n1. Generate random\n2. Baca dari list.txt\n3. Input manual\nPilihan: ");
        
        let addresses = [];
        
        if (addressType === "1") {
            const count = await question("Berapa jumlah alamat yang diinginkan? ");
            const amount = Number(count);
            if (isNaN(amount) || amount <= 0) {
                console.error(chalk.red("Jumlah yang dimasukkan tidak valid."));
                rl.close();
                process.exit(1);
            }
            addresses = generateRandomAddresses(amount);
            console.log(chalk.green(`✅ ${amount} alamat acak telah dibuat.`));
        } 
        else if (addressType === "2") {
            addresses = readAddressesFromFile();
            if (addresses.length === 0) {
                console.error(chalk.red("Tidak ada alamat yang ditemukan di list.txt atau file tidak ada."));
                rl.close();
                process.exit(1);
            }
            console.log(chalk.green(`✅ ${addresses.length} alamat dibaca dari list.txt.`));
        } 
        else if (addressType === "3") {
            console.log(chalk.cyan("Masukkan daftar alamat satu per baris. Ketik 'done' jika sudah selesai:"));
            let input = await question("");
            while (input.toLowerCase() !== "done") {
                if (input.trim() !== "") {
                    addresses.push(input.trim());
                }
                input = await question("");
            }
            console.log(chalk.green(`✅ ${addresses.length} alamat telah dimasukkan.`));
        } 
        else {
            console.error(chalk.red("Pilihan tidak valid."));
            rl.close();
            process.exit(1);
        }
        
        const txCount = Number(await question("Berapa jumlah TX per alamat? "));
        if (isNaN(txCount) || txCount <= 0) {
            console.error(chalk.red("Jumlah TX tidak valid."));
            rl.close();
            process.exit(1);
        }
        
        const minAmount = await question("Minimal amount TEA untuk dikirim: ");
        const maxAmount = await question("Maksimal amount TEA untuk dikirim: ");
        
        if (isNaN(parseFloat(minAmount)) || isNaN(parseFloat(maxAmount)) || 
            parseFloat(minAmount) <= 0 || parseFloat(maxAmount) <= 0 || 
            parseFloat(minAmount) > parseFloat(maxAmount)) {
            console.error(chalk.red("Range amount tidak valid."));
            rl.close();
            process.exit(1);
        }
        
        rl.close();
        return { addresses, txCount, minAmount, maxAmount, walletIndex };
    } catch (error) {
        rl.close();
        throw error;
    }
};

// Fungsi untuk menjalankan TX dengan konfigurasi yang sudah disimpan
const runWithConfig = async (config) => {
    if (!config || !config.addresses) {
        console.error(chalk.red("Konfigurasi tidak valid (tidak ada alamat)."));
        return { success: false, error: "Konfigurasi tidak valid (tidak ada alamat)" };
    }
    
    if (!config.txCount || !config.minAmount || !config.maxAmount) {
        console.log(chalk.yellow("⚠️ Konfigurasi tidak lengkap, menggunakan nilai default yang hilang."));
        config.txCount = config.txCount || 1;
        config.minAmount = config.minAmount || 0.0001;
        config.maxAmount = config.maxAmount || 0.001;
    }
    
    try {
        // Check if walletIndex exists and is valid
        const walletIndex = config.walletIndex !== undefined ? parseInt(config.walletIndex) : -1;
        let result;
        
        // If walletIndex is -1 or undefined, use all wallets
        if (walletIndex === -1 || config.useAllWallets === true) {
            result = await sendTeaWithAllWallets(
                config.addresses, 
                config.txCount, 
                config.minAmount, 
                config.maxAmount
            );
        } else {
            result = await sendTeaWithSingleWallet(
                config.addresses, 
                config.txCount, 
                config.minAmount, 
                config.maxAmount,
                walletIndex
            );
        }
        
        return { success: true, ...result };
    } catch (error) {
        console.error(chalk.red("❌ Error:"), error.message);
        return { success: false, error: error.message };
    }
};

// Cek apakah script dipanggil dengan argumen konfigurasi
const parseCommandLineArgs = () => {
    try {
        const args = process.argv.slice(2);
        if (args.length > 0) {
            // Cek apakah ada file konfigurasi yang digunakan
            const configIndex = args.indexOf('--config');
            if (configIndex !== -1 && args.length > configIndex + 1) {
                try {
                    const configData = fs.readFileSync(args[configIndex + 1], 'utf8');
                    return JSON.parse(configData);
                } catch (error) {
                    console.error(chalk.red("Error membaca file konfigurasi:"), error.message);
                }
            }
            
            // Jika tidak, parse dari command line args
            const config = {};
            for (let i = 0; i < args.length; i += 2) {
                if (args[i].startsWith('--') && i + 1 < args.length) {
                    const key = args[i].slice(2);
                    config[key] = args[i + 1];
                }
            }
            
            // Parse nilai numerik
            if (config.txCount) config.txCount = parseInt(config.txCount);
            if (config.minAmount) config.minAmount = parseFloat(config.minAmount);
            if (config.maxAmount) config.maxAmount = parseFloat(config.maxAmount);
            if (config.walletIndex) config.walletIndex = parseInt(config.walletIndex);
            
            // "all" atau "true" untuk useAllWallets artinya gunakan semua wallet
            if (config.useAllWallets === "all" || config.useAllWallets === "true") {
                config.useAllWallets = true;
                config.walletIndex = -1;
            }
            
            // Gunakan alamat dari list.txt secara default jika tidak ada alamat yang disediakan
            if (!config.addresses) {
                config.addresses = readAddressesFromFile();
                if (config.addresses.length === 0) {
                    console.log(chalk.yellow("⚠️ Tidak ada alamat di list.txt, menggunakan alamat random"));
                    config.addresses = generateRandomAddresses(3); // Default ke 3 alamat random
                }
            }
            
            return config;
        }
    } catch (error) {
        console.error(chalk.red("Error parsing command line arguments:"), error.message);
    }
    
    return null;
};

// Fungsi utama
const main = async () => {
    try {
        // Periksa apakah ada konfigurasi dari command line
        const cmdConfig = parseCommandLineArgs();
        
        // Jika ada konfigurasi, gunakan itu
        if (cmdConfig) {
            console.log(chalk.cyan("Menggunakan konfigurasi dari command line atau file"));
            await runWithConfig(cmdConfig);
        } 
        // Jika tidak, minta input dari pengguna
        else {
            const config = await getUserInput();
            await runWithConfig(config);
        }
    } catch (error) {
        console.error(chalk.red("❌ Error:"), error.message);
    }
};

// Ekspor fungsi yang diperlukan
module.exports = { main, runWithConfig, parseCommandLineArgs };

// Mulai program jika file ini dijalankan langsung
if (require.main === module) {
    main();
}