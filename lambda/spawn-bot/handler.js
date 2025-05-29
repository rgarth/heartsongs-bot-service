// heartsongs-bot-service/lambda/spawn-bot/handler.js
const AWS = require('aws-sdk');
const axios = require('axios');

const lambda = new AWS.Lambda();

// Bot personality configurations
const PERSONALITIES = {
  eclectic: {
    name: 'Eclectic Explorer',
    description: 'Loves discovering hidden gems across all genres',
    votingStyle: 'creative',
    temperature: 0.8
  },
  mainstream: {
    name: 'Chart Topper',
    description: 'Knows all the hits and crowd favorites',
    votingStyle: 'popular',
    temperature: 0.4
  },
  indie: {
    name: 'Indie Insider',
    description: 'Champions underground and alternative artists',
    votingStyle: 'authentic',
    temperature: 0.9
  },
  vintage: {
    name: 'Time Traveler',
    description: 'Expert in classic tracks from decades past',
    votingStyle: 'nostalgic',
    temperature: 0.6
  },
  analytical: {
    name: 'Music Scholar',
    description: 'Makes decisions based on musical theory and lyrics',
    votingStyle: 'intellectual',
    temperature: 0.3
  }
};

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
    
    // Generate bot username
    const musicWords = [
      'vinyl', 'beat', 'rhythm', 'melody', 'harmony', 'bass', 'treble',
      'tempo', 'chord', 'riff', 'groove', 'sync', 'echo', 'reverb',
      'pitch', 'tone', 'vibe', 'flow', 'pulse', 'wave'
    ];
    
    const botName = `${musicWords[Math.floor(Math.random() * musicWords.length)]}_bot_${Math.floor(1000 + Math.random() * 9000)}`;
    
    // Register bot with Heart Songs API
    console.log(`Registering bot: ${botName}`);
    console.log(`Using API URL: ${process.env.HEARTSONGS_API_URL}`);
    
    try {
      // Step 1: Register the bot
      console.log('Step 1: Registering bot with Heart Songs API...');
      let registrationResponse;
      try {
        registrationResponse = await axios.post(`${process.env.HEARTSONGS_API_URL}/auth/register-anonymous`, {
          username: botName
        }, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        console.log('Registration response status:', registrationResponse.status);
        console.log('Registration response data:', registrationResponse.data);
        
      } catch (regError) {
        console.error('Bot registration failed:', {
          message: regError.message,
          status: regError.response?.status,
          data: regError.response?.data,
          url: regError.config?.url
        });
        
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
            botName: botName
          })
        };
      }
      
      const { user: botUser, sessionToken } = registrationResponse.data;
      console.log(`Bot registered successfully: ${botUser.displayName} (ID: ${botUser.id})`);
      
      // Step 2: Join the game
      console.log('Step 2: Bot joining game...');
      let joinResponse;
      try {
        joinResponse = await axios.post(`${process.env.HEARTSONGS_API_URL}/game/join`, {
          gameCode: gameCode,
          userId: botUser.id
        }, {
          headers: { Authorization: `Bearer ${sessionToken}` },
          timeout: 10000
        });
        
        console.log('Join response status:', joinResponse.status);
        console.log('Join response data:', joinResponse.data);
        
      } catch (joinError) {
        console.error('Game join failed:', {
          message: joinError.message,
          status: joinError.response?.status,
          data: joinError.response?.data,
          url: joinError.config?.url,
          gameCode: gameCode,
          botUserId: botUser.id
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
            botName: botUser.displayName
          })
        };
      }
      
      // Start the bot worker function
      const workerPayload = {
        botId: botUser.id,
        botName: botUser.displayName,
        gameCode: gameCode,
        gameId: joinResponse.data.gameId,
        sessionToken: sessionToken,
        personality: personality,
        personalityConfig: botConfig
      };
      
      console.log('Starting bot worker with payload:', workerPayload);
      
      // Invoke bot worker asynchronously
      await lambda.invoke({
        FunctionName: `${process.env.SERVICE_NAME}-${process.env.STAGE}-bot-worker`,
        InvocationType: 'Event', // Async invocation
        Payload: JSON.stringify(workerPayload)
      }).promise();
      
      console.log('Bot worker started successfully');
      
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
      
    } catch (workerError) {
      console.error('Bot worker invocation failed:', workerError.message);
      
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
    
  } catch (error) {
    console.error('Error spawning bot:', error);
    
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