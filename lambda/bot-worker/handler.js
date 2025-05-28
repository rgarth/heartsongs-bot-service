// heartsongs-bot-service/lambda/bot-worker/handler.js
const axios = require('axios');
const AWS = require('aws-sdk');

const lambda = new AWS.Lambda();

class BotWorker {
  constructor(config) {
    this.botId = config.botId;
    this.botName = config.botName;
    this.gameCode = config.gameCode;
    this.gameId = config.gameId;
    this.sessionToken = config.sessionToken;
    this.personality = config.personality;
    this.personalityConfig = config.personalityConfig;
    this.apiUrl = process.env.HEARTSONGS_API_URL;
    this.gameState = null;
    this.hasSubmitted = false;
    this.hasVoted = false;
  }

  async getGameState() {
    try {
      const response = await axios.get(`${this.apiUrl}/game/${this.gameId}`, {
        headers: { Authorization: `Bearer ${this.sessionToken}` }
      });
      
      this.gameState = response.data;
      return this.gameState;
    } catch (error) {
      console.error('Failed to get game state:', error.message);
      throw error;
    }
  }

  async processGameState() {
    if (!this.gameState) return;

    console.log(`Bot ${this.botName} processing game state: ${this.gameState.status}`);

    switch (this.gameState.status) {
      case 'waiting':
        await this.handleLobby();
        break;
      case 'selecting':
        await this.handleSelection();
        break;
      case 'voting':
        await this.handleVoting();
        break;
      case 'results':
        await this.handleResults();
        break;
      case 'ended':
        console.log(`Game ended. Bot ${this.botName} final score: ${this.getBotScore()}`);
        return false; // End processing
    }
    
    return true; // Continue processing
  }

  async handleLobby() {
    const botPlayer = this.gameState.players.find(p => p.user._id === this.botId);
    
    if (botPlayer && !botPlayer.isReady) {
      // Random delay to seem human-like
      const delay = 2000 + Math.random() * 3000; // 2-5 seconds
      
      setTimeout(async () => {
        try {
          await axios.post(`${this.apiUrl}/game/ready`, {
            gameId: this.gameId,
            userId: this.botId
          }, {
            headers: { Authorization: `Bearer ${this.sessionToken}` }
          });
          
          console.log(`Bot ${this.botName} is ready to rock!`);
        } catch (error) {
          console.error('Failed to set ready:', error.message);
        }
      }, delay);
    }
  }

  async handleSelection() {
    const hasSubmitted = this.gameState.submissions.some(s => s.player._id === this.botId);
    if (hasSubmitted) return;

    try {
      console.log(`Bot ${this.botName} analyzing question: "${this.gameState.currentQuestion.text}"`);
      
      const songChoice = await this.chooseSongForQuestion(this.gameState.currentQuestion);
      
      // Human-like delay
      const delay = 4000 + Math.random() * 8000; // 4-12 seconds
      
      setTimeout(async () => {
        if (songChoice) {
          await this.submitSong(songChoice);
        } else {
          await this.passTurn();
        }
      }, delay);
      
    } catch (error) {
      console.error('Selection error:', error.message);
      // Fallback: pass the turn
      setTimeout(() => this.passTurn(), 3000);
    }
  }

  async chooseSongForQuestion(question) {
    try {
      // Simple AI simulation for now - in production, use OpenAI API
      const mockChoices = [
        { artist: 'The Beatles', song: 'Here Comes The Sun', reason: 'Classic feel-good track' },
        { artist: 'Queen', song: 'Bohemian Rhapsody', reason: 'Epic and dramatic' },
        { artist: 'Fleetwood Mac', song: 'Dreams', reason: 'Timeless and emotional' },
        { artist: 'Daft Punk', song: 'Get Lucky', reason: 'Modern classic' },
        { artist: 'Johnny Cash', song: 'Hurt', reason: 'Powerful and haunting' }
      ];
      
      const choice = mockChoices[Math.floor(Math.random() * mockChoices.length)];
      console.log(`Bot ${this.botName} AI reasoning: ${choice.reason}`);
      
      // Search for the song
      const searchResults = await this.searchSongs(`${choice.artist} ${choice.song}`);
      
      if (searchResults.length > 0) {
        const bestMatch = this.findBestMatch(searchResults, choice);
        console.log(`Bot ${this.botName} selected: "${bestMatch.name}" by ${bestMatch.artist}`);
        return bestMatch;
      }
      
      return null;
    } catch (error) {
      console.error('AI song selection failed:', error.message);
      return null;
    }
  }

  async searchSongs(query) {
    try {
      const response = await axios.get(`${this.apiUrl}/music/search`, {
        params: { query, limit: 5 },
        headers: { Authorization: `Bearer ${this.sessionToken}` }
      });
      
      return response.data;
    } catch (error) {
      console.error('Song search failed:', error.message);
      return [];
    }
  }

  findBestMatch(searchResults, target) {
    // Simple scoring based on artist and song name similarity
    let bestMatch = searchResults[0];
    let bestScore = 0;
    
    for (const result of searchResults) {
      let score = 0;
      
      if (result.artist.toLowerCase().includes(target.artist.toLowerCase()) ||
          target.artist.toLowerCase().includes(result.artist.toLowerCase())) {
        score += 2;
      }
      
      if (result.name.toLowerCase().includes(target.song.toLowerCase()) ||
          target.song.toLowerCase().includes(result.name.toLowerCase())) {
        score += 3;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }
    
    return bestMatch;
  }

  async submitSong(song) {
    try {
      await axios.post(`${this.apiUrl}/game/submit`, {
        gameId: this.gameId,
        userId: this.botId,
        songId: song.id,
        songName: song.name,
        artist: song.artist,
        albumCover: song.albumArt || '',
        hasPassed: false
      }, {
        headers: { Authorization: `Bearer ${this.sessionToken}` }
      });
      
      console.log(`Bot ${this.botName} submitted: "${song.name}" by ${song.artist}`);
    } catch (error) {
      console.error('Failed to submit song:', error.message);
    }
  }

  async passTurn() {
    try {
      await axios.post(`${this.apiUrl}/game/submit`, {
        gameId: this.gameId,
        userId: this.botId,
        hasPassed: true
      }, {
        headers: { Authorization: `Bearer ${this.sessionToken}` }
      });
      
      console.log(`Bot ${this.botName} passed this round`);
    } catch (error) {
      console.error('Failed to pass:', error.message);
    }
  }

  async handleVoting() {
    const hasVoted = this.gameState.submissions.some(s => 
      s.votes.some(v => v._id === this.botId)
    );
    
    if (hasVoted) return;

    const votableSubmissions = this.gameState.submissions.filter(s => 
      !s.hasPassed && s.player._id !== this.botId
    );
    
    if (votableSubmissions.length === 0) return;

    // Human-like voting delay
    const delay = 3000 + Math.random() * 8000; // 3-11 seconds
    
    setTimeout(async () => {
      try {
        // Simple voting logic - in production, use AI
        const choice = votableSubmissions[Math.floor(Math.random() * votableSubmissions.length)];
        
        await axios.post(`${this.apiUrl}/game/vote`, {
          gameId: this.gameId,
          userId: this.botId,
          submissionId: choice._id
        }, {
          headers: { Authorization: `Bearer ${this.sessionToken}` }
        });
        
        console.log(`Bot ${this.botName} voted for: "${choice.songName}" by ${choice.artist}`);
      } catch (error) {
        console.error('Failed to vote:', error.message);
      }
    }, delay);
  }

  async handleResults() {
    // Just observe and wait
    console.log(`Bot ${this.botName} observing results...`);
  }

  getBotScore() {
    const botPlayer = this.gameState.players.find(p => p.user._id === this.botId);
    return botPlayer ? botPlayer.score : 0;
  }
}

exports.handler = async (event, context) => {
  try {
    console.log('Bot worker started:', JSON.stringify(event, null, 2));
    
    const bot = new BotWorker(event);
    
    const startTime = Date.now();
    const maxRunTime = 14 * 60 * 1000; // 14 minutes (leave 1 minute buffer)
    
    while (true) {
      try {
        await bot.getGameState();
        const shouldContinue = await bot.processGameState();
        
        if (!shouldContinue) {
          console.log('Bot finished - game ended');
          break;
        }
        
        // Check if we're approaching Lambda timeout
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime > maxRunTime) {
          console.log('Approaching timeout, re-invoking bot worker...');
          
          // Re-invoke self to continue
          await lambda.invoke({
            FunctionName: context.functionName,
            InvocationType: 'Event',
            Payload: JSON.stringify(event)
          }).promise();
          
          break;
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error('Bot processing error:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait longer on error
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Bot worker completed' })
    };
    
  } catch (error) {
    console.error('Bot worker error:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Bot worker failed', details: error.message })
    };
  }
};

