// scripts/lambdaCleanup.js - IMPROVED VERSION
const AWS = require('aws-sdk');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const cloudwatchLogs = new AWS.CloudWatchLogs({ region: process.env.AWS_REGION || 'us-east-1' });
const lambda = new AWS.Lambda({ region: process.env.AWS_REGION || 'us-east-1' });

class ImprovedLambdaCleanup {
  constructor() {
    this.functionName = process.env.BOT_WORKER_FUNCTION_NAME;
    this.logGroupName = `/aws/lambda/${this.functionName}`;
    
    if (!this.functionName) {
      throw new Error('BOT_WORKER_FUNCTION_NAME environment variable not set');
    }
    
    console.log('🤖 Improved Lambda Cleanup Tool initialized');
    console.log(`Function name: ${this.functionName}`);
    console.log(`AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
  }

  async findActiveBots() {
    try {
      console.log('🔍 Searching for active bot workers (recent activity method)...');
      console.log(`Looking for function: ${this.functionName}`);
      console.log(`Log group: ${this.logGroupName}`);
      
      // Look for activity in last 10 minutes (more generous window)
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      
      const streamsResponse = await cloudwatchLogs.describeLogStreams({
        logGroupName: this.logGroupName,
        orderBy: 'LastEventTime', 
        descending: true,
        limit: 50 // Check more streams
      }).promise();
      
      console.log(`Found ${streamsResponse.logStreams.length} total log streams`);
      
      const recentStreams = streamsResponse.logStreams.filter(stream => 
        stream.lastEventTime && stream.lastEventTime > tenMinutesAgo
      );
      
      console.log(`📊 Found ${recentStreams.length} streams with activity in last 10 minutes`);
      
      if (recentStreams.length === 0) {
        console.log('✅ No recent bot activity found');
        return [];
      }
      
      // For each recent stream, extract bot info
      const activeBots = [];
      
      for (const stream of recentStreams.slice(0, 15)) { // Check top 15
        try {
          const eventsResponse = await cloudwatchLogs.getLogEvents({
            logGroupName: this.logGroupName,
            logStreamName: stream.logStreamName,
            startTime: tenMinutesAgo,
            limit: 50
          }).promise();
          
          const messages = eventsResponse.events.map(e => e.message);
          
          // Look for bot initialization message
          const botInitMessage = messages.find(msg => 
            msg.includes('Bot worker started with timeout protection') ||
            msg.includes('"botName"')
          );
          
          if (botInitMessage) {
            // Extract bot details from init message
            const botNameMatch = botInitMessage.match(/"botName":\s*"([^"]+)"/);
            const gameCodeMatch = botInitMessage.match(/"gameCode":\s*"([^"]+)"/);
            const personalityMatch = botInitMessage.match(/"personality":\s*"([^"]+)"/);
            
            if (botNameMatch && gameCodeMatch) {
              // Check how recent the activity is
              const lastEventTime = new Date(stream.lastEventTime);
              const minutesAgo = Math.floor((Date.now() - stream.lastEventTime) / 60000);
              
              // Look for signs of ongoing activity vs terminated bot
              const hasRecentProcessing = messages.some(msg => 
                msg.includes('processing game state') ||
                msg.includes('analyzing question') ||
                msg.includes('submitting') ||
                msg.includes('voting')
              );
              
              const hasTermination = messages.some(msg =>
                msg.includes('Bot finished') ||
                msg.includes('game ended') ||
                msg.includes('terminating')
              );
              
              activeBots.push({
                botName: botNameMatch[1],
                gameCode: gameCodeMatch[1],
                personality: personalityMatch ? personalityMatch[1] : 'unknown',
                logStream: stream.logStreamName,
                lastActivity: lastEventTime,
                minutesAgo: minutesAgo,
                hasRecentProcessing: hasRecentProcessing,
                hasTermination: hasTermination,
                status: hasTermination ? 'terminated' : (minutesAgo < 5 ? 'active' : 'idle'),
                recentMessages: messages.slice(-3)
              });
            }
          }
        } catch (error) {
          // Skip streams we can't read
          continue;
        }
      }
      
      return activeBots;
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        console.log(`📝 Log group ${this.logGroupName} not found`);
        console.log('This means either:');
        console.log('  1. No bots have ever run (log group not created yet)');
        console.log('  2. Function name is incorrect');
        console.log('  3. Wrong AWS region');
        console.log(`💡 Try running a bot first, or check:`);
        console.log(`   - BOT_WORKER_FUNCTION_NAME=${this.functionName}`);
        console.log(`   - AWS_REGION=${process.env.AWS_REGION || 'us-east-1'}`);
        return [];
      }
      
      console.error('❌ Error finding active bots:', error.message);
      throw error;
    }
  }

  async findCurrentlyExecuting() {
    try {
      console.log('⚡ Also checking for currently executing invocations...');
      
      // This is the old method - check for actual running invocations
      // This will almost always be empty due to short execution times
      
      // Note: There's no direct AWS API to list "currently running" Lambda invocations
      // We can only check metrics or recent invocations
      
      console.log('💡 Note: Lambda invocations are very short (seconds), so finding');
      console.log('   "currently running" executions is nearly impossible.');
      console.log('   The "recent activity" method above is more reliable.');
      
      return [];
    } catch (error) {
      console.error('Error checking current executions:', error);
      return [];
    }
  }

  displayResults(activeBots) {
    if (activeBots.length === 0) {
      console.log('✅ No active bots found in last 10 minutes');
      return;
    }
    
    console.log(`\n🤖 Found ${activeBots.length} bot(s) with recent activity:\n`);
    
    activeBots.forEach((bot, index) => {
      console.log(`${index + 1}. ${bot.botName} (${bot.personality})`);
      console.log(`   Game: ${bot.gameCode}`);
      console.log(`   Status: ${bot.status.toUpperCase()}`);
      console.log(`   Last activity: ${bot.minutesAgo} minutes ago`);
      console.log(`   Log stream: ${bot.logStream}`);
      
      if (bot.status === 'active') {
        console.log(`   🟢 Recently active - likely still in game`);
      } else if (bot.status === 'terminated') {
        console.log(`   🔴 Terminated normally`);
      } else {
        console.log(`   🟡 Idle - may be between game phases`);
      }
      
      console.log('');
    });
    
    // Show summary
    const activeBotCount = activeBots.filter(b => b.status === 'active').length;
    const idleBotCount = activeBots.filter(b => b.status === 'idle').length;
    const terminatedBotCount = activeBots.filter(b => b.status === 'terminated').length;
    
    console.log('📊 Summary:');
    console.log(`   Active: ${activeBotCount}`);
    console.log(`   Idle: ${idleBotCount}`);
    console.log(`   Terminated: ${terminatedBotCount}`);
  }
}

// Command line interface
async function main() {
  const command = process.argv[2] || 'find-running';
  
  try {
    const cleanup = new ImprovedLambdaCleanup();
    
    switch (command) {
      case 'find-running':
      case 'find-active':
        const activeBots = await cleanup.findActiveBots();
        await cleanup.findCurrentlyExecuting();
        cleanup.displayResults(activeBots);
        break;
        
      default:
        console.log('Usage: node scripts/lambdaCleanup.js [find-running|find-active]');
        break;
    }
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}