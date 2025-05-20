const OpenAIAgent = require("./openai-agent");
const core = require("@actions/core");

class DeepseekAgent extends OpenAIAgent {
    constructor(apiKey, fileContentGetter, fileCommentator, model, baseURL = null) {
        const defaultDeepseekURL = "https://api.deepseek.com/";
        const apiBaseURL = baseURL && baseURL.trim() !== '' ? baseURL : defaultDeepseekURL;
        
        if (baseURL && baseURL.trim() !== '') {
            core.info(`使用自定义 Deepseek API URL: ${baseURL}`);
        } else {
            core.info(`使用默认 Deepseek API URL: ${defaultDeepseekURL}`);
        }
        
        super(apiKey, fileContentGetter, fileCommentator, model, apiBaseURL);
    }
}

module.exports = DeepseekAgent;
