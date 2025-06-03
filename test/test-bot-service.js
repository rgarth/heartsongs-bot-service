// test/test-bot-service.js
const axios = require('axios');

// Configuration
const BOT_API_URL = 'https://5dwmbtlad2.execute-api.us-east-1.amazonaws.com/dev';
const HEART_SONGS_API_URL = 'https://heart-songs-development.onrender.com/api';

// Test results
let results = {
  passed: 0,
  failed: 0,
  tests: []
};

// Helper function to create a test user and game
async function createTestGame() {
  // Generate test user
  const testUsername = `test_user_${Math.floor(1000 + Math.random() * 9000)}`;
  
  const userResponse = await axios.post(`${HEART_SONGS_API_URL}/auth/register-anonymous`, {
    username: testUsername
  });
  
  const { user, sessionToken } = userResponse.data;
  
  // Create game
  const gameResponse = await axios.post(`${HEART_SONGS_API_URL}/game/create`, {
    userId: user.id
  }, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  
  return {
    user,
    sessionToken,
    gameCode: gameResponse.data.gameCode,
    gameId: gameResponse.data.gameId
  };
}

// Helper function to run a test
async function runTest(testName, testFunction) {
  console.log(`🧪 Running: ${testName}`);
  try {
    await testFunction();
    console.log(`✅ PASSED: ${testName}`);
    results.passed++;
    results.tests.push({ name: testName, status: 'PASSED' });
  } catch (error) {
    console.log(`❌ FAILED: ${testName}`);
    console.log(`   Error: ${error.message}`);
    if (error.response && error.response.data) {
      console.log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    results.failed++;
    results.tests.push({ name: testName, status: 'FAILED', error: error.message });
  }
}

// Test 1: Lambda Health Check (with real game)
async function testLambdaHealthCheck() {
  const testGame = await createTestGame();
  
  const response = await axios.post(`${BOT_API_URL}/spawn-bot`, {
    gameCode: testGame.gameCode,
    personality: 'eclectic'
  });
  
  if (!response.data.success) {
    throw new Error('Bot spawn was not successful');
  }
  
  if (!response.data.botId || !response.data.botName) {
    throw new Error('Missing bot information in response');
  }
}

// Test 2: Direct Bot Spawn (with real game)
async function testDirectBotSpawn() {
  const testGame = await createTestGame();
  
  const response = await axios.post(`${BOT_API_URL}/spawn-bot`, {
    gameCode: testGame.gameCode,
    personality: 'mainstream'
  });
  
  if (response.data.botName.includes('_bot_')) {
    // Success - bot name has expected format
    return;
  } else {
    throw new Error('Bot name does not match expected format');
  }
}

// Test 3: Personality Variations (with real game)
async function testPersonalityVariations() {
  const personalities = ['eclectic', 'mainstream', 'indie', 'vintage', 'analytical'];
  const testGame = await createTestGame();
  
  for (const personality of personalities) {
    const response = await axios.post(`${BOT_API_URL}/spawn-bot`, {
      gameCode: testGame.gameCode,
      personality: personality
    });
    
    if (!response.data.success) {
      throw new Error(`Failed to spawn ${personality} bot`);
    }
  }
}

// Test 4: Heart Songs Integration (existing test)
async function testHeartSongsIntegration() {
  console.log('   🎮 Creating test user...');
  const testUsername = `test_user_${Math.floor(1000 + Math.random() * 9000)}`;
  
  const userResponse = await axios.post(`${HEART_SONGS_API_URL}/auth/register-anonymous`, {
    username: testUsername
  });
  
  const { user, sessionToken } = userResponse.data;
  console.log(`   👤 Test user created: ${user.displayName}`);
  
  console.log('   🎯 Creating test game...');
  const gameResponse = await axios.post(`${HEART_SONGS_API_URL}/game/create`, {
    userId: user.id
  }, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  
  const gameCode = gameResponse.data.gameCode;
  console.log(`   🎲 Test game created: ${gameCode}`);
  
  console.log('   🤖 Adding bot through Heart Songs API...');
  const botResponse = await axios.post(`${BOT_API_URL}/spawn-bot`, {
    gameCode: gameCode,
    personality: 'eclectic'
  });
  
  if (!botResponse.data.success) {
    throw new Error('Bot spawn failed');
  }
  
  console.log(`   🎉 Bot added successfully: ${botResponse.data.botName}`);
}

// Test 5: Error Handling (with invalid game code)
async function testErrorHandling() {
  try {
    await axios.post(`${BOT_API_URL}/spawn-bot`, {
      gameCode: 'INVALID_GAME_CODE',
      personality: 'eclectic'
    });
    
    // If we get here, the test should fail because invalid game codes should return errors
    throw new Error('Expected error for invalid game code, but request succeeded');
  } catch (error) {
    // Check if we got the expected error
    if (error.response && error.response.status === 500) {
      const errorData = error.response.data;
      if (errorData.error === 'Game join failed' && errorData.details && errorData.details.error === 'Game not found') {
        // This is the expected error - test passes
        return;
      }
    }
    
    // Re-throw if it's not the expected error
    throw error;
  }
}

// Test 6: Bot Service Debug Endpoint
async function testDebugEndpoint() {
  const response = await axios.get(`${BOT_API_URL}/debug`);
  
  if (!response.data.heartsOngsApiUrl) {
    throw new Error('Debug endpoint missing Heart Songs API URL');
  }
  
  if (response.data.success === false && response.data.apiError) {
    throw new Error(`Heart Songs API not reachable: ${response.data.apiError}`);
  }
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting Heart Songs Bot Service Tests');
  console.log(`🔗 Bot API: ${BOT_API_URL}`);
  console.log(`🎮 Heart Songs API: ${HEART_SONGS_API_URL}`);
  
  // Run all tests
  await runTest('Debug Endpoint Check', testDebugEndpoint);
  await runTest('Lambda Health Check', testLambdaHealthCheck);
  await runTest('Direct Bot Spawn', testDirectBotSpawn);
  await runTest('Personality Variations', testPersonalityVariations);
  await runTest('Heart Songs Integration', testHeartSongsIntegration);
  await runTest('Error Handling', testErrorHandling);
  
  // Print results
  console.log('==================================================');
  console.log('🎯 TEST SUMMARY');
  console.log('==================================================');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📊 Total: ${results.passed + results.failed}`);
  
  if (results.failed > 0) {
    console.log('❌ Failed Tests:');
    results.tests.filter(t => t.status === 'FAILED').forEach(test => {
      console.log(`   - ${test.name}: ${test.error}`);
    });
    console.log('🔧 Some tests failed. Check the errors above and your configuration.');
  } else {
    console.log('🎉 All tests passed! Bot service is working correctly.');
  }
}

// Run the tests
runAllTests().catch(error => {
  console.error('💥 Test runner crashed:', error);
  process.exit(1);
});
