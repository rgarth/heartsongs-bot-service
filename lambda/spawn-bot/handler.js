// heartsongs-bot-service/lambda/spawn-bot/handler.js
const AWS = require('aws-sdk');
const axios = require('axios');

const lambda = new AWS.Lambda();

// Simple in-memory rate limiter (resets on cold start)
let spawnAttempts = 0;
let lastSpawnTime = 0;
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_SPAWNS_PER_MINUTE = 10;

// Bot personality configurations
const PERSONALITIES = {
  eclectic: {
    name: 'Eclectic Explorer',
    description: 'Loves discovering hidden gems across all genres',
    votingStyle: 'creative',
    temperature: 0.8,
    namePrefix: 'eclectic'
  },
  mainstream: {
    name: 'Chart Topper',
    description: 'Knows all the hits and crowd favorites',
    votingStyle: 'popular',
    temperature: 0.4,
    namePrefix: 'pop'
  },
  indie: {
    name: 'Indie Insider',
    description: 'Champions underground and alternative artists',
    votingStyle: 'authentic',
    temperature: 0.9,
    namePrefix: 'indie'
  },
  vintage: {
    name: 'Time Traveler',
    description: 'Expert in classic tracks from decades past',
    votingStyle: 'nostalgic',
    temperature: 0.6,
    namePrefix: 'classic'
  },
  analytical: {
    name: 'Music Scholar',
    description: 'Makes decisions based on musical theory and lyrics',
    votingStyle: 'intellectual',
    temperature: 0.3,
    namePrefix: 'maestro'
  }
};

/**
 * Simple rate limiting check
 */
function checkRateLimit() {
  const now = Date.now();
  
  // Reset counter if window has passed
  if (now - lastSpawnTime > RATE_LIMIT_WINDOW) {
    spawnAttempts = 0;
    lastSpawnTime = now;
  }
  
  // Check if we're over the limit
  if (spawnAttempts >= MAX_SPAWNS_PER_MINUTE) {
    const waitTime = RATE_LIMIT_WINDOW - (now - lastSpawnTime);
    throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(waitTime / 1000)} seconds before trying again.`);
  }
  
  spawnAttempts++;
  lastSpawnTime = now;
}

/**
 * Sleep utility function
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Exponential backoff retry function
 */
async function retryWithBackoff(operation, maxRetries = 5, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Check if this is a retryable error
      const isRetryable = isRetryableError(error);
      
      if (attempt === maxRetries || !isRetryable) {
        throw error;
      }
      
      // Calculate delay with exponential backoff and jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`);
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error) {
  // Retry on rate limiting (429)
  if (error.response?.status === 429) {
    return true;
  }
  
  // Retry on server errors (5xx)
  if (error.response?.status >= 500) {
    return true;
  }
  
  // Retry on network errors
  if (error.code === 'ECONNRESET' || 
      error.code === 'ETIMEDOUT' || 
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED') {
    return true;
  }
  
  return false;
}

/**
 * Register bot with retry logic
 */
async function registerBot(botName, apiUrl) {
  console.log(`🔄 Attempting to register bot: ${botName}`);
  
  return await retryWithBackoff(async () => {
    const response = await axios.post(`${apiUrl}/auth/register-anonymous`, {
      username: botName
    }, {
      timeout: 15000, // Increased timeout
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HeartSongs-Bot-Service/1.0'
      }
    });
    
    console.log(`✅ Bot registration successful: ${botName}`);
    return response;
  }, 5, 2000); // 5 retries, 2 second base delay
}

/**
 * Join game with retry logic
 */
async function joinGame(gameCode, botUser, sessionToken, apiUrl) {
  console.log(`🔄 Attempting to join game: ${gameCode}`);
  
  return await retryWithBackoff(async () => {
    const response = await axios.post(`${apiUrl}/game/join`, {
      gameCode: gameCode,
      userId: botUser.id
    }, {
      headers: { 
        Authorization: `Bearer ${sessionToken}`,
        'User-Agent': 'HeartSongs-Bot-Service/1.0'
      },
      timeout: 15000
    });
    
    console.log(`✅ Game join successful: ${gameCode}`);
    return response;
  }, 3, 1000); // 3 retries, 1 second base delay
}

exports.handler = async (event, context) => {
  try {
    console.log('Spawn bot request:', JSON.stringify(event, null, 2));
    console.log('Environment variables check:', {
      hasHeartsOngsApiUrl: !!process.env.HEARTSONGS_API_URL,
      heartsOngsApiUrl: process.env.HEARTSONGS_API_URL,
      hasOpenAiKey: !!process.env.OPENAI_API_KEY,
      serviceName: process.env.SERVICE_NAME,
      stage: process.env.STAGE
    });
    
    // Check rate limiting first
    try {
      checkRateLimit();
    } catch (rateLimitError) {
      console.warn('Rate limit exceeded:', rateLimitError.message);
      return {
        statusCode: 429,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Rate limit exceeded',
          details: rateLimitError.message,
          retryAfter: Math.ceil(RATE_LIMIT_WINDOW / 1000)
        })
      };
    }
    
    // Add a small delay to help reduce API load
    const spawnDelay = Math.random() * 2000; // 0-2 seconds
    console.log(`Adding spawn delay of ${Math.round(spawnDelay)}ms to reduce API load...`);
    await sleep(spawnDelay);
    
    // Check if required environment variables are set
    if (!process.env.HEARTSONGS_API_URL) {
      console.error('HEARTSONGS_API_URL environment variable not set');
      return {
        statusCode: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          error: 'Server configuration error',
          details: 'HEARTSONGS_API_URL not configured',
          availableEnvVars: Object.keys(process.env).filter(key => !key.includes('AWS'))
        })
      };
    }
    
    const { gameCode, personality = 'eclectic', gameId } = JSON.parse(event.body || '{}');
    
    if (!gameCode) {
      return {
        statusCode: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Game code is required' })
      };
    }

    const botConfig = PERSONALITIES[personality] || PERSONALITIES.eclectic;
    console.log(`Using bot personality: ${botConfig.name}`);
    
    // Generate unique 4-digit number with timestamp to reduce collisions
    const timestamp = Date.now().toString().slice(-4);
    const randomNumber = Math.floor(1000 + Math.random() * 9000);
    const uniqueNumber = `${timestamp}${randomNumber}`.slice(-4);
    
    // Create bot name using the new format
    const botName = `${botConfig.namePrefix}_bot_${uniqueNumber}`;
    
    console.log(`🤖 Generated bot name: ${botName}`);
    console.log(`🔗 Using API URL: ${process.env.HEARTSONGS_API_URL}`);
    
    try {
      // Step 1: Register the bot with retry logic
      console.log('📝 Step 1: Registering bot with Heart Songs API...');
      let registrationResponse;
      
      try {
        registrationResponse = await registerBot(botName, process.env.HEARTSONGS_API_URL);
        console.log('Registration response status:', registrationResponse.status);
        console.log('Registration response data:', registrationResponse.data);
        
      } catch (regError) {
        console.error('❌ Bot registration failed after all retries:', {
          message: regError.message,
          status: regError.response?.status,
          data: regError.response?.data,
          url: regError.config?.url,
          attempts: '5+'
        });
        
        // Special handling for rate limiting errors
        if (regError.response?.status === 429) {
          return {
            statusCode: 429,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
              error: 'API rate limit exceeded',
              details: 'The Heart Songs API is currently experiencing high traffic. Please try again in a few minutes.',
              step: 'registration',
              retryAfter: 60
            })
          };
        }
        
        return {
          statusCode: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            error: 'Bot registration failed',
            details: regError.response?.data || regError.message,
            step: 'registration',
            apiUrl: `${process.env.HEARTSONGS_API_URL}/auth/register-anonymous`,
            botName: botName,
            retryAttempts: 5
          })
        };
      }
      
      const { user: botUser, sessionToken } = registrationResponse.data;
      console.log(`✅ Bot registered successfully: ${botUser.displayName} (ID: ${botUser.id})`);
      
      // Step 2: Join the game with retry logic
      console.log('🎮 Step 2: Bot joining game...');
      let joinResponse;
      
      try {
        joinResponse = await joinGame(gameCode, botUser, sessionToken, process.env.HEARTSONGS_API_URL);
        console.log('Join response status:', joinResponse.status);
        console.log('Join response data:', joinResponse.data);
        
      } catch (joinError) {
        console.error('❌ Game join failed after all retries:', {
          message: joinError.message,
          status: joinError.response?.status,
          data: joinError.response?.data,
          url: joinError.config?.url,
          gameCode: gameCode,
          botUserId: botUser.id,
          attempts: '3+'
        });
        
        return {
          statusCode: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            error: 'Game join failed',
            details: joinError.response?.data || joinError.message,
            step: 'game_join',
            gameCode: gameCode,
            botId: botUser.id,
            botName: botUser.displayName,
            retryAttempts: 3
          })
        };
      }
      
      // Step 3: Start the bot worker function
      const workerPayload = {
        botId: botUser.id,
        botName: botUser.displayName,
        gameCode: gameCode,
        gameId: joinResponse.data.gameId,
        sessionToken: sessionToken,
        personality: personality,
        personalityConfig: botConfig
      };
      
      console.log('🚀 Starting bot worker with payload:', workerPayload);
      
      // Invoke bot worker asynchronously with retry logic
      try {
        await retryWithBackoff(async () => {
          await lambda.invoke({
            FunctionName: `${process.env.SERVICE_NAME}-${process.env.STAGE}-bot-worker`,
            InvocationType: 'Event', // Async invocation
            Payload: JSON.stringify(workerPayload)
          }).promise();
        }, 3, 1000);
        
        console.log('✅ Bot worker started successfully');
        
      } catch (workerError) {
        console.error('⚠️ Bot worker invocation failed after retries:', workerError.message);
        
        // Even if worker fails, the bot joined the game successfully
        return {
          statusCode: 200,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            success: true,
            botId: botUser.id,
            botName: botUser.displayName,
            personality: botConfig.name,
            message: 'Bot joined game but worker startup may have failed',
            warning: workerError.message
          })
        };
      }
      
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: true,
          botId: botUser.id,
          botName: botUser.displayName,
          personality: botConfig.name,
          message: 'Bot is joining the game...'
        })
      };
      
    } catch (error) {
      console.error('💥 Unexpected error during bot spawn:', error);
      
      return {
        statusCode: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Failed to spawn bot',
          details: error.message,
          timestamp: new Date().toISOString()
        })
      };
    }
    
  } catch (error) {
    console.error('💥 Critical error spawning bot:', error);
    
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Failed to spawn bot',
        details: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};