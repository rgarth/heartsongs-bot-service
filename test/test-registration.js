// test/test-registration.js
const axios = require('axios');

async function testRegistration() {
  const API_URL = 'https://heart-songs-development.onrender.com/api';
  
  console.log('🧪 Testing Heart Songs API Registration');
  console.log('======================================');
  
  // Test bot username generation
  const musicWords = ['vinyl', 'beat', 'rhythm', 'melody', 'harmony'];
  const botName = `${musicWords[Math.floor(Math.random() * musicWords.length)]}_bot_${Math.floor(1000 + Math.random() * 9000)}`;
  
  console.log(`🤖 Generated bot name: ${botName}`);
  
  try {
    console.log('📡 Testing registration endpoint...');
    console.log(`🔗 URL: ${API_URL}/auth/register-anonymous`);
    
    const response = await axios.post(`${API_URL}/auth/register-anonymous`, {
      username: botName
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('✅ Registration successful!');
    console.log('📊 Response status:', response.status);
    console.log('📄 Response data:', JSON.stringify(response.data, null, 2));
    
    // Test if we got the expected fields
    const { user, sessionToken } = response.data;
    
    if (user && user.id && user.displayName && sessionToken) {
      console.log('✅ All required fields present');
      console.log(`👤 User ID: ${user.id}`);
      console.log(`🏷️  Display Name: ${user.displayName}`);
      console.log(`🔑 Session Token: ${sessionToken.substring(0, 10)}...`);
      
      // Test if we can use the session token
      console.log('\n🔐 Testing session token...');
      try {
        const validateResponse = await axios.post(`${API_URL}/auth/validate-session`, {
          sessionToken: sessionToken
        });
        
        console.log('✅ Session token is valid');
        console.log('📊 Validation response:', validateResponse.data);
        
      } catch (validateError) {
        console.log('❌ Session token validation failed:', validateError.response?.data || validateError.message);
      }
      
    } else {
      console.log('❌ Missing required fields in response');
      console.log('Expected: user.id, user.displayName, sessionToken');
      console.log('Got:', Object.keys(response.data));
    }
    
  } catch (error) {
    console.error('❌ Registration failed:', error.message);
    
    if (error.response) {
      console.log('📊 Status:', error.response.status);
      console.log('📄 Response data:', error.response.data);
      console.log('🔗 URL:', error.config?.url);
    }
    
    if (error.code === 'ENOTFOUND') {
      console.log('🔍 DNS resolution failed - API server may be down');
    }
    
    if (error.code === 'ECONNREFUSED') {
      console.log('🔍 Connection refused - API server may not be running');
    }
  }
}

// Test game join as well if registration works
async function testGameJoin() {
  console.log('\n🎮 Testing Game Join (with fake data)');
  console.log('=====================================');
  
  const API_URL = 'https://heart-songs-development.onrender.com/api';
  
  try {
    // This should fail with 401 since we don't have auth
    const response = await axios.post(`${API_URL}/game/join`, {
      gameCode: 'TEST123',
      userId: 'fake-user-id'
    });
    
    console.log('🤔 Unexpected success:', response.data);
    
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ Expected 401 - endpoint exists and requires auth');
      console.log('📄 Error message:', error.response.data);
    } else {
      console.log('❌ Unexpected error:', error.response?.status, error.response?.data);
    }
  }
}

async function runTests() {
  await testRegistration();
  await testGameJoin();
}

runTests().catch(console.error);