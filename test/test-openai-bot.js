// test/test-openai-bot.js
const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

class LocalBotTester {
  constructor(personality = 'eclectic') {
    this.personality = personality;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.botName = `test_${personality}_bot_1234`;
    this.retryAttempts = 3;
    this.retryDelay = 5000; // 5 seconds between retries
    
    console.log('🤖 Local Bot Test Setup:');
    console.log(`- Bot Name: ${this.botName}`);
    console.log(`- Personality: ${this.personality}`);
    console.log(`- OpenAI API Key: ${this.openaiApiKey ? 'SET (' + this.openaiApiKey.length + ' chars)' : '❌ MISSING'}`);
    
    if (this.openaiApiKey) {
      console.log(`- Key Preview: ${this.openaiApiKey.substring(0, 7)}...${this.openaiApiKey.substring(this.openaiApiKey.length - 4)}`);
    }
    console.log('');
  }

  async testSongSuggestions(questionText) {
    console.log(`🎵 Testing Song Suggestions for: "${questionText}"`);
    console.log('=' .repeat(60));
    
    if (!this.openaiApiKey) {
      console.log('❌ Cannot test - OpenAI API key missing');
      return { success: false, error: 'API key missing' };
    }

    // Try with retries and exponential backoff
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/${this.retryAttempts}...`);
        
        const suggestions = await this.getAISongSuggestions(questionText);
        
        if (suggestions && suggestions.length > 0) {
          console.log(`✅ SUCCESS: Got ${suggestions.length} AI suggestions:`);
          suggestions.forEach((suggestion, i) => {
            console.log(`${i + 1}. "${suggestion.song}" by ${suggestion.artist}`);
            console.log(`   💭 Reasoning: ${suggestion.reasoning}`);
          });
          return { success: true, suggestions };
        } else {
          console.log('❌ No suggestions returned');
          return { success: false, error: 'No suggestions returned' };
        }
        
      } catch (error) {
        console.log(`❌ Attempt ${attempt} failed: ${error.message}`);
        
        if (error.response?.status === 429) {
          console.log('⏱️  Rate limit hit - waiting before retry...');
          if (attempt < this.retryAttempts) {
            const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
            console.log(`⏳ Waiting ${delay/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        } else if (error.response?.status === 401) {
          console.log('🔐 Authentication error - check your API key');
          return { success: false, error: 'Invalid API key' };
        }
        
        if (attempt === this.retryAttempts) {
          return { success: false, error: error.message };
        }
      }
    }
  }

  async getAISongSuggestions(questionText) {
    const personalityPrompt = this.getPersonalityPrompt();
    
    const prompt = `${personalityPrompt}

Question: "${questionText}"

Please suggest 3 songs that would be good answers to this question. Consider:
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

    console.log(`🧠 Making OpenAI API call...`);

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
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000 // Increased timeout
    });

    console.log(`📊 OpenAI Response:`);
    console.log(`- Status: ${response.status}`);
    console.log(`- Model: ${response.data.model}`);
    console.log(`- Usage: ${JSON.stringify(response.data.usage)}`);

    const aiResponse = response.data.choices[0].message.content;
    console.log(`📝 Raw AI Response:`);
    console.log(aiResponse);

    try {
      const parsed = JSON.parse(aiResponse);
      if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
        return parsed.suggestions;
      } else {
        console.log('⚠️ Response missing suggestions array');
        return [];
      }
    } catch (parseError) {
      console.log(`⚠️ JSON parsing failed: ${parseError.message}`);
      return [];
    }
  }

  getPersonalityPrompt() {
    const prompts = {
      eclectic: "You are an eclectic music lover who enjoys discovering unique and creative songs across all genres. You prefer songs that are interesting, unusual, or lesser-known gems that showcase creativity.",
      
      mainstream: "You are a mainstream music fan who knows all the biggest hits and crowd favorites. You prefer popular, chart-topping songs that everyone knows and loves.",
      
      analytical: "You are a music scholar who analyzes songs based on musical theory, lyrical content, and artistic merit. You prefer songs with complex compositions, meaningful lyrics, or innovative production."
    };
    
    return prompts[this.personality] || prompts.eclectic;
  }
}

async function quickTest(question = "What's your favorite Beatles song?", personality = 'mainstream') {
  console.log('⚡ Quick OpenAI Test (with Rate Limiting)');
  console.log('=========================================');
  
  const bot = new LocalBotTester(personality);
  const result = await bot.testSongSuggestions(question);
  
  if (result.success) {
    console.log('\n✅ Quick test PASSED!');
    console.log('🚀 OpenAI integration is working correctly!');
  } else {
    console.log('\n❌ Quick test FAILED!');
    console.log(`Error: ${result.error}`);
    
    if (result.error.includes('429')) {
      console.log('\n💡 SOLUTIONS:');
      console.log('1. Wait a few minutes and try again');
      console.log('2. Check your OpenAI usage at: https://platform.openai.com/usage');
      console.log('3. Consider upgrading your OpenAI plan if needed');
    }
  }
}

// Export for use in other files
module.exports = {
  LocalBotTester,
  quickTest
};

// Run if executed directly
if (require.main === module) {
  quickTest().catch(console.error);
}