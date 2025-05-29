// lambda/debug/handler.js
exports.handler = async (event, context) => {
  try {
    console.log('=== DEBUG INFO ===');
    console.log('Environment Variables:', JSON.stringify(process.env, null, 2));
    console.log('Event:', JSON.stringify(event, null, 2));
    console.log('Context:', JSON.stringify(context, null, 2));
    
    // Test the Heart Songs API URL
    const heartsOngsApiUrl = process.env.HEARTSONGS_API_URL;
    console.log('Heart Songs API URL:', heartsOngsApiUrl);
    
    if (!heartsOngsApiUrl) {
      return {
        statusCode: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'HEARTSONGS_API_URL environment variable not set',
          availableEnvVars: Object.keys(process.env)
        })
      };
    }
    
    // Test if we can reach the Heart Songs API
    const axios = require('axios');
    
    try {
      console.log('Testing Heart Songs API connection...');
      const response = await axios.get(`${heartsOngsApiUrl.replace('/api', '')}/health`, {
        timeout: 5000
      });
      
      console.log('Heart Songs API Response:', response.status, response.data);
      
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: true,
          heartsOngsApiUrl,
          apiHealthCheck: {
            status: response.status,
            data: response.data
          },
          environment: process.env.NODE_ENV || 'unknown',
          timestamp: new Date().toISOString()
        })
      };
      
    } catch (apiError) {
      console.error('Heart Songs API Error:', apiError.message);
      
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          heartsOngsApiUrl,
          apiError: apiError.message,
          apiErrorCode: apiError.code,
          apiErrorResponse: apiError.response?.data,
          environment: process.env.NODE_ENV || 'unknown',
          timestamp: new Date().toISOString()
        })
      };
    }
    
  } catch (error) {
    console.error('Debug handler error:', error);
    
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Debug handler failed',
        details: error.message,
        stack: error.stack
      })
    };
  }
};