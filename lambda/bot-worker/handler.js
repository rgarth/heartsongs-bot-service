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
    
    // Debug environment variables
    console.log(`Bot ${this.botName} Environment Check:`);
    console.log(`- HEARTSONGS_API_URL: ${this.apiUrl ? 'SET' : 'MISSING'}`);
    console.log(`- OPENAI_API_KEY: ${this.openaiApiKey ? 'SET (' + this.openaiApiKey.length + ' chars)' : 'MISSING'}`);
    console.log(`- Available env vars: ${Object.keys(process.env).filter(k => !k.startsWith('AWS')).join(', ')}`);
    
    if (this.openaiApiKey) {
      console.log(`- OpenAI key preview: ${this.openaiApiKey.substring(0, 7)}...${this.openaiApiKey.substring(this.openaiApiKey.length - 4)}`);
    }
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
  * AI-powered song selection with randomized suggestion order
  */
  async chooseSongForQuestion(question) {
    try {
      console.log(`Bot ${this.botName} thinking about: "${question.text}"`);
      console.log(`Bot ${this.botName} personality: ${this.personality}`);
        
      // Step 1: Use AI to analyze the question and suggest songs
      const aiSuggestions = await this.getAISongSuggestions(question.text);
      console.log(`Bot ${this.botName} received ${aiSuggestions?.length || 0} AI suggestions:`, aiSuggestions);
        
      if (!aiSuggestions || aiSuggestions.length === 0) {
        console.log(`Bot ${this.botName} got no AI suggestions, will pass`);
        return null;
      }
        
      // Step 2: Randomize the order of AI suggestions
      const shuffledSuggestions = [...aiSuggestions].sort(() => Math.random() - 0.5);
      console.log(`Bot ${this.botName} randomized suggestion order`);
        
        // Step 3: Try each randomized suggestion until we find a match
        for (let i = 0; i < shuffledSuggestions.length; i++) {
          const suggestion = shuffledSuggestions[i];
          console.log(`Bot ${this.botName} trying suggestion ${i + 1}/${shuffledSuggestions.length}: "${suggestion.artist} - ${suggestion.song}"`);
          console.log(`Bot ${this.botName} AI reasoning: ${suggestion.reasoning}`);
        
          // Search for the specific song
          const searchQuery = `${suggestion.artist} ${suggestion.song}`;
          console.log(`Bot ${this.botName} searching with query: "${searchQuery}"`);
        
          const searchResults = await this.searchSongs(searchQuery);
          console.log(`Bot ${this.botName} got ${searchResults.length} search results`);
        
          if (searchResults.length > 0) {
            // Log all search results for debugging
            console.log(`Bot ${this.botName} search results:`);
            searchResults.forEach((result, idx) => {
            console.log(`  ${idx + 1}. "${result.name}" by ${result.artist}`);
          });
            
          // Find the best match for this specific suggestion
          const bestMatch = this.findBestMatch(searchResults, suggestion);
          console.log(`Bot ${this.botName} best match: "${bestMatch.name}" by ${bestMatch.artist}`);
            
          if (this.isGoodMatch(bestMatch, suggestion)) {
            console.log(`Bot ${this.botName} ✅ SELECTED: "${bestMatch.name}" by ${bestMatch.artist}`);
            console.log(`Bot ${this.botName} ✅ Original AI suggestion: "${suggestion.artist} - ${suggestion.song}"`);
            console.log(`Bot ${this.botName} ✅ AI reasoning: ${suggestion.reasoning}`);
            return bestMatch;
          } else {
            console.log(`Bot ${this.botName} ❌ Match not good enough, trying next suggestion...`);
          }
        } else {
          console.log(`Bot ${this.botName} ❌ No search results for "${searchQuery}", trying next suggestion...`);
        }
        
        // Small delay between searches
        await new Promise(resolve => setTimeout(resolve, 500));
       }
        
       console.log(`Bot ${this.botName} ❌ Couldn't find any of the AI suggestions in the database, will pass`);
       return null;
        
    } catch (error) {
      console.error(`Bot ${this.botName} AI song selection failed:`, error.message);
      console.error(`Bot ${this.botName} Full error:`, error);
      return null;
    }
  }

  /**
   * Get song suggestions from OpenAI based on the question
   */
  async getAISongSuggestions(questionText) {
    console.log(`Bot ${this.botName} starting AI suggestion process...`);
    console.log(`OpenAI API Key available: ${!!this.openaiApiKey}`);
    console.log(`OpenAI API Key length: ${this.openaiApiKey?.length || 0}`);
    console.log(`OpenAI API Key preview: ${this.openaiApiKey ? this.openaiApiKey.substring(0, 7) + '...' : 'none'}`);
    
    if (!this.openaiApiKey) {
      console.warn(`Bot ${this.botName}: OpenAI API key not available, using fallback logic`);
      return this.getFallbackSuggestions(questionText);
    }

    try {
      const personalityPrompt = this.getPersonalityPrompt();
      console.log(`Bot ${this.botName}: Using personality: ${this.personality}`);
      console.log(`Bot ${this.botName}: Personality prompt: ${personalityPrompt.substring(0, 100)}...`);
      
      const prompt = `${personalityPrompt}

Question: "${questionText}"
Other players have already chosen: ${existingSubmissions}

Please suggest 5 songs that would be good answers to this question. Consider:
- The literal meaning of the question
- Popular and well-known songs that people would recognize
- Songs that fit the mood, era, or genre mentioned in the question
- Your personality as described above
- Are different from existing submissions

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
      
      // Fallback to basic logic
      console.log(`Bot ${this.botName}: Using fallback suggestions due to API error`);
      return this.getFallbackSuggestions(questionText);
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

  async searchSongs(query) {
    try {
      const response = await axios.get(`${this.apiUrl}/music/search`, {
        params: { query, limit: 8 },
        headers: { Authorization: `Bearer ${this.sessionToken}` }
      });
      
      return response.data;
    } catch (error) {
      console.error('Song search failed:', error.message);
      return [];
    }
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
   * Check if the match is good enough to use
   */
  isGoodMatch(match, suggestion) {
    const matchArtist = match.artist.toLowerCase();
    const targetArtist = suggestion.artist.toLowerCase();
    
    // Must have reasonable artist match
    return matchArtist.includes(targetArtist) || 
           targetArtist.includes(matchArtist) ||
           this.areArtistsSimilar(matchArtist, targetArtist);
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
      // Double-check for duplicates right before submission
      // (in case another player submitted while we were processing)
      await this.getGameState(); // Refresh game state
    
      if (this.isSongAlreadySubmitted(song)) {
        console.log(`Bot ${this.botName} ⚠️ Song became duplicate during processing: "${song.name}" by ${song.artist}`);
        console.log(`Bot ${this.botName} will pass instead`);
        await this.passTurn();
       return;
      }
    
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
    
      console.log(`Bot ${this.botName} ✅ submitted: "${song.name}" by ${song.artist}`);
    
    } catch (error) {
      console.error(`Bot ${this.botName} failed to submit song:`, error.message);
    
      // If submission failed, it might be due to a duplicate
      // The server should handle this, but we can add a fallback
      if (error.response?.data?.message?.includes('duplicate') || 
        error.response?.data?.message?.includes('already selected')) {
        console.log(`Bot ${this.botName} submission rejected as duplicate, will pass`);
        await this.passTurn();
      }
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
        // AI-powered voting (or fallback to personality-based voting)
        const choice = await this.chooseVote(votableSubmissions);
        
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

  /**
   * AI-powered voting decision
   */
  async chooseVote(submissions) {
    // For now, use personality-based voting
    // You could extend this to use AI for more sophisticated voting
    
    const votingStyles = {
      eclectic: () => {
        // Prefers unique, lesser-known tracks
        return submissions.find(s => !this.isMainstreamSong(s)) || submissions[0];
      },
      mainstream: () => {
        // Prefers popular, well-known tracks
        return submissions.find(s => this.isMainstreamSong(s)) || submissions[0];
      },
      indie: () => {
        // Prefers alternative artists
        return submissions.find(s => this.isIndieArtist(s.artist)) || submissions[0];
      },
      vintage: () => {
        // Prefers older songs
        return submissions.find(s => this.isVintageSong(s)) || submissions[0];
      },
      analytical: () => {
        // Prefers songs with complex/meaningful content
        return submissions[Math.floor(Math.random() * submissions.length)]; // Random for now
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
- The question must be answerrable with a song title and artist which is well-known or recognizable

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
 * Check if a song has already been submitted by another player
 */
isSongAlreadySubmitted(song) {
  if (!this.gameState.submissions) return false;
  
  return this.gameState.submissions.some(submission => {
    // Don't check against our own submissions
    if (submission.player._id === this.botId) return false;
    
    // Check for exact match on song ID (most reliable)
    if (submission.songId && song.id && submission.songId === song.id) {
      return true;
    }
    
    // Check for approximate match on name and artist
    const submittedName = submission.songName?.toLowerCase().trim();
    const submittedArtist = submission.artist?.toLowerCase().trim();
    const songName = song.name?.toLowerCase().trim();
    const songArtist = song.artist?.toLowerCase().trim();
    
    return submittedName === songName && submittedArtist === songArtist;
  });
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