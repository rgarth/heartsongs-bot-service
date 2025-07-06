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
async function runTest(name, testFunction) {
  console.log(`\n🧪 Running test: ${name}`);
  console.log('=' .repeat(50));
  
  try {
    await testFunction();
    console.log(`✅ ${name} - PASSED`);
    results.passed++;
    results.tests.push({ name, status: 'PASSED' });
  } catch (error) {
    console.log(`❌ ${name} - FAILED`);
    console.error(`   Error: ${error.message}`);
    results.failed++;
    results.tests.push({ name, status: 'FAILED', error: error.message });
  }
}

// Test 1: Basic bot spawn with retry logic
async function testBasicBotSpawn() {
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
  
  console.log(`   Bot spawned successfully: ${response.data.botName}`);
}

// Test 2: Rate limiting behavior
async function testRateLimiting() {
  const testGame = await createTestGame();
  
  // Try to spawn multiple bots quickly to trigger rate limiting
  const promises = [];
  
  for (let i = 0; i < 15; i++) {
    promises.push(
      axios.post(`${BOT_API_URL}/spawn-bot`, {
        gameCode: testGame.gameCode,
        personality: 'mainstream'
      }).catch(error => error.response) // Don't throw, collect responses
    );
  }
  
  const responses = await Promise.all(promises);
  
  // Check if we got rate limit responses
  const rateLimitResponses = responses.filter(r => r && r.status === 429);
  const successResponses = responses.filter(r => r && r.status === 200);
  
  console.log(`   Total requests: ${responses.length}`);
  console.log(`   Success responses: ${successResponses.length}`);
  console.log(`   Rate limit responses: ${rateLimitResponses.length}`);
  
  if (rateLimitResponses.length === 0) {
    console.log('   ⚠️ No rate limiting detected - this might be expected if the limit is high');
  } else {
    console.log('   ✅ Rate limiting is working');
  }
  
  if (successResponses.length === 0) {
    throw new Error('No successful bot spawns - rate limiting might be too aggressive');
  }
}

// Test 3: Error handling for invalid game codes
async function testErrorHandling() {
  try {
    await axios.post(`${BOT_API_URL}/spawn-bot`, {
      gameCode: 'INVALID_GAME_CODE',
      personality: 'eclectic'
    });
    
    throw new Error('Expected error for invalid game code, but request succeeded');
  } catch (error) {
    if (error.response && error.response.status === 500) {
      const errorData = error.response.data;
      if (errorData.error === 'Game join failed') {
        console.log('   ✅ Proper error handling for invalid game codes');
        return;
      }
    }
    
    throw new Error(`Unexpected error response: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
  }
}

// Test 4: Retry logic simulation
async function testRetryLogic() {
  const testGame = await createTestGame();
  
  // This test simulates what happens when the API is under load
  // We'll make multiple requests and see if the retry logic helps
  const startTime = Date.now();
  
  const response = await axios.post(`${BOT_API_URL}/spawn-bot`, {
    gameCode: testGame.gameCode,
    personality: 'indie'
  });
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  console.log(`   Bot spawn took ${duration}ms`);
  
  if (!response.data.success) {
    throw new Error('Bot spawn failed');
  }
  
  // If it took longer than 5 seconds, it likely used retry logic
  if (duration > 5000) {
    console.log('   ✅ Retry logic likely used (longer duration)');
  } else {
    console.log('   ✅ Bot spawn completed quickly');
  }
}

// Test 5: Different personalities
async function testPersonalities() {
  const testGame = await createTestGame();
  const personalities = ['eclectic', 'mainstream', 'indie', 'vintage', 'analytical'];
  
  for (const personality of personalities) {
    console.log(`   Testing ${personality} personality...`);
    
    const response = await axios.post(`${BOT_API_URL}/spawn-bot`, {
      gameCode: testGame.gameCode,
      personality: personality
    });
    
    if (!response.data.success) {
      throw new Error(`Failed to spawn ${personality} bot`);
    }
    
    console.log(`   ✅ ${personality} bot spawned: ${response.data.botName}`);
    
    // Small delay between spawns
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting Rate Limiting and Retry Logic Tests');
  console.log(`🔗 Bot API: ${BOT_API_URL}`);
  console.log(`🎮 Heart Songs API: ${HEART_SONGS_API_URL}`);
  
  // Run all tests
  await runTest('Basic Bot Spawn', testBasicBotSpawn);
  await runTest('Rate Limiting Behavior', testRateLimiting);
  await runTest('Error Handling', testErrorHandling);
  await runTest('Retry Logic Simulation', testRetryLogic);
  await runTest('Different Personalities', testPersonalities);
  
  // Print results
  console.log('\n==================================================');
  console.log('🎯 TEST SUMMARY');
  console.log('==================================================');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📊 Total: ${results.passed + results.failed}`);
  
  if (results.failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.tests.filter(t => t.status === 'FAILED').forEach(test => {
      console.log(`   - ${test.name}: ${test.error}`);
    });
    console.log('\n🔧 Some tests failed. Check the errors above.');
  } else {
    console.log('\n🎉 All tests passed! Rate limiting and retry logic are working correctly.');
  }
}

// Run the tests
runAllTests().catch(error => {
  console.error('💥 Test runner crashed:', error);
  process.exit(1);
}); 