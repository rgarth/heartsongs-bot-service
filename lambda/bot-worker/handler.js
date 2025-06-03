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
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.gameState = null;
    this.hasSubmitted = false;
    this.hasVoted = false;
    this._isSelectingQuestion = false;
    this.stateStartTime = Date.now();
    this.currentState = null;
    this.MAX_STATE_DURATION = 15 * 60 * 1000; // 15 minutes
    this.spawnTime = Date.now();
    this.MAX_AGE = 24 * 60 * 60 * 1000; 

    console.log(`Bot ${this.botName} initialized with 15-minute state timeout`);
  }

  async getGameState() {
    try {
      const response = await axios.get(`${this.apiUrl}/game/${this.gameId}`, {
        headers: { Authorization: `Bearer ${this.sessionToken}` }
      });
      
      const newGameState = response.data;
      
      // NEW: Check if game state changed
      if (this.currentState !== newGameState.status) {
        console.log(`Bot ${this.botName}: State changed from ${this.currentState} to ${newGameState.status}`);
        this.currentState = newGameState.status;
        this.stateStartTime = Date.now();
      }
      
      this.gameState = newGameState;
      return this.gameState;
    } catch (error) {
      console.error('Failed to get game state:', error.message);
      throw error;
    }
  }

  checkStateTimeout() {
    const timeInCurrentState = Date.now() - this.stateStartTime;
    
    if (timeInCurrentState > this.MAX_STATE_DURATION) {
      const minutes = Math.floor(timeInCurrentState / 60000);
      console.log(`⏰ Bot ${this.botName} has been in state '${this.currentState}' for ${minutes} minutes`);
      console.log(`🚫 Exceeds 15-minute limit - terminating bot worker`);
      return true;
    }
    
    return false;
  }

  async processGameState() {
    if (!this.gameState) return;

    // NEW: Check state timeout first
    if (this.checkStateTimeout()) {
      console.log(`Bot ${this.botName} terminating due to 15-minute state timeout`);
      return false; // End processing
    }

    // Check if bot is still in the game
    const botPlayer = this.gameState.players.find(p => p.user._id === this.botId);
    if (!botPlayer) {
      console.log(`Bot ${this.botName} is no longer in the game, ending bot worker`);
      return false; // End processing
    }

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
      case 'question-selection':
        await this.handleQuestionSelection();
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

  /**
   * Enhanced chooseSongForQuestion with detailed debugging
   */
  async chooseSongForQuestion(question) {
    try {
      console.log(`🤖 Bot ${this.botName} starting song selection process...`);
      console.log(`🎯 Question: "${question.text}"`);
      console.log(`🎭 Personality: ${this.personality}`);
      console.log(`🔑 OpenAI API Key available: ${!!this.openaiApiKey}`);
      
      // Step 1: Get AI suggestions with detailed logging
      console.log(`🧠 Step 1: Getting AI suggestions...`);
      const aiSuggestions = await this.getAISongSuggestions(question.text);
      
      console.log(`📋 AI Suggestions Result:`, {
        received: aiSuggestions !== null,
        count: aiSuggestions?.length || 0,
        suggestions: aiSuggestions
      });
      
      if (!aiSuggestions || aiSuggestions.length === 0) {
        console.log(`❌ Bot ${this.botName} got no AI suggestions, will pass`);
        return null;
      }
      
      // Step 2: Randomize order
      console.log(`🔀 Step 2: Randomizing suggestion order...`);
      const shuffledSuggestions = [...aiSuggestions].sort(() => Math.random() - 0.5);
      console.log(`🔀 Randomized order:`, shuffledSuggestions.map((s, i) => `${i + 1}. ${s.artist} - ${s.song}`));
      
      // Step 3: Try each suggestion with detailed logging
      console.log(`🔍 Step 3: Searching for songs in database...`);
      
      for (let i = 0; i < shuffledSuggestions.length; i++) {
        const suggestion = shuffledSuggestions[i];
        console.log(`\n🎵 Trying suggestion ${i + 1}/${shuffledSuggestions.length}:`);
        console.log(`   Artist: "${suggestion.artist}"`);
        console.log(`   Song: "${suggestion.song}"`);
        console.log(`   Reasoning: "${suggestion.reasoning}"`);
        
        // Search for the song
        const searchQuery = `${suggestion.artist} ${suggestion.song}`;
        console.log(`🔎 Search query: "${searchQuery}"`);
        
        const searchResults = await this.searchSongs(searchQuery);
        console.log(`📊 Search results: ${searchResults.length} found`);
        
        if (searchResults.length === 0) {
          console.log(`❌ No search results for "${searchQuery}"`);
          continue;
        }
        
        // Log all search results
        console.log(`📃 All search results:`);
        searchResults.forEach((result, idx) => {
          console.log(`   ${idx + 1}. "${result.name}" by ${result.artist} (ID: ${result.id})`);
        });
        
        // Find best match
        console.log(`🎯 Finding best match...`);
        const bestMatch = this.findBestMatch(searchResults, suggestion);
        console.log(`🎯 Best match: "${bestMatch.name}" by ${bestMatch.artist}`);
        
        // Check if it's a good match
        console.log(`✅ Checking if match is good enough...`);
        const isGood = this.isGoodMatch(bestMatch, suggestion);
        console.log(`✅ Match quality: ${isGood ? 'GOOD' : 'NOT GOOD ENOUGH'}`);
        
        if (isGood) {
          console.log(`🎉 Bot ${this.botName} SELECTED: "${bestMatch.name}" by ${bestMatch.artist}`);
          console.log(`🎉 From AI suggestion: "${suggestion.artist} - ${suggestion.song}"`);
          console.log(`🎉 AI reasoning: ${suggestion.reasoning}`);
          return bestMatch;
        } else {
          console.log(`❌ Match "${bestMatch.name}" by ${bestMatch.artist} not good enough for suggestion "${suggestion.artist} - ${suggestion.song}"`);
          
          // Let's see why it failed the match test
          console.log(`🔍 Match analysis:`);
          console.log(`   Target artist: "${suggestion.artist.toLowerCase()}"`);
          console.log(`   Found artist: "${bestMatch.artist.toLowerCase()}"`);
          console.log(`   Target song: "${suggestion.song.toLowerCase()}"`);
          console.log(`   Found song: "${bestMatch.name.toLowerCase()}"`);
          console.log(`   Artist includes check: ${bestMatch.artist.toLowerCase().includes(suggestion.artist.toLowerCase())}`);
          console.log(`   Reverse artist check: ${suggestion.artist.toLowerCase().includes(bestMatch.artist.toLowerCase())}`);
        }
        
        // Small delay between searches
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log(`❌ Bot ${this.botName} couldn't find any viable songs from AI suggestions, will pass`);
      return null;
      
    } catch (error) {
      console.error(`💥 Bot ${this.botName} song selection crashed:`, error.message);
      console.error(`💥 Full error:`, error);
      return null;
    }
  }

  /**
   * Enhanced song search with debugging
   */
  async searchSongs(query) {
    try {
      console.log(`🔍 Searching songs with query: "${query}"`);
      console.log(`🔗 API URL: ${this.apiUrl}/music/search`);
      console.log(`🔑 Session token available: ${!!this.sessionToken}`);
      
      const response = await axios.get(`${this.apiUrl}/music/search`, {
        params: { query, limit: 8 },
        headers: { Authorization: `Bearer ${this.sessionToken}` },
        timeout: 10000
      });
      
      console.log(`✅ Search API responded with status: ${response.status}`);
      console.log(`📊 Found ${response.data.length} results`);
      
      return response.data;
    } catch (error) {
      console.error(`❌ Song search API failed:`, {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        query: query
      });
      return [];
    }
  }

  /**
   * Enhanced match checking with detailed logging
   */
  isGoodMatch(match, suggestion) {
    const matchArtist = match.artist.toLowerCase().trim();
    const targetArtist = suggestion.artist.toLowerCase().trim();
    const matchSong = match.name.toLowerCase().trim();
    const targetSong = suggestion.song.toLowerCase().trim();
    
    console.log(`🔍 Detailed match analysis:`);
    console.log(`   Target: "${targetArtist}" - "${targetSong}"`);
    console.log(`   Found:  "${matchArtist}" - "${matchSong}"`);
    
    // Check artist similarity
    const artistMatch1 = matchArtist.includes(targetArtist);
    const artistMatch2 = targetArtist.includes(matchArtist);
    const artistSimilar = this.areArtistsSimilar(matchArtist, targetArtist);
    
    console.log(`   Artist checks:`);
    console.log(`     Found includes target: ${artistMatch1}`);
    console.log(`     Target includes found: ${artistMatch2}`);
    console.log(`     Artists similar: ${artistSimilar}`);
    
    // Check song similarity (optional - might be too strict)
    const songMatch1 = matchSong.includes(targetSong);
    const songMatch2 = targetSong.includes(matchSong);
    
    console.log(`   Song checks (for info only):`);
    console.log(`     Found includes target: ${songMatch1}`);
    console.log(`     Target includes found: ${songMatch2}`);
    
    const isGood = artistMatch1 || artistMatch2 || artistSimilar;
    console.log(`   Overall match result: ${isGood}`);
    
    return isGood;
  }

  /**
   * Get song suggestions from OpenAI based on the question
   */
  async getAISongSuggestions(questionText) {
    console.log(`Bot ${this.botName} starting AI suggestion process...`);
    console.log(`OpenAI API Key available: ${!!this.openaiApiKey}`);
    
    if (!this.openaiApiKey) {
      console.warn(`Bot ${this.botName}: OpenAI API key not available, will pass`);
      return null;
    }

    try {
      const personalityPrompt = this.getPersonalityPrompt();
      console.log(`Bot ${this.botName}: Using personality: ${this.personality}`);
      
      const prompt = `${personalityPrompt}

Question: "${questionText}"

Please suggest 5 songs that would be good answers to this question. Consider:
- The literal meaning of the question
- Popular and well-known songs that people would recognize
- Songs that fit the mood, era, or genre mentioned in the question
- Your personality as described above

For each song, provide:
- Artist name (exact spelling)
- Song title (exact spelling)  
- Brief reasoning (1-2 sentences)

Format your response as JSON:
{
  "suggestions": [
    {
      "artist": "Artist Name",
      "song": "Song Title",
      "reasoning": "Why this song fits the question"
    }
  ]
}`;

      console.log(`Bot ${this.botName}: Making OpenAI API call...`);
      console.log(`Bot ${this.botName}: Full prompt length: ${prompt.length}`);

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a music expert helping to answer music-related questions. Always respond with valid JSON in the exact format requested.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: this.personalityConfig.temperature || 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000 // Increased timeout
      });

      console.log(`Bot ${this.botName}: OpenAI API call successful!`);
      console.log(`Bot ${this.botName}: Response status: ${response.status}`);
      console.log(`Bot ${this.botName}: Response usage:`, response.data.usage);

      const aiResponse = response.data.choices[0].message.content;
      console.log(`Bot ${this.botName}: Raw AI response:`, aiResponse);
      
      // Parse the JSON response
      try {
        const parsed = JSON.parse(aiResponse);
        console.log(`Bot ${this.botName}: Successfully parsed AI response:`, parsed);
        
        if (parsed.suggestions && Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
          console.log(`Bot ${this.botName}: Got ${parsed.suggestions.length} AI suggestions`);
          return parsed.suggestions;
        } else {
          console.warn(`Bot ${this.botName}: AI response missing suggestions array, falling back`);
          return this.getFallbackSuggestions(questionText);
        }
      } catch (parseError) {
        console.error(`Bot ${this.botName}: Failed to parse AI response as JSON:`, parseError);
        console.log(`Bot ${this.botName}: Attempting to extract from malformed response...`);
        
        // Try to extract suggestions from malformed response
        const extracted = this.extractSuggestionsFromText(aiResponse);
        if (extracted.length > 0) {
          console.log(`Bot ${this.botName}: Successfully extracted ${extracted.length} suggestions from text`);
          return extracted;
        }
        
        console.warn(`Bot ${this.botName}: Could not extract suggestions, using fallback`);
        return this.getFallbackSuggestions(questionText);
      }
      
    } catch (error) {
      console.error(`Bot ${this.botName}: OpenAI API error:`, error.message);
      
      if (error.response) {
        console.error(`Bot ${this.botName}: OpenAI API response status:`, error.response.status);
        console.error(`Bot ${this.botName}: OpenAI API response data:`, error.response.data);
        
        // Check for specific error types
        if (error.response.status === 401) {
          console.error(`Bot ${this.botName}: OpenAI API authentication failed - check API key`);
        } else if (error.response.status === 429) {
          console.error(`Bot ${this.botName}: OpenAI API rate limit exceeded`);
        } else if (error.response.status >= 500) {
          console.error(`Bot ${this.botName}: OpenAI API server error`);
        }
      } else if (error.code === 'ECONNREFUSED') {
        console.error(`Bot ${this.botName}: Could not connect to OpenAI API`);
      } else if (error.code === 'ENOTFOUND') {
        console.error(`Bot ${this.botName}: OpenAI API hostname not found`);
      } else if (error.code === 'ETIMEDOUT') {
        console.error(`Bot ${this.botName}: OpenAI API request timed out`);
      }
      
      // No fallback - just return null and let bot pass
      console.log(`Bot ${this.botName}: Will pass due to AI API error`);
      return null;
    }
  }

  /**
   * Get personality-specific prompt for the AI
   */
  getPersonalityPrompt() {
    const prompts = {
      eclectic: "You are an eclectic music lover who enjoys discovering hidden gems and lesser-known tracks across all genres. You prefer unique, creative, and sometimes obscure songs that others might not think of.",
      
      mainstream: "You are a mainstream music fan who knows all the biggest hits and crowd favorites. You prefer popular, chart-topping songs that everyone knows and loves.",
      
      indie: "You are an indie music enthusiast who champions underground and alternative artists. You prefer authentic, non-commercial tracks from independent artists and smaller labels.",
      
      vintage: "You are a music historian who specializes in classic tracks from past decades. You prefer timeless songs from the 60s, 70s, 80s, and 90s that have stood the test of time.",
      
      analytical: "You are a music scholar who analyzes songs based on musical theory, lyrical content, and artistic merit. You prefer songs with complex compositions, meaningful lyrics, or innovative production."
    };
    
    return prompts[this.personality] || prompts.eclectic;
  }

  /**
   * Fallback suggestions when AI is not available
   */
  getFallbackSuggestions(questionText) {
    const text = questionText.toLowerCase();
    
    // Basic keyword matching for common questions
    if (text.includes('beatles')) {
      return [
        { artist: 'The Beatles', song: 'Hey Jude', reasoning: 'Classic Beatles hit' },
        { artist: 'The Beatles', song: 'Let It Be', reasoning: 'Iconic Beatles song' },
        { artist: 'The Beatles', song: 'Come Together', reasoning: 'Popular Beatles track' }
      ];
    }
    
    if (text.includes('taylor swift')) {
      return [
        { artist: 'Taylor Swift', song: 'Shake It Off', reasoning: 'Popular Taylor Swift hit' },
        { artist: 'Taylor Swift', song: 'Love Story', reasoning: 'Classic Taylor Swift song' },
        { artist: 'Taylor Swift', song: 'Anti-Hero', reasoning: 'Recent Taylor Swift hit' }
      ];
    }
    
    if (text.includes('90s')) {
      return [
        { artist: 'Nirvana', song: 'Smells Like Teen Spirit', reasoning: '90s grunge anthem' },
        { artist: 'Alanis Morissette', song: 'You Oughta Know', reasoning: '90s alternative hit' },
        { artist: 'TLC', song: 'Waterfalls', reasoning: '90s R&B classic' }
      ];
    }
    
    if (text.includes('sad') || text.includes('cry')) {
      return [
        { artist: 'Johnny Cash', song: 'Hurt', reasoning: 'Emotionally powerful song' },
        { artist: 'Mad World', song: 'Gary Jules', reasoning: 'Haunting and melancholic' },
        { artist: 'The Sound of Silence', song: 'Simon & Garfunkel', reasoning: 'Classic sad song' }
      ];
    }
    
    if (text.includes('happy') || text.includes('dance')) {
      return [
        { artist: 'Pharrell Williams', song: 'Happy', reasoning: 'Literally about being happy' },
        { artist: 'Bruno Mars', song: 'Uptown Funk', reasoning: 'Upbeat dance track' },
        { artist: 'Daft Punk', song: 'Get Lucky', reasoning: 'Feel-good dance music' }
      ];
    }
    
    // Default suggestions based on personality
    const personalityDefaults = {
      eclectic: [
        { artist: 'Tame Impala', song: 'The Less I Know The Better', reasoning: 'Unique psychedelic sound' },
        { artist: 'FKA twigs', song: 'Two Weeks', reasoning: 'Innovative and creative' },
        { artist: 'King Gizzard', song: 'Inner Cell', reasoning: 'Experimental and interesting' }
      ],
      mainstream: [
        { artist: 'Ed Sheeran', song: 'Shape of You', reasoning: 'Massive mainstream hit' },
        { artist: 'Adele', song: 'Rolling in the Deep', reasoning: 'Popular crowd favorite' },
        { artist: 'The Weeknd', song: 'Blinding Lights', reasoning: 'Chart-topping hit' }
      ],
      indie: [
        { artist: 'Arctic Monkeys', song: 'Do I Wanna Know?', reasoning: 'Indie rock favorite' },
        { artist: 'Vampire Weekend', song: 'A-Punk', reasoning: 'Indie classic' },
        { artist: 'The Strokes', song: 'Last Nite', reasoning: 'Indie rock anthem' }
      ],
      vintage: [
        { artist: 'Fleetwood Mac', song: 'Dreams', reasoning: 'Timeless 70s classic' },
        { artist: 'David Bowie', song: 'Heroes', reasoning: 'Iconic vintage track' },
        { artist: 'Queen', song: 'Bohemian Rhapsody', reasoning: 'Classic rock masterpiece' }
      ],
      analytical: [
        { artist: 'Radiohead', song: 'Paranoid Android', reasoning: 'Complex composition and deep lyrics' },
        { artist: 'Pink Floyd', song: 'Comfortably Numb', reasoning: 'Musically sophisticated' },
        { artist: 'Tool', song: 'Schism', reasoning: 'Complex time signatures and meaning' }
      ]
    };
    
    return personalityDefaults[this.personality] || personalityDefaults.eclectic;
  }

  /**
   * Try to extract song suggestions from malformed AI response
   */
  extractSuggestionsFromText(text) {
    const suggestions = [];
    const lines = text.split('\n');
    
    let currentSuggestion = {};
    
    for (const line of lines) {
      const lower = line.toLowerCase().trim();
      
      if (lower.includes('artist:') || lower.includes('"artist"')) {
        const match = line.match(/(?:artist[":]\s*["']?)([^"',\n]+)/i);
        if (match) currentSuggestion.artist = match[1].trim();
      }
      
      if (lower.includes('song:') || lower.includes('"song"') || lower.includes('title:')) {
        const match = line.match(/(?:(?:song|title)[":]\s*["']?)([^"',\n]+)/i);
        if (match) currentSuggestion.song = match[1].trim();
      }
      
      if (lower.includes('reasoning:') || lower.includes('"reasoning"')) {
        const match = line.match(/(?:reasoning[":]\s*["']?)([^"',\n]+)/i);
        if (match) currentSuggestion.reasoning = match[1].trim();
      }
      
      // If we have a complete suggestion, add it
      if (currentSuggestion.artist && currentSuggestion.song) {
        suggestions.push({ ...currentSuggestion });
        currentSuggestion = {};
      }
    }
    
    return suggestions.slice(0, 3); // Max 3 suggestions
  }

  /**
   * Find best match between search results and AI suggestion
   */
  findBestMatch(searchResults, suggestion) {
    let bestMatch = searchResults[0]; // Default to first result
    let bestScore = 0;
    
    const targetArtist = suggestion.artist.toLowerCase();
    const targetSong = suggestion.song.toLowerCase();
    
    for (const result of searchResults) {
      let score = 0;
      const resultArtist = result.artist.toLowerCase();
      const resultSong = result.name.toLowerCase();
      
      // Artist matching (most important)
      if (resultArtist === targetArtist) {
        score += 100;
      } else if (resultArtist.includes(targetArtist) || targetArtist.includes(resultArtist)) {
        score += 50;
      }
      
      // Song matching
      if (resultSong === targetSong) {
        score += 80;
      } else if (resultSong.includes(targetSong) || targetSong.includes(resultSong)) {
        score += 40;
      }
      
      // Avoid instrumentals, karaoke, etc.
      if (resultSong.includes('instrumental') || resultSong.includes('karaoke') || 
          resultSong.includes('cover') || resultSong.includes('remix')) {
        score -= 30;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }
    
    console.log(`Best match for "${suggestion.artist} - ${suggestion.song}": ${bestMatch.name} by ${bestMatch.artist} (score: ${bestScore})`);
    return bestMatch;
  }

  /**
   * Check if artists are similar (handles common variations)
   */
  areArtistsSimilar(artist1, artist2) {
    // Remove common prefixes/suffixes
    const clean1 = artist1.replace(/^the\s+/i, '').replace(/\s+band$/i, '');
    const clean2 = artist2.replace(/^the\s+/i, '').replace(/\s+band$/i, '');
    
    return clean1.includes(clean2) || clean2.includes(clean1);
  }

  /**
   * Enhanced submission with duplicate handling
   */
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
      
      console.log(`Bot ${this.botName} successfully submitted: "${song.name}" by ${song.artist}`);
    } catch (error) {
      console.error(`Bot ${this.botName} failed to submit song:`, error.message);
      
      // Handle duplicate song error gracefully
      if (error.response?.status === 409 && error.response?.data?.errorCode === 'DUPLICATE_SONG') {
        console.log(`Bot ${this.botName} ⚠️ Song already selected: "${song.name}" by ${song.artist}`);
        console.log(`Bot ${this.botName} 🔄 Attempting to find alternative...`);
        
        // Try to find an alternative song
        await this.handleDuplicateAndRetry();
      } else {
        // For other errors, just pass the turn
        console.log(`Bot ${this.botName} ❌ Submission failed with other error, passing turn`);
        await this.passTurn();
      }
    }
  }

  /**
   * Handle duplicate song error by finding an alternative
   */
  async handleDuplicateAndRetry() {
    try {
      console.log(`Bot ${this.botName} looking for alternative song choices...`);
      
      // Get fresh game state to see what's already submitted
      await this.getGameState();
      
      // Get the current question again
      const currentQuestion = this.gameState.currentQuestion;
      if (!currentQuestion) {
        console.log(`Bot ${this.botName} ❌ No current question found, passing turn`);
        await this.passTurn();
        return;
      }
      
      // Get already submitted song IDs to avoid
      const submittedSongIds = this.gameState.submissions
        .filter(s => !s.hasPassed)
        .map(s => s.songId);
      
      console.log(`Bot ${this.botName} avoiding already submitted songs:`, submittedSongIds);
      
      // Try to get alternative AI suggestions
      const aiSuggestions = await this.getAISongSuggestions(currentQuestion.text);
      
      if (!aiSuggestions || aiSuggestions.length === 0) {
        console.log(`Bot ${this.botName} ❌ No alternative AI suggestions, passing turn`);
        await this.passTurn();
        return;
      }
      
      // Try each suggestion until we find one that's not already submitted
      for (let i = 0; i < aiSuggestions.length; i++) {
        const suggestion = aiSuggestions[i];
        console.log(`Bot ${this.botName} trying alternative suggestion ${i + 1}/${aiSuggestions.length}: "${suggestion.artist} - ${suggestion.song}"`);
        
        // Search for the specific song
        const searchQuery = `${suggestion.artist} ${suggestion.song}`;
        const searchResults = await this.searchSongs(searchQuery);
        
        if (searchResults.length > 0) {
          const bestMatch = this.findBestMatch(searchResults, suggestion);
          
          // Check if this song is already submitted
          if (submittedSongIds.includes(bestMatch.id)) {
            console.log(`Bot ${this.botName} ⏭️ "${bestMatch.name}" also already submitted, trying next...`);
            continue;
          }
          
          if (this.isGoodMatch(bestMatch, suggestion)) {
            console.log(`Bot ${this.botName} ✅ Found alternative: "${bestMatch.name}" by ${bestMatch.artist}`);
            
            // Try to submit the alternative
            try {
              await axios.post(`${this.apiUrl}/game/submit`, {
                gameId: this.gameId,
                userId: this.botId,
                songId: bestMatch.id,
                songName: bestMatch.name,
                artist: bestMatch.artist,
                albumCover: bestMatch.albumArt || '',
                hasPassed: false
              }, {
                headers: { Authorization: `Bearer ${this.sessionToken}` }
              });
              
              console.log(`Bot ${this.botName} ✅ Successfully submitted alternative: "${bestMatch.name}" by ${bestMatch.artist}`);
              return; // Success!
              
            } catch (retryError) {
              if (retryError.response?.status === 409) {
                console.log(`Bot ${this.botName} ⚠️ Alternative also duplicated, trying next...`);
                continue; // Try next suggestion
              } else {
                console.error(`Bot ${this.botName} ❌ Failed to submit alternative:`, retryError.message);
                break; // Break on other errors
              }
            }
          }
        }
        
        // Small delay between searches
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // If we get here, no alternatives worked
      console.log(`Bot ${this.botName} ❌ Could not find any suitable alternatives, passing turn`);
      await this.passTurn();
      
    } catch (error) {
      console.error(`Bot ${this.botName} ❌ Error handling duplicate song:`, error.message);
      await this.passTurn();
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

    // Get all non-passed submissions (including bot's own in 2-player games)
    const allSubmissions = this.gameState.submissions.filter(s => !s.hasPassed);
    
    if (allSubmissions.length === 0) {
      console.log(`Bot ${this.botName} has no valid submissions to vote for`);
      return;
    }

    // Check if this is a 2-player game (self-voting allowed)
    const totalPlayers = this.gameState.activePlayers?.length || this.gameState.players.length;
    const canVoteForSelf = totalPlayers < 3;
    
    console.log(`Bot ${this.botName} voting in ${totalPlayers}-player game (self-voting ${canVoteForSelf ? 'allowed' : 'not allowed'})`);
    console.log(`Found ${allSubmissions.length} submissions to consider:`);
    allSubmissions.forEach((sub, i) => {
      const isOwn = sub.player._id === this.botId;
      console.log(`  ${i + 1}. "${sub.songName}" by ${sub.artist} ${isOwn ? '(BOT\'S OWN)' : '(OPPONENT)'}`);
    });

    // Filter based on self-voting rules
    let votableSubmissions;
    if (canVoteForSelf) {
      // In 2-player games, bot can vote for any submission (including its own)
      votableSubmissions = allSubmissions;
    } else {
      // In 3+ player games, bot cannot vote for its own submission
      votableSubmissions = allSubmissions.filter(s => s.player._id !== this.botId);
    }
    
    if (votableSubmissions.length === 0) {
      console.log(`Bot ${this.botName} has no valid submissions after filtering`);
      return;
    }

    // Human-like voting delay
    const delay = 3000 + Math.random() * 8000; // 3-11 seconds
    
    setTimeout(async () => {
      try {
        // Smart voting decision
        const choice = await this.makeSmartVotingChoice(votableSubmissions, canVoteForSelf);
        
        console.log(`Bot ${this.botName} chose to vote for: "${choice.songName}" by ${choice.artist}`);
        console.log(`Voting for submission ID: ${choice._id}`);
        
        await axios.post(`${this.apiUrl}/game/vote`, {
          gameId: this.gameId,
          userId: this.botId,
          submissionId: choice._id
        }, {
          headers: { Authorization: `Bearer ${this.sessionToken}` }
        });
        
        console.log(`Bot ${this.botName} successfully voted for: "${choice.songName}" by ${choice.artist}`);
      } catch (error) {
        console.error(`Bot ${this.botName} failed to vote:`, error.message);
        if (error.response?.data) {
          console.error('Vote error details:', error.response.data);
        }
      }
    }, delay);
  }

  /**
   * SMART voting logic that considers game context
   */
  async makeSmartVotingChoice(submissions, canVoteForSelf) {
    console.log(`Bot ${this.botName} making smart voting choice with ${submissions.length} options`);
    
    // Separate own vs opponent submissions
    const ownSubmissions = submissions.filter(s => s.player._id === this.botId);
    const opponentSubmissions = submissions.filter(s => s.player._id !== this.botId);
    
    console.log(`- Own submissions: ${ownSubmissions.length}`);
    console.log(`- Opponent submissions: ${opponentSubmissions.length}`);
    
    // In 2-player games, be strategic about self-voting
    if (canVoteForSelf && ownSubmissions.length > 0 && opponentSubmissions.length > 0) {
      const ownSubmission = ownSubmissions[0];
      const opponentSubmission = opponentSubmissions[0];
      
      console.log(`Bot ${this.botName} comparing:`);
      console.log(`- Own: "${ownSubmission.songName}" by ${ownSubmission.artist}`);
      console.log(`- Opponent: "${opponentSubmission.songName}" by ${opponentSubmission.artist}`);
      
      // Use AI to compare the songs if possible
      const shouldVoteForSelf = await this.shouldVoteForOwnSubmission(ownSubmission, opponentSubmission);
      
      if (shouldVoteForSelf) {
        console.log(`Bot ${this.botName} decided to vote for own submission`);
        return ownSubmission;
      } else {
        console.log(`Bot ${this.botName} decided to vote for opponent's submission`);
        return opponentSubmission;
      }
    }
    
    // Fallback to personality-based voting
    return this.chooseVoteByPersonality(submissions);
  }

  /**
   * AI-powered decision on whether to vote for own submission
   */
  async shouldVoteForOwnSubmission(ownSubmission, opponentSubmission) {
    // If no OpenAI, use personality-based logic
    if (!this.openaiApiKey) {
      return this.shouldVoteForSelfByPersonality(ownSubmission, opponentSubmission);
    }
    
    try {
      const currentQuestion = this.gameState.currentQuestion?.text || "the music question";
      
      const prompt = `You are judging a music game where two players answered: "${currentQuestion}"

  Player 1 submitted: "${ownSubmission.songName}" by ${ownSubmission.artist}
  Player 2 submitted: "${opponentSubmission.songName}" by ${opponentSubmission.artist}

  As an impartial judge, which song better answers the question? Consider:
  - How well the song fits the question
  - Song quality and popularity
  - Creativity of the choice

  Be honest and objective. If Player 2's song is better, vote for it.

  Respond with just "PLAYER1" or "PLAYER2" and a brief reason.`;

      console.log(`Bot ${this.botName} asking AI to compare submissions...`);

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an impartial music expert judging which song better answers a question. Be honest and objective.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.3 // Lower temperature for more consistent judging
      }, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const aiResponse = response.data.choices[0].message.content.trim();
      console.log(`Bot ${this.botName} AI judgment: ${aiResponse}`);
      
      // Parse the response
      const shouldVoteForSelf = aiResponse.toUpperCase().includes('PLAYER1');
      console.log(`Bot ${this.botName} AI decision: ${shouldVoteForSelf ? 'vote for self' : 'vote for opponent'}`);
      
      return shouldVoteForSelf;
      
    } catch (error) {
      console.error(`Bot ${this.botName} AI voting analysis failed:`, error.message);
      // Fallback to personality-based decision
      return this.shouldVoteForSelfByPersonality(ownSubmission, opponentSubmission);
    }
  }

  /**
   * Personality-based decision on self-voting (fallback)
   */
  shouldVoteForSelfByPersonality(ownSubmission, opponentSubmission) {
    console.log(`Bot ${this.botName} using personality-based voting decision`);
    
    switch (this.personality) {
      case 'analytical':
        // Analytical bots are more objective - vote for opponent 60% of the time
        const shouldBeObjective = Math.random() < 0.6;
        console.log(`Bot ${this.botName} (analytical) being ${shouldBeObjective ? 'objective' : 'slightly biased'}`);
        return !shouldBeObjective;
        
      case 'eclectic':
        // Eclectic bots prefer unique choices - check if opponent has something more unique
        const opponentIsMoreUnique = !this.isMainstreamSong(opponentSubmission) && this.isMainstreamSong(ownSubmission);
        console.log(`Bot ${this.botName} (eclectic) checking uniqueness: opponent more unique = ${opponentIsMoreUnique}`);
        return !opponentIsMoreUnique;
        
      case 'mainstream':
        // Mainstream bots prefer popular songs
        const opponentIsMoreMainstream = this.isMainstreamSong(opponentSubmission) && !this.isMainstreamSong(ownSubmission);
        console.log(`Bot ${this.botName} (mainstream) checking popularity: opponent more mainstream = ${opponentIsMoreMainstream}`);
        return !opponentIsMoreMainstream;
        
      case 'indie':
        // Indie bots prefer alternative choices
        const opponentIsMoreIndie = this.isIndieArtist(opponentSubmission.artist) && !this.isIndieArtist(ownSubmission.artist);
        console.log(`Bot ${this.botName} (indie) checking indie cred: opponent more indie = ${opponentIsMoreIndie}`);
        return !opponentIsMoreIndie;
        
      case 'vintage':
        // Vintage bots prefer older songs
        const opponentIsMoreVintage = this.isVintageSong(opponentSubmission) && !this.isVintageSong(ownSubmission);
        console.log(`Bot ${this.botName} (vintage) checking age: opponent more vintage = ${opponentIsMoreVintage}`);
        return !opponentIsMoreVintage;
        
      default:
        // Default: vote for opponent 50% of the time (fair)
        const randomChoice = Math.random() < 0.5;
        console.log(`Bot ${this.botName} making random fair choice: ${randomChoice ? 'self' : 'opponent'}`);
        return randomChoice;
    }
  }

  /**
   * Fallback personality-based voting (for 3+ player games)
   */
  chooseVoteByPersonality(submissions) {
    console.log(`Bot ${this.botName} using personality-based choice from ${submissions.length} submissions`);
    
    const votingStyles = {
      eclectic: () => {
        const unique = submissions.find(s => !this.isMainstreamSong(s));
        return unique || submissions[0];
      },
      mainstream: () => {
        const mainstream = submissions.find(s => this.isMainstreamSong(s));
        return mainstream || submissions[0];
      },
      indie: () => {
        const indie = submissions.find(s => this.isIndieArtist(s.artist));
        return indie || submissions[0];
      },
      vintage: () => {
        const vintage = submissions.find(s => this.isVintageSong(s));
        return vintage || submissions[0];
      },
      analytical: () => {
        // More random for analytical, but could be enhanced with AI
        const randomIndex = Math.floor(Math.random() * submissions.length);
        return submissions[randomIndex];
      }
    };
    
    const votingFunction = votingStyles[this.personality] || votingStyles.analytical;
    const choice = votingFunction();
    
    console.log(`Bot ${this.botName} personality choice: "${choice.songName}" by ${choice.artist}`);
    return choice;
  }

  /**
   * Enhanced voting logic with AI analysis and 2-player fix
   */
  async chooseVote(submissions) {
    // Check if bot's own submission is in the list (2-player game)
    const botSubmission = submissions.find(s => s.player._id === this.botId);
    const otherSubmissions = submissions.filter(s => s.player._id !== this.botId);
    
    // In 2-player games, handle self-voting strategy first
    if (botSubmission && otherSubmissions.length === 1) {
      const shouldVoteForSelf = Math.random() < 0.3;
      if (shouldVoteForSelf) {
        console.log(`Bot ${this.botName} is voting for its own submission (2-player strategy)`);
        return botSubmission;
      }
    }
    
    // Try AI-powered voting if OpenAI is available
    if (this.openaiApiKey && this.gameState.currentQuestion) {
      try {
        const aiChoice = await this.getAIVotingChoice(submissions);
        if (aiChoice) {
          console.log(`Bot ${this.botName} used AI analysis for voting`);
          return aiChoice;
        }
      } catch (error) {
        console.error(`Bot ${this.botName} AI voting failed, falling back to personality voting:`, error.message);
      }
    }
    
    // Fallback to existing personality-based voting
    return this.getPersonalityBasedVote(submissions);
  }

  /**
   * Use AI to analyze which submission best answers the question
   */
  async getAIVotingChoice(submissions) {
    if (!this.openaiApiKey || !this.gameState.currentQuestion) {
      return null;
    }
    
    try {
      const personalityPrompt = this.getPersonalityPrompt();
      
      // Create a description of all submissions
      const submissionDescriptions = submissions.map((sub, index) => {
        return `Option ${index + 1}: "${sub.songName}" by ${sub.artist}`;
      }).join('\n');
      
      const prompt = `${personalityPrompt}

Question: "${this.gameState.currentQuestion.text}"

Here are the song submissions to vote on:
${submissionDescriptions}

Based on your personality and which song best answers the question, which option would you vote for?

Consider:
- How well each song answers the specific question
- Your musical preferences as described above
- The creativity and appropriateness of each choice

Respond with just the option number (1, 2, 3, etc.) and a brief reason why.

Format: Option X - [brief reason]`;

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are voting on music submissions in a game. Respond only with the option number and brief reasoning.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const aiResponse = response.data.choices[0].message.content.trim();
      console.log(`Bot ${this.botName} AI voting reasoning: ${aiResponse}`);
      
      // Extract option number from response
      const optionMatch = aiResponse.match(/option\s*(\d+)/i);
      if (optionMatch) {
        const optionIndex = parseInt(optionMatch[1]) - 1;
        if (optionIndex >= 0 && optionIndex < submissions.length) {
          const choice = submissions[optionIndex];
          console.log(`Bot ${this.botName} AI chose: "${choice.songName}" by ${choice.artist}`);
          return choice;
        }
      }
      
      console.warn(`Bot ${this.botName} couldn't parse AI voting response: ${aiResponse}`);
      return null;
      
    } catch (error) {
      console.error(`Bot ${this.botName} AI voting error:`, error.message);
      return null;
    }
  }

  /**
   * Fallback personality-based voting (existing logic)
   */
  getPersonalityBasedVote(submissions) {
    const votingStyles = {
      eclectic: () => {
        return submissions.find(s => !this.isMainstreamSong(s)) || submissions[0];
      },
      mainstream: () => {
        return submissions.find(s => this.isMainstreamSong(s)) || submissions[0];
      },
      indie: () => {
        return submissions.find(s => this.isIndieArtist(s.artist)) || submissions[0];
      },
      vintage: () => {
        return submissions.find(s => this.isVintageSong(s)) || submissions[0];
      },
      analytical: () => {
        return submissions[Math.floor(Math.random() * submissions.length)];
      }
    };
    
    const votingFunction = votingStyles[this.personality] || votingStyles.mainstream;
    return votingFunction();
  }

  isMainstreamSong(submission) {
    const mainstream = ['taylor swift', 'ed sheeran', 'adele', 'bruno mars', 'the weeknd'];
    return mainstream.some(artist => submission.artist.toLowerCase().includes(artist));
  }

  isIndieArtist(artist) {
    const indie = ['arctic monkeys', 'vampire weekend', 'tame impala', 'the strokes'];
    return indie.some(indieArtist => artist.toLowerCase().includes(indieArtist));
  }

  isVintageSong(submission) {
    const vintage = ['beatles', 'queen', 'led zeppelin', 'pink floyd', 'david bowie'];
    return vintage.some(artist => submission.artist.toLowerCase().includes(artist));
  }

  async handleResults() {
    // Just observe and wait
    console.log(`Bot ${this.botName} observing results...`);
  }

  /**
   * Handle question selection phase when bot wins
   */
  async handleQuestionSelection() {
    // Check if this bot is the winner who should select the question
    const isWinner = this.isBotTheWinner();
    
    if (!isWinner) {
      console.log(`Bot ${this.botName} is waiting for the winner to choose a question...`);
      return;
    }
    
    // Check if we've already selected a question
    if (this.gameState.winnerSelectedQuestion && this.gameState.winnerSelectedQuestion.text) {
      console.log(`Bot ${this.botName} has already selected a question, waiting for host to start...`);
      return;
    }
    
    // Prevent multiple simultaneous question selection attempts
    if (this._isSelectingQuestion) {
      console.log(`Bot ${this.botName} is already in the process of selecting a question...`);
      return;
    }
      
    this._isSelectingQuestion = true;
    console.log(`Bot ${this.botName} won the round and needs to choose the next question!`);
    
    try {
      // Give the bot some time to "think" before selecting
      const thinkingDelay = 3000 + Math.random() * 5000; // 3-8 seconds
        
      setTimeout(async () => {
        try {
          await this.selectWinnerQuestion();
        } catch (error) {
          console.error(`Bot ${this.botName} error during question selection:`, error.message);
        } finally {
          // Reset the flag after question selection attempt is complete
          this._isSelectingQuestion = false;
        }
      }, thinkingDelay);
        
    } catch (error) {
      console.error(`Bot ${this.botName} failed to handle question selection:`, error.message);
      this._isSelectingQuestion = false; // Reset flag on error
    }
  }

  /**
   * Check if this bot is the winner of the last round
   */
  isBotTheWinner() {
    if (!this.gameState.submissions || this.gameState.submissions.length === 0) {
      return false;
    }

    // Filter out passed submissions
    const actualSubmissions = this.gameState.submissions.filter(s => !s.hasPassed);
    
    if (actualSubmissions.length === 0) {
      return false; // No winner if everyone passed
    }

    // Sort by votes, then by submission time (speed bonus consideration)
    const sortedSubmissions = [...actualSubmissions].sort((a, b) => {
      const voteDiff = (b.votes?.length || 0) - (a.votes?.length || 0);
      if (voteDiff !== 0) return voteDiff;
      return new Date(a.submittedAt) - new Date(b.submittedAt);
    });

    const winnerSubmission = sortedSubmissions[0];
    const winnerId = winnerSubmission.player._id || winnerSubmission.player;
    
    const isWinner = winnerId.toString() === this.botId.toString();
    
    if (isWinner) {
      console.log(`Bot ${this.botName} is the winner! Winning song: "${winnerSubmission.songName}" by ${winnerSubmission.artist}`);
    }
    
    return isWinner;
  }

  /**
   * AI-powered question selection for the next round
   */
  async selectWinnerQuestion() {
    try {
      console.log(`Bot ${this.botName} is thinking of a good question for the next round...`);
      
      // Use AI to generate a creative question
      const aiQuestion = await this.generateAIQuestion();
      
      if (aiQuestion) {
        await this.submitWinnerQuestion(aiQuestion);
      } else {
        // Fallback to personality-based question selection
        const fallbackQuestion = this.getFallbackQuestion();
        await this.submitWinnerQuestion(fallbackQuestion);
      }
      
    } catch (error) {
      console.error(`Bot ${this.botName} failed to select winner question:`, error.message);
      
      // Emergency fallback
      const emergencyQuestion = {
        text: "What song always makes you smile?",
        category: "emotion"
      };
      await this.submitWinnerQuestion(emergencyQuestion);
    }
  }

  /**
   * Generate a creative question using AI
   */
  async generateAIQuestion() {
    if (!this.openaiApiKey) {
      console.warn('OpenAI API key not available for question generation');
      return null;
    }

    try {
      const personalityPrompt = this.getQuestionPersonalityPrompt();
      
      const prompt = `${personalityPrompt}

You just won a music game round and get to choose the next question for all players to answer.

Create 1 creative, engaging music question that:
- Is fun and interesting to answer
- Will generate diverse song choices from different players
- Fits your personality as described above
- Is not too specific (avoid naming exact artists unless that's the point)
- Is clear and easy to understand
- The question must be answerrable with a song title and artist, which is well-known or recognizable
- You can ask What song? You cannot ask for reasons. The others players can submit songs. Nothing else.

Examples of good questions:
- "What song would you play during a thunderstorm?"
- "What's your favorite song that nobody else seems to know?"
- "What song makes you feel like a main character?"

Format your response as JSON:
{
  "question": {
    "text": "Your question here",
    "category": "emotion|time|event|activity|personal|fun|genre|etc"
  },
  "reasoning": "Why you chose this question (1-2 sentences)"
}`;

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a creative music enthusiast choosing an engaging question for a music game. Always respond with valid JSON in the exact format requested.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.8 // Higher creativity for question generation
      }, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const aiResponse = response.data.choices[0].message.content;
      console.log(`Bot ${this.botName} raw AI question response:`, aiResponse);
      
      // Parse the JSON response
      try {
        const parsed = JSON.parse(aiResponse);
        if (parsed.question && parsed.question.text) {
          console.log(`Bot ${this.botName} AI reasoning: ${parsed.reasoning}`);
          return parsed.question;
        }
      } catch (parseError) {
        console.error('Failed to parse AI question response as JSON:', parseError);
      }
      
      return null;
      
    } catch (error) {
      console.error('OpenAI API error for question generation:', error.message);
      return null;
    }
  }

  /**
   * Get personality-specific prompt for question generation
   */
  getQuestionPersonalityPrompt() {
    const prompts = {
      eclectic: "You are an eclectic music lover who enjoys discovering unique and creative songs. You like questions that encourage people to think outside the box and share hidden gems or unusual tracks.",
      
      mainstream: "You are a mainstream music fan who loves popular hits. You like questions that will get people sharing well-known songs that everyone can enjoy and sing along to.",
      
      indie: "You are an indie music enthusiast who values authenticity and creativity. You like questions that encourage people to share lesser-known artists or songs with deep meaning.",
      
      vintage: "You are a music historian who loves classic tracks. You like questions that might bring up timeless songs from different eras or that have nostalgic value.",
      
      analytical: "You are a music scholar who appreciates artistic merit. You like questions that encourage people to think about the deeper aspects of music - lyrics, composition, or cultural impact."
    };
    
    return prompts[this.personality] || prompts.eclectic;
  }

  /**
   * Get fallback questions based on personality
   */
  getFallbackQuestion() {
    const personalityQuestions = {
      eclectic: [
        { text: "What song would soundtrack your weirdest dream?", category: "creative" },
        { text: "What song do you love that nobody else seems to know?", category: "personal" },
        { text: "What song feels like it was made in a different dimension?", category: "creative" }
      ],
      mainstream: [
        { text: "What song gets everyone singing along at parties?", category: "party" },
        { text: "What's the catchiest song you can't get out of your head?", category: "catchy" },
        { text: "What song do you hear everywhere but still love?", category: "popular" }
      ],
      indie: [
        { text: "What song feels like a secret only you know?", category: "personal" },
        { text: "What artist deserves way more recognition?", category: "discovery" },
        { text: "What song has lyrics that hit different?", category: "meaningful" }
      ],
      vintage: [
        { text: "What song takes you back to a different era?", category: "nostalgia" },
        { text: "What classic song will never get old?", category: "timeless" },
        { text: "What song reminds you of your parents' generation?", category: "generational" }
      ],
      analytical: [
        { text: "What song has the most brilliant lyrics?", category: "literary" },
        { text: "What song shows off incredible musicianship?", category: "technical" },
        { text: "What song changed how you think about music?", category: "transformative" }
      ]
    };
    
    const questions = personalityQuestions[this.personality] || personalityQuestions.eclectic;
    return questions[Math.floor(Math.random() * questions.length)];
  }

  /**
   * Submit the selected question to the game
   */
  async submitWinnerQuestion(question) {
    try {
      console.log(`Bot ${this.botName} selected question: "${question.text}"`);
      
      await axios.post(`${this.apiUrl}/game/set-winner-question`, {
        gameId: this.gameId,
        questionText: question.text,
        questionCategory: question.category || 'general'
      }, {
        headers: { Authorization: `Bearer ${this.sessionToken}` }
      });
      
      console.log(`Bot ${this.botName} successfully submitted winner question: "${question.text}"`);
      
    } catch (error) {
      console.error(`Bot ${this.botName} failed to submit winner question:`, error.message);
      throw error;
    }
  }

  getBotScore() {
    const botPlayer = this.gameState.players.find(p => p.user._id === this.botId);
    return botPlayer ? botPlayer.score : 0;
  }
}

exports.handler = async (event, context) => {
  try {
    console.log('Bot worker started with timeout protection:', JSON.stringify(event, null, 2));
    
    const bot = new BotWorker(event);
    
    const startTime = Date.now();
    const maxRunTime = 14 * 60 * 1000; // 14 minutes (leave 1 minute buffer)
    
    while (true) {
      if (Date.now() - this.spawnTime > this.MAX_AGE) {
        console.log(`Bot ${this.botName} is 24+ hours old, terminating`);
        break;
      }

      try {
        await bot.getGameState();
        const shouldContinue = await bot.processGameState();
        
        if (!shouldContinue) {
          console.log('Bot finished - game ended or timeout reached');
          break;
        }
        
        // Check if we're approaching Lambda timeout
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime > maxRunTime) {
          console.log('Approaching Lambda timeout, re-invoking bot worker...');
          
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