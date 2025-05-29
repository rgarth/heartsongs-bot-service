// test/test-openai-bot.js
const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Mock bot configuration for testing
const mockBotConfigs = {
  eclectic: {
    name: 'Eclectic Explorer',
    description: 'Loves discovering hidden gems across all genres',
    temperature: 0.8
  },
  mainstream: {
    name: 'Chart Topper', 
    description: 'Knows all the hits and crowd favorites',
    temperature: 0.4
  },
  analytical: {
    name: 'Music Scholar',
    description: 'Makes decisions based on musical theory and lyrics',
    temperature: 0.3
  }
};

class LocalBotTester {
  constructor(personality = 'eclectic') {
    this.personality = personality;
    this.personalityConfig = mockBotConfigs[personality] || mockBotConfigs.eclectic;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.botName = `test_${personality}_bot_1234`;
    
    console.log('🤖 Local Bot Test Setup:');
    console.log(`- Bot Name: ${this.botName}`);
    console.log(`- Personality: ${this.personality}`);
    console.log(`- OpenAI API Key: ${this.openaiApiKey ? 'SET (' + this.openaiApiKey.length + ' chars)' : '❌ MISSING'}`);
    
    if (this.openaiApiKey) {
      console.log(`- Key Preview: ${this.openaiApiKey.substring(0, 7)}...${this.openaiApiKey.substring(this.openaiApiKey.length - 4)}`);
    } else {
      console.log('❌ OpenAI API key not found in environment variables!');
      console.log('Make sure you have OPENAI_API_KEY=sk-proj-... in your .env file');
    }
    console.log('');
  }

  /**
   * Test OpenAI song suggestions
   */
  async testSongSuggestions(questionText) {
    console.log(`🎵 Testing Song Suggestions for: "${questionText}"`);
    console.log('=' .repeat(60));
    
    if (!this.openaiApiKey) {
      console.log('❌ Cannot test - OpenAI API key missing');
      return { success: false, error: 'API key missing' };
    }

    try {
      const suggestions = await this.getAISongSuggestions(questionText);
      
      if (suggestions && suggestions.length > 0) {
        console.log(`✅ SUCCESS: Got ${suggestions.length} AI suggestions:`);
        suggestions.forEach((suggestion, i) => {
          console.log(`${i + 1}. "${suggestion.song}" by ${suggestion.artist}`);
          console.log(`   💭 Reasoning: ${suggestion.reasoning}`);
        });
        return { success: true, suggestions };
      } else {
        console.log('❌ FAILURE: No suggestions returned');
        return { success: false, error: 'No suggestions returned' };
      }
      
    } catch (error) {
      console.log(`❌ ERROR: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test OpenAI question generation
   */
  async testQuestionGeneration() {
    console.log(`🤔 Testing Question Generation (${this.personality} personality)`);
    console.log('=' .repeat(60));
    
    if (!this.openaiApiKey) {
      console.log('❌ Cannot test - OpenAI API key missing');
      return { success: false, error: 'API key missing' };
    }

    try {
      const question = await this.generateAIQuestion();
      
      if (question && question.text) {
        console.log(`✅ SUCCESS: Generated question:`);
        console.log(`❓ Question: "${question.text}"`);
        console.log(`📂 Category: ${question.category}`);
        return { success: true, question };
      } else {
        console.log('❌ FAILURE: No question returned');
        return { success: false, error: 'No question returned' };
      }
      
    } catch (error) {
      console.log(`❌ ERROR: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get song suggestions from OpenAI (same as bot logic)
   */
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
    console.log(`📝 Prompt length: ${prompt.length} characters`);
    console.log(`🌡️  Temperature: ${this.personalityConfig.temperature}`);

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
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
      timeout: 15000
    });

    console.log(`📊 OpenAI Response:`);
    console.log(`- Status: ${response.status}`);
    console.log(`- Model: ${response.data.model}`);
    console.log(`- Usage: ${JSON.stringify(response.data.usage)}`);

    const aiResponse = response.data.choices[0].message.content;
    console.log(`📝 Raw AI Response:`);
    console.log(aiResponse);
    console.log('');

    // Parse the JSON response
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
      console.log('🔧 Attempting text extraction...');
      
      // Try to extract from malformed response
      const extracted = this.extractSuggestionsFromText(aiResponse);
      console.log(`🔧 Extracted ${extracted.length} suggestions from text`);
      return extracted;
    }
  }

  /**
   * Generate AI question (same as bot logic)
   */
  async generateAIQuestion() {
    const personalityPrompt = this.getQuestionPersonalityPrompt();
    
    const prompt = `${personalityPrompt}

You just won a music game round and get to choose the next question for all players to answer.

Create 1 creative, engaging music question that:
- Is fun and interesting to answer
- Will generate diverse song choices from different players
- Fits your personality as described above
- Is not too specific (avoid naming exact artists unless that's the point)
- Is clear and easy to understand

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

    console.log(`🧠 Making OpenAI API call for question generation...`);

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
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
      temperature: 0.8
    }, {
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const aiResponse = response.data.choices[0].message.content;
    console.log(`📝 Raw AI Question Response:`);
    console.log(aiResponse);

    try {
      const parsed = JSON.parse(aiResponse);
      if (parsed.question && parsed.question.text) {
        console.log(`💭 AI Reasoning: ${parsed.reasoning}`);
        return parsed.question;
      }
    } catch (parseError) {
      console.log(`⚠️ Question JSON parsing failed: ${parseError.message}`);
    }
    
    return null;
  }

  /**
   * Get personality prompt for song suggestions
   */
  getPersonalityPrompt() {
    const prompts = {
      eclectic: "You are an eclectic music lover who enjoys discovering unique and creative songs across all genres. You prefer songs that are interesting, unusual, or lesser-known gems that showcase creativity.",
      
      mainstream: "You are a mainstream music fan who knows all the biggest hits and crowd favorites. You prefer popular, chart-topping songs that everyone knows and loves.",
      
      analytical: "You are a music scholar who analyzes songs based on musical theory, lyrical content, and artistic merit. You prefer songs with complex compositions, meaningful lyrics, or innovative production."
    };
    
    return prompts[this.personality] || prompts.eclectic;
  }

  /**
   * Get personality prompt for question generation
   */
  getQuestionPersonalityPrompt() {
    const prompts = {
      eclectic: "You are an eclectic music lover who enjoys discovering unique and creative songs. You like questions that encourage people to think outside the box and share hidden gems or unusual tracks.",
      
      mainstream: "You are a mainstream music fan who loves popular hits. You like questions that will get people sharing well-known songs that everyone can enjoy and sing along to.",
      
      analytical: "You are a music scholar who appreciates artistic merit. You like questions that encourage people to think about the deeper aspects of music - lyrics, composition, or cultural impact."
    };
    
    return prompts[this.personality] || prompts.eclectic;
  }

  /**
   * Extract suggestions from malformed text response
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
    
    return suggestions.slice(0, 3);
  }
}

/**
 * Run comprehensive OpenAI tests
 */
async function runAllTests() {
  console.log('🚀 Starting Local OpenAI Bot Tests');
  console.log('==================================');
  
  const testQuestions = [
    "What's your favorite Beatles song?",
    "What song makes you happy?", 
    "What's the best song from the 90s?",
    "What song would you play at a wedding?",
    "What's your guilty pleasure song?"
  ];
  
  const personalities = ['eclectic', 'mainstream', 'analytical'];
  
  let totalTests = 0;
  let passedTests = 0;
  
  // Test each personality
  for (const personality of personalities) {
    console.log(`\n🎭 TESTING ${personality.toUpperCase()} PERSONALITY`);
    console.log('='.repeat(50));
    
    const bot = new LocalBotTester(personality);
    
    // Test song suggestions
    for (const question of testQuestions) {
      totalTests++;
      const result = await bot.testSongSuggestions(question);
      if (result.success) passedTests++;
      
      console.log(''); // spacing
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
    }
    
    // Test question generation
    totalTests++;
    const questionResult = await bot.testQuestionGeneration();
    if (questionResult.success) passedTests++;
    
    console.log(''); // spacing
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
  }
  
  // Final results
  console.log('\n📊 FINAL TEST RESULTS');
  console.log('====================');
  console.log(`✅ Passed: ${passedTests}/${totalTests}`);
  console.log(`❌ Failed: ${totalTests - passedTests}/${totalTests}`);
  console.log(`📈 Success Rate: ${Math.round((passedTests / totalTests) * 100)}%`);
  
  if (passedTests === totalTests) {
    console.log('\n🎉 ALL TESTS PASSED! OpenAI integration is working perfectly.');
    console.log('🚀 The issue is likely with the Lambda environment, not the OpenAI setup.');
  } else if (passedTests === 0) {
    console.log('\n❌ ALL TESTS FAILED! Check your OpenAI API key setup.');
    console.log('🔧 Make sure you have OPENAI_API_KEY in your .env file.');
  } else {
    console.log('\n⚠️ PARTIAL SUCCESS. Some tests passed, some failed.');
    console.log('🔍 Check the individual test results above for details.');
  }
}

/**
 * Quick single test
 */
async function quickTest(question = "What's your favorite Beatles song?", personality = 'mainstream') {
  console.log('⚡ Quick OpenAI Test');
  console.log('==================');
  
  const bot = new LocalBotTester(personality);
  const result = await bot.testSongSuggestions(question);
  
  if (result.success) {
    console.log('\n✅ Quick test PASSED!');
  } else {
    console.log('\n❌ Quick test FAILED!');
    console.log(`Error: ${result.error}`);
  }
}

// Export for use in other files
module.exports = {
  LocalBotTester,
  runAllTests,
  quickTest
};

// Run tests if this file is executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--quick')) {
    quickTest().catch(console.error);
  } else {
    runAllTests().catch(console.error);
  }
}