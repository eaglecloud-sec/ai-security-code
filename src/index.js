const InputProcessor = require('./input-processor.js');
const core = require('@actions/core');
const { AI_REVIEW_COMMENT_PREFIX, SUMMARY_SEPARATOR } = require('./constants');
const WebhookService = require('./webhook-service');

const main = async () => {
    const inputProcessor = new InputProcessor();

    try {
        await inputProcessor.processInputs();

        if (inputProcessor.filteredDiffs.length === 0) {
            core.info('No files to review');
            return;
        }
        
        const aiAgent = inputProcessor.getAIAgent();
        const reviewSummary = await aiAgent.doReview(inputProcessor.filteredDiffs);
        if (!reviewSummary || typeof reviewSummary !== 'string' || reviewSummary.trim() === '') {
            throw new Error('AI Agent did not return a valid review summary');
        }

        const commentBody = `${AI_REVIEW_COMMENT_PREFIX}${inputProcessor.headCommit}${SUMMARY_SEPARATOR}${reviewSummary}`;
        await inputProcessor.githubAPI.createPRComment(
            inputProcessor.owner, 
            inputProcessor.repo, 
            inputProcessor.pullNumber, 
            commentBody
        );

        // 初始化 Webhook 服务
        const webhookUrl = core.getInput('webhook_url');
        const webhookSecret = core.getInput('webhook_secret');
        const webhookHeaders = JSON.parse(core.getInput('webhook_headers') || '{}');
        
        if (webhookUrl) {
            const webhookService = new WebhookService(webhookUrl, webhookSecret, webhookHeaders);
            await webhookService.sendReviewResults(
                {
                    summary: reviewSummary,
                    comments: inputProcessor.githubAPI.getComments()
                },
                {
                    owner: inputProcessor.owner,
                    repo: inputProcessor.repo,
                    prNumber: inputProcessor.pullNumber
                }
            );
        }

    } catch (error) {
        if (!inputProcessor?.failAction) {
            core.debug(error.stack);
            core.warning(error.message);
        } else {            
            core.debug(error.stack);
            core.error(error.message);
            core.setFailed(error);
        }
    }
};

main();
