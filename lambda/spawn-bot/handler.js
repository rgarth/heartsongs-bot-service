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
    
    const { gameCode, personality = 'eclectic', gameId } = JSON.parse(event.body || '{}');
    
    if (!gameCode) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Game code is required' })
      };
    }

    const botConfig = PERSONALITIES[personality] || PERSONALITIES.eclectic;
    
    // Generate bot username
    const musicWords = [
      'vinyl', 'beat', 'rhythm', 'melody', 'harmony', 'bass', 'treble',
      'tempo', 'chord', 'riff', 'groove', 'sync', 'echo', 'reverb',
      'pitch', 'tone', 'vibe', 'flow', 'pulse', 'wave'
    ];
    
    const botName = `${musicWords[Math.floor(Math.random() * musicWords.length)]}_bot_${Math.floor(1000 + Math.random() * 9000)}`;
    
    // Register bot with Heart Songs API
    console.log(`Registering bot: ${botName}`);
    
    const registrationResponse = await axios.post(`${process.env.HEARTSONGS_API_URL}/auth/register-anonymous`, {
      username: botName
    });
    
    const { user: botUser, sessionToken } = registrationResponse.data;
    console.log(`Bot registered successfully: ${botUser.displayName}`);
    
    // Join the game
    console.log(`Bot joining game: ${gameCode}`);
    
    const joinResponse = await axios.post(`${process.env.HEARTSONGS_API_URL}/game/join`, {
      gameCode: gameCode,
      userId: botUser.id
    }, {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    
    console.log('Bot joined game successfully');
    
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
    
    // Invoke bot worker asynchronously
    await lambda.invoke({
      FunctionName: `${process.env.SERVICE_NAME}-${process.env.STAGE}-bot-worker`,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify(workerPayload)
    }).promise();
    
    console.log('Bot worker started');
    
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
    console.error('Error spawning bot:', error);
    
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Failed to spawn bot',
        details: error.message
      })
    };
  }
};

