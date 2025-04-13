const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Spinner = require('cli-spinner').Spinner;

// Configuration
const config = {
  apiKey: 'bqsV1s934E4fpFvFi2ENl1tpMJQziPom7acRzr6Cl90jzXMT7NqThPX7eOZo', // Replace with your Scrappey API key
  faucetUrl: 'https://faucet-sepolia.tea.xyz/',
  apiBaseUrl: 'https://faucet-sepolia.tea.xyz/api',
  scrappeyUrl: 'https://publisher.scrappey.com/api/v1',
  hcaptchaSitekey: '7ae64cc4-ef02-4e46-939c-757456082314',
  delayBetweenRequests: 3000,
  maxRetries: 3,
  checkStatusInterval: 5000,
  maxStatusChecks: 30,
  successAfterClaimingChecks: 5,   // Consider success after this many "claiming" checks
  maxErrorsBeforeSuccess: 3,       // Consider success after this many monitoring errors
  claimsPerWallet: 2,              // Number of claims per wallet before moving to next wallet
  captchaTimeout: 120000,          // 2 minutes timeout for captcha solving
  requestTimeout: 30000,           // 30 seconds timeout for API requests
  walletFilePath: path.join(__dirname, 'wallet.txt'),
  proxyFilePath: path.join(__dirname, 'proxy.txt'),
  resultsFilePath: path.join(__dirname, 'results.txt'),
  claimStateFilePath: path.join(__dirname, 'claim_state.json'),
  dailyLimitLogFilePath: path.join(__dirname, 'daily_limit_log.txt'),
};

// Helper function to create a spinner
function createSpinner(text) {
  const spinner = new Spinner(`${text}`);
  spinner.setSpinnerString('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏');
  return spinner;
}

// Helper function to show success message
function showSuccess(message) {
  console.log(`✔ ${message}`);
}

// Helper function to show error message
function showError(message) {
  console.log(`✖ ${message}`);
}

// Helper function to show important message (for daily limits)
function showImportant(message) {
  console.log(`\n${'!'.repeat(50)}`);
  console.log(`!!! ${message}`);
  console.log(`${'!'.repeat(50)}\n`);
}

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to read wallets from file
function readWallets() {
  try {
    const data = fs.readFileSync(config.walletFilePath, 'utf8');
    return data.split('\n')
      .map(line => line.trim())
      .filter(line => line && line.startsWith('0x') && line.length === 42);
  } catch (error) {
    showError(`Error reading wallet file: ${error.message}`);
    return [];
  }
}

// Helper function to read proxies from file
function readProxies() {
  try {
    const data = fs.readFileSync(config.proxyFilePath, 'utf8');
    return data.split('\n')
      .map(line => line.trim())
      .filter(line => line && line.includes(':'));
  } catch (error) {
    showError(`Error reading proxy file: ${error.message}`);
    return [];
  }
}

// Helper function to log results to file
function logResult(wallet, status, txHash = '', error = '') {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] Wallet: ${wallet} | Status: ${status} | TX: ${txHash} | Error: ${error}\n`;
  
  // Create results file if it doesn't exist
  if (!fs.existsSync(config.resultsFilePath)) {
    fs.writeFileSync(config.resultsFilePath, '--- TEA PROTOCOL FAUCET CLAIM RESULTS ---\n\n');
  }
  
  fs.appendFileSync(config.resultsFilePath, logLine);
}

// Helper function to log daily limit to a separate file
function logDailyLimit(wallet, reason) {
  try {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] Wallet: ${wallet} | Reason: ${reason}\n`;
    
    // Create file if it doesn't exist
    if (!fs.existsSync(config.dailyLimitLogFilePath)) {
      fs.writeFileSync(config.dailyLimitLogFilePath, '--- TEA PROTOCOL DAILY LIMIT LOG ---\n\n');
    }
    
    fs.appendFileSync(config.dailyLimitLogFilePath, logLine);
    showSuccess(`Daily limit for ${wallet} logged to ${config.dailyLimitLogFilePath}`);
  } catch (error) {
    showError(`Error logging daily limit: ${error.message}`);
  }
}

// Helper function to format proxy for Scrappey
function formatProxy(proxyString) {
  // Expected format from file: ip:port:username:password or ip:port or domain:port
  const parts = proxyString.split(':');
  
  // Check if proxy is a domain or IP
  const isDomain = !parts[0].match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/);
  
  if (parts.length === 2) {
    // Format: ip:port or domain:port
    return {
      [isDomain ? 'hostname' : 'ip']: parts[0],
      port: parts[1],
      auth: null
    };
  } else if (parts.length === 4) {
    // Format: ip:port:username:password or domain:port:username:password
    return {
      [isDomain ? 'hostname' : 'ip']: parts[0],
      port: parts[1],
      auth: {
        username: parts[2],
        password: parts[3]
      }
    };
  } else {
    throw new Error(`Invalid proxy format: ${proxyString}. Please use ip:port or ip:port:username:password`);
  }
}

// Function to solve hCaptcha using Scrappey
async function solveHCaptcha(sitekey, pageUrl, proxy = null, captchaType = 'first') {
  const spinner = createSpinner(`Solving ${captchaType} captcha`);
  spinner.start();
  
  try {
    const body = {
      cmd: 'request.get',
      url: pageUrl,
      dontLoadMainSite: true,
      filter: ['javascriptReturn'],
      browserActions: [
        {
          type: 'solve_captcha',
          captcha: 'hcaptcha',
          captchaData: {
            sitekey: sitekey
          }
        }
      ]
    };
    
    // Add proxy if provided
    if (proxy) {
      body.proxy = proxy;
    }
    
    // Add random user agent to avoid blocks
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15'
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    
    // Add user agent to request
    body.customHttpHeaders = {
      'User-Agent': randomUserAgent
    };
    
    const response = await axios.post(
      `${config.scrappeyUrl}?key=${config.apiKey}`,
      body,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: config.captchaTimeout // 2 minutes timeout for captcha solving
      }
    );
    
    // Check if solution exists
    if (response.data && response.data.solution && response.data.solution.verified === true) {
      // Check if javascriptReturn is an array or direct value
      if (Array.isArray(response.data.solution.javascriptReturn) && response.data.solution.javascriptReturn.length > 0) {
        spinner.stop(true);
        showSuccess(`${captchaType.charAt(0).toUpperCase() + captchaType.slice(1)} captcha solved successfully`);
        return response.data.solution.javascriptReturn[0];
      } else if (response.data.solution.javascriptReturn) {
        spinner.stop(true);
        showSuccess(`${captchaType.charAt(0).toUpperCase() + captchaType.slice(1)} captcha solved successfully`);
        return response.data.solution.javascriptReturn;
      }
    }
    
    // Handle specific error cases
    if (response.data && response.data.error) {
      if (response.data.error.includes('All server capacity is used')) {
        spinner.stop(true);
        showError(`Scrappey server capacity error for ${captchaType} captcha`);
        // Wait longer when capacity is full
        await wait(15000);
        throw new Error('Scrappey server capacity error: ' + response.data.error);
      }
    }
    
    spinner.stop(true);
    showError(`Failed to get valid captcha solution for ${captchaType} captcha`);
    throw new Error(`Failed to get valid captcha solution from Scrappey for ${captchaType} captcha`);
    
  } catch (error) {
    spinner.stop(true);
    if (error.response) {
      showError(`Error solving ${captchaType} captcha: Server responded with ${error.response.status}`);
      throw new Error(`Error solving ${captchaType} captcha: Server responded with ${error.response.status}`);
    } else if (error.request) {
      showError(`Error solving ${captchaType} captcha: No response from server (timeout)`);
      throw new Error(`Error solving ${captchaType} captcha: No response from server (timeout)`);
    } else {
      showError(`Error solving ${captchaType} captcha: ${error.message}`);
      throw error;
    }
  }
}

// Function to load or initialize claim state
function loadClaimState() {
  try {
    if (fs.existsSync(config.claimStateFilePath)) {
      const data = fs.readFileSync(config.claimStateFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    showError(`Error reading claim state file: ${error.message}`);
  }
  
  // Initialize new state if file doesn't exist or is invalid
  return {
    walletClaimCount: {},
    dailyLimitWallets: {},
    currentCycle: 1,
    lastRunTime: Date.now()
  };
}

// Function to save claim state
function saveClaimState(state) {
  try {
    fs.writeFileSync(config.claimStateFilePath, JSON.stringify(state, null, 2));
  } catch (error) {
    showError(`Error saving claim state: ${error.message}`);
  }
}

// Function to check if a wallet has reached daily limit directly (optional API call)
async function checkDailyLimit(walletAddress) {
  try {
    // Try to query if API has a direct method to check limits
    const checkUrl = `${config.apiBaseUrl}/checkAddress?addr=${walletAddress}`;
    
    const response = await axios.get(checkUrl, {
      timeout: config.requestTimeout
    });
    
    // Check if the response indicates daily limit
    if (response.data && 
        (response.data.status === "failed" || 
         response.data.hasReachedLimit === true ||
         (response.data.message && response.data.message.toLowerCase().includes('limit')))) {
      
      return {
        limitReached: true,
        reason: response.data.message || response.data.failedReason || "Daily claim limit reached"
      };
    }
    
    return { limitReached: false };
  } catch (error) {
    // In case of error, we assume the limit is not reached
    return { limitReached: false };
  }
}

// Function to claim TEA Protocol Faucet tokens
// Improved monitoring system with enhanced handling for claiming states and daily limits
async function claimFaucet(walletAddress, proxy = null, claimState) {
  showSuccess(`Starting process for wallet: ${walletAddress}`);
  
  // First, check if this wallet is already known to have reached the daily limit
  if (claimState.dailyLimitWallets && claimState.dailyLimitWallets[walletAddress]) {
    // Check if the limit was identified in the last 24 hours
    const limitTimestamp = claimState.dailyLimitWallets[walletAddress].timestamp;
    const timeDiff = Date.now() - limitTimestamp;
    const hoursDiff = timeDiff / (1000 * 60 * 60);
    
    if (hoursDiff < 24) {
      // Still within the 24-hour window
      showImportant(`DAILY LIMIT: Wallet ${walletAddress} already reached daily limit (identified ${hoursDiff.toFixed(1)} hours ago)`);
      logResult(walletAddress, 'DAILY_LIMIT_CACHED', '', claimState.dailyLimitWallets[walletAddress].reason);
      return { success: false, status: 'DAILY_LIMIT_REACHED', error: claimState.dailyLimitWallets[walletAddress].reason };
    } else {
      // More than 24 hours have passed, remove from daily limit list
      delete claimState.dailyLimitWallets[walletAddress];
      saveClaimState(claimState);
    }
  }
  
  if (proxy) {
    const proxyString = proxy.ip || proxy.hostname;
    const proxyPort = proxy.port;
    const proxyInfo = `${proxyString}:${proxyPort}`;
    showSuccess(`Using proxy: ${proxyInfo}`);
  }
  
  let sessionToken = null;
  let firstCaptchaSolution = null;
  
  try {
    // Step 1: Solve first hCaptcha for session start
    firstCaptchaSolution = await solveHCaptcha(
      config.hcaptchaSitekey,
      config.faucetUrl,
      proxy,
      'first'
    );
    
    // Step 2: Start session with wallet and first captcha token
    const sessionSpinner = createSpinner('Starting session with wallet');
    sessionSpinner.start();
    
    const startSessionPayload = {
      addr: walletAddress,
      captchaToken: firstCaptchaSolution,
      cliver: '2.3.4' // Client version
    };
    
    // Prepare headers
    const headers = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'referer': config.faucetUrl,
      'origin': new URL(config.faucetUrl).origin
    };
    
    // Post to start session
    try {
      const startSessionResponse = await axios.post(
        `${config.apiBaseUrl}/startSession`,
        startSessionPayload,
        { 
          headers,
          timeout: config.requestTimeout
        }
      );
      
      // Check for daily limit error in the response
      if (startSessionResponse.data && startSessionResponse.data.status === "failed") {
        sessionSpinner.stop(true);
        
        // Check for any pattern that indicates daily limit
        // Check for any pattern that indicates daily limit
    if (startSessionResponse.data.failedCode === "RECURRING_LIMIT" || 
    (startSessionResponse.data.failedReason && 
    (startSessionResponse.data.failedReason.toLowerCase().includes('already requested') ||
    startSessionResponse.data.failedReason.toLowerCase().includes('already holding') ||
    startSessionResponse.data.failedReason.toLowerCase().includes('give others a chance')))) {
          
          const reason = startSessionResponse.data.failedReason || "You have already reached daily limit";
          showImportant(`DAILY LIMIT REACHED: ${reason}`);
          
          // Log to results file
          logResult(walletAddress, 'DAILY_LIMIT_REACHED', '', reason);
          
          // Log to specific daily limit file
          logDailyLimit(walletAddress, reason);
          
          // Add to claim state
          if (!claimState.dailyLimitWallets) {
            claimState.dailyLimitWallets = {};
          }
          claimState.dailyLimitWallets[walletAddress] = {
            timestamp: Date.now(),
            reason: reason
          };
          saveClaimState(claimState);
          
          return { success: false, status: 'DAILY_LIMIT_REACHED', error: reason };
        } else {
          // Handle other failed states
          showError(`Failed to start session: ${startSessionResponse.data.failedReason}`);
          logResult(walletAddress, 'FAILED', '', `${startSessionResponse.data.failedCode}: ${startSessionResponse.data.failedReason}`);
          return { success: false, status: 'FAILED', error: startSessionResponse.data.failedReason };
        }
      }
      
      if (!startSessionResponse.data || !startSessionResponse.data.session) {
        sessionSpinner.stop(true);
        showError('Failed to start session: Invalid response');
        throw new Error('Failed to start session: Invalid response');
      }
      
      sessionToken = startSessionResponse.data.session;
      sessionSpinner.stop(true);
      showSuccess(`Session started successfully (ID: ${sessionToken.substring(0, 8)}...)`);
    } catch (error) {
      sessionSpinner.stop(true);
      
      // Check for axios error response with max limit status
      if (error.response && error.response.data) {
        if ((error.response.data.status === "failed" && error.response.data.failedCode === "RECURRING_LIMIT") ||
            (error.response.data.failedReason && 
             error.response.data.failedReason.toLowerCase().includes('already requested'))) {
          
          const reason = error.response.data.failedReason || "You have already requested your daily limit";
          showImportant(`DAILY LIMIT REACHED: ${reason}`);
          
          // Log to results file
          logResult(walletAddress, 'DAILY_LIMIT_REACHED', '', reason);
          
          // Log to specific daily limit file
          logDailyLimit(walletAddress, reason);
          
          // Add to claim state
          if (!claimState.dailyLimitWallets) {
            claimState.dailyLimitWallets = {};
          }
          claimState.dailyLimitWallets[walletAddress] = {
            timestamp: Date.now(),
            reason: reason
          };
          saveClaimState(claimState);
          
          return { success: false, status: 'DAILY_LIMIT_REACHED', error: reason };
        }
      }
      
      if (error.response) {
        showError(`Failed to start session: Server responded with ${error.response.status}`);
        throw new Error(`Failed to start session: Server responded with ${error.response.status}`);
      } else if (error.request) {
        showError('Failed to start session: No response from server (timeout)');
        throw new Error('Failed to start session: No response from server (timeout)');
      } else {
        showError(`Failed to start session: ${error.message}`);
        throw error;
      }
    }
    
    // Wait a bit before next request
    await wait(config.delayBetweenRequests);
    
    // Step 3: Check session status
    const statusSpinner = createSpinner('Checking session status');
    statusSpinner.start();
    
    let sessionStatusResponse;
    try {
      sessionStatusResponse = await axios.get(
        `${config.apiBaseUrl}/getSessionStatus`,
        {
          params: {
            session: sessionToken,
            details: 1
          },
          headers,
          timeout: config.requestTimeout
        }
      );
    } catch (error) {
      statusSpinner.stop(true);
      if (error.response) {
        showError(`Failed to check session status: Server responded with ${error.response.status}`);
        throw new Error(`Failed to check session status: Server responded with ${error.response.status}`);
      } else if (error.request) {
        showError('Failed to check session status: No response from server (timeout)');
        throw new Error('Failed to check session status: No response from server (timeout)');
      } else {
        showError(`Failed to check session status: ${error.message}`);
        throw error;
      }
    }
    
    const sessionStatus = sessionStatusResponse.data.status;
    statusSpinner.stop(true);
    showSuccess(`Session status: ${sessionStatus}`);
    
    if (sessionStatus !== 'claimable') {
      if (sessionStatus === 'claimed') {
        showSuccess('Wallet has already claimed tokens!');
        
        // Get current claim count for this wallet from the claim state
        const currentClaimCount = claimState?.walletClaimCount?.[walletAddress] || 0;
        
        // Show appropriate message based on claim count
        if (currentClaimCount >= config.claimsPerWallet - 1) {
          showSuccess('Already reached max claim limit for today (2/2)!');
        } else {
          showSuccess(`Completed claim ${currentClaimCount + 1}/${config.claimsPerWallet} for today`);
        }
        
        logResult(walletAddress, 'ALREADY_CLAIMED');
        return { success: true, status: 'ALREADY_CLAIMED' };
      } else {
        showError(`Session is not claimable: ${sessionStatus}`);
        throw new Error(`Session is not claimable: ${sessionStatus}`);
      }
    }
    // Step 4: Solve second hCaptcha for claim with retry
    let secondCaptchaSolution = null;
    let secondCaptchaAttempt = 0;
    const maxSecondCaptchaRetries = 3;
    
    while (!secondCaptchaSolution && secondCaptchaAttempt < maxSecondCaptchaRetries) {
      secondCaptchaAttempt++;
      
      try {
        secondCaptchaSolution = await solveHCaptcha(
          config.hcaptchaSitekey,
          config.faucetUrl,
          proxy,
          'second'
        );
      } catch (captchaError) {
        // Specifically for server capacity error
        if (captchaError.message.includes('capacity')) {
          showError(`Second captcha attempt ${secondCaptchaAttempt}/${maxSecondCaptchaRetries} failed: Server capacity issue`);
          
          if (secondCaptchaAttempt < maxSecondCaptchaRetries) {
            // Wait before retrying
            const capacityWaitTime = 15000 + (secondCaptchaAttempt * 5000); // Increasing wait time with each attempt
            console.log(`\nWaiting ${capacityWaitTime/1000} seconds before retrying second captcha...`);
            
            const waitSpinner = createSpinner(`Waiting for server capacity...`);
            waitSpinner.start();
            await wait(capacityWaitTime);
            waitSpinner.stop(true);
            
            showSuccess(`Retrying second captcha (attempt ${secondCaptchaAttempt + 1}/${maxSecondCaptchaRetries})`);
            continue;
          }
        }
        
        // Other errors for second captcha
        showError(`All second captcha attempts failed: ${captchaError.message}`);
        throw captchaError;
      }
    }
    
    if (!secondCaptchaSolution) {
      throw new Error('Failed to get valid second captcha solution after multiple attempts');
    }
    
    // Step 5: Claim the reward
    const claimSpinner = createSpinner('Claiming reward');
    claimSpinner.start();
    
    const claimPayload = {
      session: sessionToken,
      captchaToken: secondCaptchaSolution
    };
    
    let claimResponse;
    try {
      claimResponse = await axios.post(
        `${config.apiBaseUrl}/claimReward`,
        claimPayload,
        { 
          headers,
          timeout: config.requestTimeout
        }
      );
      
      // Check if response indicates daily limit
      if (claimResponse.data && claimResponse.data.status === "failed") {
        claimSpinner.stop(true);
        
        if (claimResponse.data.failedCode === "RECURRING_LIMIT" || 
            (claimResponse.data.failedReason && 
             claimResponse.data.failedReason.toLowerCase().includes('already requested'))) {
          
          const reason = claimResponse.data.failedReason || "You have already requested your daily limit";
          showImportant(`DAILY LIMIT REACHED: ${reason}`);
          
          // Log to results file
          logResult(walletAddress, 'DAILY_LIMIT_REACHED', '', reason);
          
          // Log to specific daily limit file
          logDailyLimit(walletAddress, reason);
          
          // Add to claim state
          if (!claimState.dailyLimitWallets) {
            claimState.dailyLimitWallets = {};
          }
          claimState.dailyLimitWallets[walletAddress] = {
            timestamp: Date.now(),
            reason: reason
          };
          saveClaimState(claimState);
          
          return { success: false, status: 'DAILY_LIMIT_REACHED', error: reason };
        } else {
          showError(`Failed to claim reward: ${claimResponse.data.failedReason}`);
          throw new Error(`Failed to claim reward: ${claimResponse.data.failedReason}`);
        }
      }
      
      claimSpinner.stop(true);
      showSuccess('Claim initiated successfully');
    } catch (error) {
      claimSpinner.stop(true);
      
      // Check for axios error response with max limit status
      if (error.response && error.response.data) {
        if ((error.response.data.status === "failed" && error.response.data.failedCode === "RECURRING_LIMIT") ||
            (error.response.data.failedReason && error.response.data.failedReason.toLowerCase().includes('already requested'))) {
          
          const reason = error.response.data.failedReason || "You have already requested your daily limit";
          showImportant(`DAILY LIMIT REACHED: ${reason}`);
          
          // Log to results file
          logResult(walletAddress, 'DAILY_LIMIT_REACHED', '', reason);
          
          // Log to specific daily limit file
          logDailyLimit(walletAddress, reason);
          
          // Add to claim state
          if (!claimState.dailyLimitWallets) {
            claimState.dailyLimitWallets = {};
          }
          claimState.dailyLimitWallets[walletAddress] = {
            timestamp: Date.now(),
            reason: reason
          };
          saveClaimState(claimState);
          
          return { success: false, status: 'DAILY_LIMIT_REACHED', error: reason };
        }
      }
      
      if (error.response) {
        showError(`Failed to claim reward: Server responded with ${error.response.status}`);
        throw new Error(`Failed to claim reward: Server responded with ${error.response.status}`);
      } else if (error.request) {
        showError('Failed to claim reward: No response from server (timeout)');
        throw new Error('Failed to claim reward: No response from server (timeout)');
      } else {
        showError(`Failed to claim reward: ${error.message}`);
        throw error;
      }
    }
    
    // Step 6: Monitor claim status with improved handling
    let statusChecks = 0;
    let claimCompleted = false;
    let consecutiveClaimingChecks = 0;
    let monitoringErrors = 0;
    
    const monitorSpinner = createSpinner('Monitoring claim status');
    monitorSpinner.start();
    
    while (statusChecks < config.maxStatusChecks && !claimCompleted) {
      statusChecks++;
      
      try {
        const checkStatusResponse = await axios.get(
          `${config.apiBaseUrl}/getSessionStatus`,
          {
            params: {
              session: sessionToken,
              details: 1
            },
            headers,
            timeout: config.requestTimeout
          }
        );
        
        const claimStatus = checkStatusResponse.data.status;
        
        // Update spinner with current status
        monitorSpinner.stop(true);
        monitorSpinner.setSpinnerTitle(`Monitoring claim status (${claimStatus})`);
        monitorSpinner.start();
        
        // Handle different status conditions
        if (claimStatus === 'claimed' || claimStatus === 'finished') {
          // Claim is successful
          monitorSpinner.stop(true);
          showSuccess('Claim finished successfully');
          
          // Show claim count information
          const currentClaimCount = claimState?.walletClaimCount?.[walletAddress] || 0;
          showSuccess(`Completed claim ${currentClaimCount + 1}/${config.claimsPerWallet} for today`);
          
          logResult(walletAddress, 'SUCCESS', '');
          claimCompleted = true;
          return { success: true, status: 'SUCCESS' };
        } else if (claimStatus === 'claiming') {
          // Count consecutive "claiming" status checks
          consecutiveClaimingChecks++;
          
          // If we've seen "claiming" status multiple times in a row, consider it successful
          if (consecutiveClaimingChecks >= config.successAfterClaimingChecks) {
            monitorSpinner.stop(true);
            showSuccess(`Claim in progress for ${consecutiveClaimingChecks} checks - considering successful`);
            
            const currentClaimCount = claimState?.walletClaimCount?.[walletAddress] || 0;
            showSuccess(`Assuming completed claim ${currentClaimCount + 1}/${config.claimsPerWallet} for today`);
            
            logResult(walletAddress, 'SUCCESS_ASSUMED', '', 'Multiple claiming checks');
            claimCompleted = true;
            return { success: true, status: 'SUCCESS_ASSUMED' };
          }
        } else if (claimStatus === 'error') {
          monitorSpinner.stop(true);
          showError(`Error claiming tokens`);
          
          logResult(walletAddress, 'ERROR', '', '');
          return { success: false, status: 'ERROR' };
        } else {
          // For any other status, reset the consecutive claiming counter
          consecutiveClaimingChecks = 0;
        }
        
        // Wait before checking again
        await wait(config.checkStatusInterval);
      } catch (error) {
        // Handle errors in monitoring
        monitoringErrors++;
        monitorSpinner.stop(true);
        
        if (monitoringErrors >= config.maxErrorsBeforeSuccess) {
          // If we've encountered several monitoring errors but claim was initiated, assume success
          showSuccess(`Encountered ${monitoringErrors} monitoring errors - assuming claim is processing`);
          
          const currentClaimCount = claimState?.walletClaimCount?.[walletAddress] || 0;
          showSuccess(`Assuming completed claim ${currentClaimCount + 1}/${config.claimsPerWallet} for today`);
          
          logResult(walletAddress, 'SUCCESS_ASSUMED', '', 'Monitoring errors');
          claimCompleted = true;
          return { success: true, status: 'SUCCESS_ASSUMED' };
        }
        
        // Otherwise continue monitoring
        showError(`Error monitoring claim (attempt ${monitoringErrors}): ${error.message}`);
        monitorSpinner.setSpinnerTitle(`Monitoring claim status (error recovery)`);
        monitorSpinner.start();
        await wait(config.checkStatusInterval);
      }
    }
    
    // If we've reached max checks but claim was initiated, assume success
    if (!claimCompleted && statusChecks >= config.maxStatusChecks) {
      monitorSpinner.stop(true);
      showSuccess('Max status checks reached - assuming claim is processing');
      
      const currentClaimCount = claimState?.walletClaimCount?.[walletAddress] || 0;
      showSuccess(`Assuming completed claim ${currentClaimCount + 1}/${config.claimsPerWallet} for today`);
      
      logResult(walletAddress, 'SUCCESS_ASSUMED', '', 'Max checks reached');
      return { success: true, status: 'SUCCESS_ASSUMED' };
    }
    
  } catch (error) {
    showError(`Error in claim process: ${error.message}`);
    
    // Check if the error contains information about recurring limit/daily claim
    if (error.message.includes('RECURRING_LIMIT') || 
        error.message.toLowerCase().includes('already requested') || 
        error.message.toLowerCase().includes('daily limit')) {
      
      showImportant(`DAILY LIMIT REACHED for wallet ${walletAddress}`);
      logResult(walletAddress, 'DAILY_LIMIT_REACHED', '', error.message);
      
      // Add to claim state
      if (!claimState.dailyLimitWallets) {
        claimState.dailyLimitWallets = {};
      }
      claimState.dailyLimitWallets[walletAddress] = {
        timestamp: Date.now(),
        reason: error.message
      };
      saveClaimState(claimState);
      
      return { success: false, status: 'DAILY_LIMIT_REACHED', error: error.message };
    }
    
    logResult(walletAddress, 'FAILED', '', error.message);
    return { success: false, status: 'FAILED', error: error.message };
  }
}

// Main function to process all wallets with proxy rotation and better daily limit handling
async function processAllWallets() {
  console.log('TEA Protocol Sepolia Faucet Auto Claim Script (Scrappey Version)');
  console.log('-------------------------------------------------------------');
  
  // Read wallets and proxies
  const wallets = readWallets();
  const proxies = readProxies();
  
  showSuccess(`Loaded ${wallets.length} wallets and ${proxies.length} proxies`);
  
  if (wallets.length === 0) {
    showError('No valid wallets found in wallet.txt. Please add wallets in the format 0x...');
    return;
  }
  
  // Create results file header if it doesn't exist
  if (!fs.existsSync(config.resultsFilePath)) {
    fs.writeFileSync(config.resultsFilePath, '--- TEA PROTOCOL FAUCET CLAIM RESULTS ---\n\n');
  }
  
  // Load claim state
  const claimState = loadClaimState();
  
  // Initialize dailyLimitWallets if not exists
  if (!claimState.dailyLimitWallets) {
    claimState.dailyLimitWallets = {};
  }
  
  // Track daily limit wallets for reporting
  const dailyLimitReachedWallets = [];
  
  // Process each wallet - single run (no autoloop)
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    
    // Check if this wallet has already been claimed the maximum times in this cycle
    if (!claimState.walletClaimCount[wallet]) {
      claimState.walletClaimCount[wallet] = 0;
    }
    
    if (claimState.walletClaimCount[wallet] >= config.claimsPerWallet) {
      showSuccess(`Skipping wallet ${i+1}/${wallets.length}: ${wallet} (already claimed ${config.claimsPerWallet} times)`);
      continue;
    }
    
    // Check if this wallet has already been marked as having reached daily limit
    if (claimState.dailyLimitWallets[wallet]) {
      // Check if the limit was identified in the last 24 hours
      const limitTimestamp = claimState.dailyLimitWallets[wallet].timestamp;
      const timeDiff = Date.now() - limitTimestamp;
      const hoursDiff = timeDiff / (1000 * 60 * 60);
      
      if (hoursDiff < 24) {
        // Still within the 24-hour window
        showImportant(`SKIPPING: Wallet ${wallet} (${i+1}/${wallets.length}) already reached daily limit (${hoursDiff.toFixed(1)} hours ago)`);
        showError(`Reason: ${claimState.dailyLimitWallets[wallet].reason}`);
        
        // Add to report list
        dailyLimitReachedWallets.push({
          wallet: wallet,
          reason: claimState.dailyLimitWallets[wallet].reason,
          hoursAgo: hoursDiff.toFixed(1)
        });
        
        continue; // Skip this wallet
      } else {
        // More than 24 hours have passed, remove from daily limit list
        delete claimState.dailyLimitWallets[wallet];
        saveClaimState(claimState);
      }
    }
    
    const claimCount = claimState.walletClaimCount[wallet] + 1;
    
    // Create a clear separation between each claim attempt
    console.log(`\n${'='.repeat(50)}`);
    showSuccess(`Processing wallet ${i+1}/${wallets.length}: ${wallet} (Claim ${claimCount}/${config.claimsPerWallet})`);
    console.log(`${'='.repeat(50)}`);
    
    // Get proxy if available (round-robin)
    let proxy = null;
    if (proxies.length > 0) {
      const proxyString = proxies[i % proxies.length];
      try {
        proxy = formatProxy(proxyString);
      } catch (error) {
        showError(`Error formatting proxy: ${error.message}`);
        console.log('Will try without proxy for this wallet');
      }
    }
    
    // Try to claim with retries
    let attempt = 0;
    let success = false;
    let dailyLimitReached = false;
    
    while (!success && !dailyLimitReached && attempt < config.maxRetries) {
      attempt++;
      
      if (attempt > 1) {
        console.log(`\n----- RETRY ATTEMPT ${attempt}/${config.maxRetries} -----`);
        // Wait longer between retries
        const retryWaitTime = config.delayBetweenRequests * 3;
        await wait(retryWaitTime);
      }
      
      try {
        const result = await claimFaucet(wallet, proxy, claimState);
        
        // Check if daily limit has been reached
        if (result.status === 'DAILY_LIMIT_REACHED') {
          dailyLimitReached = true;
          
          // Add to report list
          dailyLimitReachedWallets.push({
            wallet: wallet,
            reason: result.error || 'Daily limit reached',
            hoursAgo: 0
          });
          
          // Mark this wallet as having reached daily limit immediately
          if (!claimState.dailyLimitWallets) {
            claimState.dailyLimitWallets = {};
          }
          claimState.dailyLimitWallets[wallet] = {
            timestamp: Date.now(),
            reason: result.error || 'Daily limit reached'
          };
          saveClaimState(claimState);
          
          showImportant(`DAILY LIMIT REACHED: Skipping all further attempts for wallet ${wallet}`);
          
          // We'll skip retries for this wallet now
          break;
        }
        
        // Handle various success or assumed success states
        if (result.success || result.status === 'SUCCESS_ASSUMED') {
          success = true;
          claimState.walletClaimCount[wallet]++;
          saveClaimState(claimState);
          
          // Show explicit success message for this claim attempt
          showSuccess(`Claim ${claimState.walletClaimCount[wallet]}/${config.claimsPerWallet} completed successfully for ${wallet}`);
          
          // If this wallet still needs more claims in this cycle, proceed with next claim
          if (claimState.walletClaimCount[wallet] < config.claimsPerWallet) {
            // Create a clear separation for the next claim attempt
            console.log(`\n${'='.repeat(50)}`);
            showSuccess(`Starting next claim for wallet ${i+1}/${wallets.length}: ${wallet} (Claim ${claimState.walletClaimCount[wallet] + 1}/${config.claimsPerWallet})`);
            console.log(`${'='.repeat(50)}`);
            
            // Reset success flag to try another claim for this wallet
            success = false;
            attempt = 0;
            continue; // Skip the waiting period and retry with same wallet
          }
        } else if (result.status === 'ALREADY_CLAIMED') {
          success = true;
          // Consider this as a successful claim for tracking purposes
          claimState.walletClaimCount[wallet]++;
          saveClaimState(claimState);
          
          // Show appropriate message based on claim count
          if (claimState.walletClaimCount[wallet] >= config.claimsPerWallet) {
            showSuccess(`Wallet ${wallet} has already claimed max tokens (${claimState.walletClaimCount[wallet]}/${config.claimsPerWallet})`);
          } else {
            showSuccess(`Wallet ${wallet} has already claimed (${claimState.walletClaimCount[wallet]}/${config.claimsPerWallet})`);
          }
          
          // If this wallet still needs more claims in this cycle, proceed with next claim
          if (claimState.walletClaimCount[wallet] < config.claimsPerWallet) {
            // Create a clear separation for the next claim attempt
            console.log(`\n${'='.repeat(50)}`);
            showSuccess(`Starting next claim for wallet ${i+1}/${wallets.length}: ${wallet} (Claim ${claimState.walletClaimCount[wallet] + 1}/${config.claimsPerWallet})`);
            console.log(`${'='.repeat(50)}`);
            
            // Reset success flag to try another claim for this wallet
            success = false;
            attempt = 0;
            continue; // Skip the waiting period and retry with same wallet
          }
        }
      } catch (error) {
        showError(`Attempt ${attempt} failed: ${error.message}`);
        
        // Check for daily limit in error message
          if (error.message.toLowerCase().includes('already holding') || 
          error.message.toLowerCase().includes('give others a chance') ||
          error.message.toLowerCase().includes('recurring_limit') || 
          error.message.toLowerCase().includes('already requested') || 
          error.message.toLowerCase().includes('daily limit')) {
          
          dailyLimitReached = true;
          
          // Add to report list
          dailyLimitReachedWallets.push({
            wallet: wallet,
            reason: error.message,
            hoursAgo: 0
          });
          
          showImportant(`DAILY LIMIT DETECTED: ${error.message}`);
          showImportant(`Skipping all further attempts for wallet ${wallet}`);
          
          // Mark this wallet as having reached its daily limit in the claim state
          if (!claimState.dailyLimitWallets) {
            claimState.dailyLimitWallets = {};
          }
          claimState.dailyLimitWallets[wallet] = {
            timestamp: Date.now(),
            reason: error.message
          };
          saveClaimState(claimState);
          
          // We'll skip retries for this wallet now
          break;
        }
        
        // Handle different types of errors with specific wait times
        if (error.message.includes('capacity')) {
          const capacityWaitTime = 30000; // 30 seconds
          console.log(`\nScrappey capacity issue detected. Waiting ${capacityWaitTime/1000} seconds before retry...`);
          
          const capacitySpinner = createSpinner(`Waiting ${capacityWaitTime/1000} seconds for capacity...`);
          capacitySpinner.start();
          await wait(capacityWaitTime);
          capacitySpinner.stop(true);
        } else if (error.message.includes('Failed to start session')) {
          // Session failures might need more time to recover
          const sessionWaitTime = 10000; // 10 seconds
          console.log(`\nSession initialization failed. Waiting ${sessionWaitTime/1000} seconds before retry...`);
          
          const sessionSpinner = createSpinner(`Waiting ${sessionWaitTime/1000} seconds before retry...`);
          sessionSpinner.start();
          await wait(sessionWaitTime);
          sessionSpinner.stop(true);
        }
      }
    }
    
    // Wait between wallets to avoid rate limiting
    if (i < wallets.length - 1) {
      const waitTime = config.delayBetweenRequests * 3;
      console.log('\n');
      const waitSpinner = createSpinner(`Waiting ${waitTime/1000} seconds before next wallet`);
      waitSpinner.start();
      await wait(waitTime);
      waitSpinner.stop(true);
      showSuccess(`Ready for next wallet`);
    }
  }
  
  // Report on daily limit wallets after all processing is complete
  if (dailyLimitReachedWallets.length > 0) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`DAILY LIMIT REACHED REPORT - ${dailyLimitReachedWallets.length} wallets`);
    console.log(`${'='.repeat(70)}`);
    
    for (const item of dailyLimitReachedWallets) {
      console.log(`Wallet: ${item.wallet}`);
      console.log(`Reason: ${item.reason}`);
      if (item.hoursAgo > 0) {
        console.log(`Detected: ${item.hoursAgo} hours ago`);
      } else {
        console.log(`Detected: Just now`);
      }
      console.log(`${'='.repeat(30)}`);
    }
    
    // Also log to the results file
    fs.appendFileSync(
      config.resultsFilePath, 
      `\n--- DAILY LIMIT REACHED WALLETS REPORT (${new Date().toISOString()}) ---\n` +
      dailyLimitReachedWallets.map(item => `Wallet: ${item.wallet} | Reason: ${item.reason}`).join('\n') +
      '\n\n'
    );
    
    // Also update the dedicated daily limit log file
    if (!fs.existsSync(config.dailyLimitLogFilePath)) {
      fs.writeFileSync(config.dailyLimitLogFilePath, '--- TEA PROTOCOL DAILY LIMIT LOG ---\n\n');
    }
    
    fs.appendFileSync(
      config.dailyLimitLogFilePath,
      `\n--- DAILY LIMIT SUMMARY (${new Date().toISOString()}) ---\n` +
      dailyLimitReachedWallets.map(item => `Wallet: ${item.wallet} | Reason: ${item.reason}`).join('\n') +
      '\n\n'
    );
  }
  
  // Update the last run time after all wallets have been processed
  claimState.lastRunTime = Date.now();
  saveClaimState(claimState);
  
  console.log(`\n${'='.repeat(70)}`);
  showSuccess(`Completed cycle #${claimState.currentCycle}! All wallets processed successfully.`);
  console.log(`${'='.repeat(70)}`);
  
  // Print daily limit summary again for visibility
  if (dailyLimitReachedWallets.length > 0) {
    console.log(`\n${'!'.repeat(70)}`);
    console.log(`!!! SUMMARY: ${dailyLimitReachedWallets.length} wallets reached daily claim limit !!!`);
    console.log(`!!! Check ${config.dailyLimitLogFilePath} for details !!!`);
    console.log(`${'!'.repeat(70)}\n`);
  }
}

// Run the script
processAllWallets().catch(error => {
  showError(`Script execution failed: ${error}`);
});