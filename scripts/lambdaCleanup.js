// scripts/lambdaCleanup.js - Tools to find and kill zombie Lambda functions
const AWS = require('aws-sdk');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Configure AWS SDK
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1'
});

const lambda = new AWS.Lambda();
const cloudWatchLogs = new AWS.CloudWatchLogs();

class LambdaCleanup {
  constructor() {
    this.botWorkerFunctionName = process.env.BOT_WORKER_FUNCTION_NAME || 'heartsongs-bot-worker';
    console.log(`🤖 Lambda Cleanup Tool initialized`);
    console.log(`Function name: ${this.botWorkerFunctionName}`);
    console.log(`AWS Region: ${AWS.config.region}`);
  }

  /**
   * Find currently running Lambda executions (via CloudWatch logs)
   */
  async findRunningExecutions() {
    console.log('🔍 Searching for running bot worker executions...\n');
    console.log(`Looking for function: ${this.botWorkerFunctionName}`);
    
    const logGroupName = `/aws/lambda/${this.botWorkerFunctionName}`;
    console.log(`Log group: ${logGroupName}`);
    
    try {
      // Get recent log streams (running executions)
      const streams = await cloudWatchLogs.describeLogStreams({
        logGroupName: logGroupName,
        orderBy: 'LastEventTime',
        descending: true,
        limit: 50
      }).promise();

      console.log(`Found ${streams.logStreams.length} recent log streams`);
      
      const runningExecutions = [];
      const now = Date.now();
      const fiveMinutesAgo = now - (5 * 60 * 1000);

      for (const stream of streams.logStreams) {
        if (stream.lastEventTime && stream.lastEventTime > fiveMinutesAgo) {
          // Check if this stream shows active execution
          const events = await cloudWatchLogs.getLogEvents({
            logGroupName: logGroupName,
            logStreamName: stream.logStreamName,
            limit: 10,
            startFromHead: false
          }).promise();

          // Look for bot activity indicators
          const hasRecentActivity = events.events.some(event => 
            event.message.includes('Bot ') && 
            event.message.includes('processing game state') &&
            (now - event.timestamp) < (2 * 60 * 1000) // 2 minutes
          );

          if (hasRecentActivity) {
            runningExecutions.push({
              logStream: stream.logStreamName,
              lastActivity: new Date(stream.lastEventTime),
              duration: Math.floor((now - stream.creationTime) / 60000)
            });
          }
        }
      }

      if (runningExecutions.length === 0) {
        console.log('✅ No currently running bot executions found');
      } else {
        console.log(`⚠️ Found ${runningExecutions.length} potentially running executions:`);
        runningExecutions.forEach(exec => {
          console.log(`   ${exec.logStream}`);
          console.log(`     Last activity: ${exec.lastActivity.toISOString()}`);
          console.log(`     Duration: ${exec.duration} minutes\n`);
        });
      }

      return runningExecutions;

    } catch (error) {
      console.error('❌ Error finding running executions:', error.message);
      
      if (error.code === 'ResourceNotFoundException') {
        console.log(`📝 Log group ${logGroupName} not found`);
        console.log('This means either:');
        console.log('  1. No bots have ever run (log group not created yet)');
        console.log('  2. Function name is incorrect');
        console.log('  3. Wrong AWS region');
        console.log('\n💡 Try running a bot first, or check:');
        console.log(`   - BOT_WORKER_FUNCTION_NAME=${this.botWorkerFunctionName}`);
        console.log(`   - AWS_REGION=${AWS.config.region}`);
        
        // Let's also check if the function exists
        await this.checkIfFunctionExists();
        return [];
      } else if (error.code === 'UnauthorizedOperation' || error.code === 'AccessDenied') {
        console.log('🔐 AWS Permission Error:');
        console.log('Make sure your AWS credentials have CloudWatch Logs permissions');
        return [];
      }
      throw error;
    }
  }

  /**
   * Check if the Lambda function exists
   */
  async checkIfFunctionExists() {
    try {
      console.log(`\n🔍 Checking if Lambda function exists...`);
      const config = await lambda.getFunctionConfiguration({
        FunctionName: this.botWorkerFunctionName
      }).promise();
      
      console.log(`✅ Function exists: ${config.FunctionName}`);
      console.log(`   Runtime: ${config.Runtime}`);
      console.log(`   Last Modified: ${config.LastModified}`);
      console.log(`\n💡 Function exists but no logs yet. This is normal if no bots have run.`);
      
    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        console.log(`❌ Lambda function '${this.botWorkerFunctionName}' does not exist`);
        console.log('\n💡 Available options:');
        console.log('   1. Deploy your bot Lambda function first');
        console.log('   2. Check the function name in AWS Console');
        console.log('   3. Update BOT_WORKER_FUNCTION_NAME in .env file');
        
        // Try to list functions to help user
        await this.listAvailableFunctions();
      } else {
        console.log(`❌ Error checking function: ${error.message}`);
      }
    }
  }

  /**
   * List available Lambda functions that might be the bot
   */
  async listAvailableFunctions() {
    try {
      console.log('\n📋 Looking for available Lambda functions...');
      const functions = await lambda.listFunctions({ MaxItems: 50 }).promise();
      
      const possibleBotFunctions = functions.Functions.filter(f => 
        f.FunctionName.toLowerCase().includes('bot') || 
        f.FunctionName.toLowerCase().includes('heart')
      );
      
      if (possibleBotFunctions.length > 0) {
        console.log('🎯 Found possible bot functions:');
        possibleBotFunctions.forEach(f => {
          console.log(`   - ${f.FunctionName} (${f.Runtime})`);
        });
        console.log('\n💡 Update your .env file with the correct function name');
      } else {
        console.log('❌ No functions found with "bot" or "heart" in the name');
        console.log('\n📝 All available functions:');
        functions.Functions.slice(0, 10).forEach(f => {
          console.log(`   - ${f.FunctionName}`);
        });
        if (functions.Functions.length > 10) {
          console.log(`   ... and ${functions.Functions.length - 10} more`);
        }
      }
      
    } catch (error) {
      console.log(`❌ Error listing functions: ${error.message}`);
    }
  }

  /**
   * Get Lambda function metrics
   */
  async getLambdaMetrics() {
    console.log('📊 Getting Lambda function metrics...\n');
    
    try {
      // Get function configuration
      const config = await lambda.getFunctionConfiguration({
        FunctionName: this.botWorkerFunctionName
      }).promise();

      console.log(`Function: ${config.FunctionName}`);
      console.log(`Runtime: ${config.Runtime}`);
      console.log(`Timeout: ${config.Timeout} seconds`);
      console.log(`Memory: ${config.MemorySize} MB`);
      console.log(`Last Modified: ${config.LastModified}`);

      // Note: Real-time invocation metrics require CloudWatch API
      console.log('\n📈 For detailed metrics, check AWS CloudWatch console:');
      console.log(`   - Invocations, Duration, Errors, Throttles`);
      console.log(`   - Log group: /aws/lambda/${this.botWorkerFunctionName}`);

    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        console.log(`❌ Lambda function '${this.botWorkerFunctionName}' not found`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Emergency: Update Lambda timeout to kill long-running executions
   */
  async emergencyTimeoutUpdate(newTimeout = 60) {
    console.log(`🚨 EMERGENCY: Updating Lambda timeout to ${newTimeout} seconds...\n`);
    
    const confirm = process.argv.includes('--confirm-timeout-update');
    if (!confirm) {
      console.log('⚠️ Add --confirm-timeout-update flag to actually update the timeout');
      console.log('This will kill any currently running executions when they hit the new timeout');
      return;
    }

    try {
      const result = await lambda.updateFunctionConfiguration({
        FunctionName: this.botWorkerFunctionName,
        Timeout: newTimeout
      }).promise();

      console.log('✅ Lambda timeout updated successfully');
      console.log(`   New timeout: ${result.Timeout} seconds`);
      console.log('   Any running executions will be killed when they hit this timeout');

    } catch (error) {
      console.error('❌ Failed to update Lambda timeout:', error.message);
    }
  }

  /**
   * Clean up old log streams
   */
  async cleanupOldLogs(daysOld = 7) {
    console.log(`🧹 Cleaning up log streams older than ${daysOld} days...\n`);
    
    try {
      const logGroupName = `/aws/lambda/${this.botWorkerFunctionName}`;
      const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

      let nextToken = null;
      let deletedCount = 0;

      do {
        const params = {
          logGroupName: logGroupName,
          limit: 50,
          ...(nextToken && { nextToken })
        };

        const streams = await cloudWatchLogs.describeLogStreams(params).promise();

        const oldStreams = streams.logStreams.filter(stream => 
          stream.lastEventTime && stream.lastEventTime < cutoffTime
        );

        for (const stream of oldStreams) {
          try {
            await cloudWatchLogs.deleteLogStream({
              logGroupName: logGroupName,
              logStreamName: stream.logStreamName
            }).promise();
            
            deletedCount++;
            console.log(`   Deleted: ${stream.logStreamName}`);
          } catch (deleteError) {
            console.log(`   Failed to delete ${stream.logStreamName}: ${deleteError.message}`);
          }
        }

        nextToken = streams.nextToken;
      } while (nextToken);

      console.log(`\n✅ Cleanup completed: ${deletedCount} old log streams deleted`);

    } catch (error) {
      if (error.code === 'ResourceNotFoundException') {
        console.log(`Log group not found - nothing to clean up`);
      } else {
        console.error('❌ Log cleanup failed:', error.message);
      }
    }
  }

  /**
   * Show help
   */
  showHelp() {
    console.log(`
🤖 Lambda Bot Cleanup Tool

Environment Variables:
  BOT_WORKER_FUNCTION_NAME - Lambda function name (default: heartsongs-bot-worker)
  AWS_REGION              - AWS region (default: us-east-1)

Commands:
  find-running    - Find currently running bot executions
  metrics        - Show Lambda function metrics  
  emergency-timeout <seconds> - Update Lambda timeout (requires --confirm-timeout-update)
  cleanup-logs [days] - Delete log streams older than X days (default: 7)

Examples:
  node lambdaCleanup.js find-running
  node lambdaCleanup.js metrics
  node lambdaCleanup.js emergency-timeout 60 --confirm-timeout-update
  node lambdaCleanup.js cleanup-logs 3

⚠️ ZOMBIE LAMBDA CLEANUP STRATEGY:
1. Run 'find-running' to see active executions
2. For immediate kill: Use 'emergency-timeout 60 --confirm-timeout-update'
3. For old logs: Use 'cleanup-logs 1' to remove old streams
4. Monitor with 'metrics' command

Note: There's no direct way to "kill" a running Lambda. The timeout method
will cause them to be terminated when they hit the new timeout limit.
    `);
  }
}

// CLI interface
async function main() {
  const cleanup = new LambdaCleanup();
  const command = process.argv[2];
  
  try {
    switch (command) {
      case 'find-running':
        await cleanup.findRunningExecutions();
        break;
        
      case 'metrics':
        await cleanup.getLambdaMetrics();
        break;
        
      case 'emergency-timeout':
        const timeout = parseInt(process.argv[3]) || 60;
        await cleanup.emergencyTimeoutUpdate(timeout);
        break;
        
      case 'cleanup-logs':
        const days = parseInt(process.argv[3]) || 7;
        await cleanup.cleanupOldLogs(days);
        break;
        
      default:
        cleanup.showHelp();
        break;
    }
    
  } catch (error) {
    console.error('❌ Lambda cleanup failed:', error.message);
    
    if (error.code === 'UnauthorizedOperation' || error.code === 'AccessDenied') {
      console.error('\n🔐 AWS Permission Error:');
      console.error('Make sure your AWS credentials have the following permissions:');
      console.error('- lambda:GetFunctionConfiguration');
      console.error('- lambda:UpdateFunctionConfiguration'); 
      console.error('- logs:DescribeLogStreams');
      console.error('- logs:GetLogEvents');
      console.error('- logs:DeleteLogStream');
    }
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = LambdaCleanup;